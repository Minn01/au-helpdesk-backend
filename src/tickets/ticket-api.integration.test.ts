import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { UserRole } from "../../generated/prisma/client.js";
import { createApp } from "../app.js";
import type { AuthUser, UserRepository } from "../auth/auth.types.js";
import { createSessionService } from "../auth/session.service.js";
import { HttpError } from "../errors/http-error.js";
import type { TicketApi } from "../services/ticket.service.js";

const secret = "ticket-api-integration-secret-at-least-32-characters";
const owner: AuthUser = {
  id: "10000000-0000-4000-8000-000000000011",
  email: "owner@au.edu",
  displayName: "Ticket Owner",
  role: UserRole.STUDENT,
  isActive: true,
};
const otherStudent: AuthUser = {
  id: "10000000-0000-4000-8000-000000000012",
  email: "other@au.edu",
  displayName: "Other Student",
  role: UserRole.STUDENT,
  isActive: true,
};
const technician: AuthUser = {
  id: "10000000-0000-4000-8000-000000000013",
  email: "technician@au.edu",
  displayName: "Technician",
  role: UserRole.TECHNICIAN,
  isActive: true,
};
const ownedTicketId = "30000000-0000-4000-8000-000000000011";

const usersById = new Map([owner, otherStudent, technician].map((user) => [user.id, user]));
const users: UserRepository = { findById: async (id) => usersById.get(id) ?? null };

const assertOwner = (ticketId: string, creatorId: string) => {
  if (ticketId !== ownedTicketId || creatorId !== owner.id) {
    throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  }
};

const tickets: TicketApi = {
  listMine: async (creatorId, filters) => ({
    tickets: creatorId === owner.id ? [{ id: ownedTicketId }] as never : [],
    pagination: { page: filters.page, pageSize: filters.pageSize, total: 1, totalPages: 1 },
  }),
  getOwnedDetails: async (ticketId, creatorId) => {
    assertOwner(ticketId, creatorId);
    return { id: ticketId, activities: [] } as never;
  },
  create: async () => ({ id: ownedTicketId }) as never,
  update: async (ticketId, creatorId) => {
    assertOwner(ticketId, creatorId);
    return { id: ticketId } as never;
  },
  cancel: async (ticketId, creatorId) => {
    assertOwner(ticketId, creatorId);
    return { id: ticketId } as never;
  },
  listComments: async (ticketId, creatorId) => {
    assertOwner(ticketId, creatorId);
    return [];
  },
  addComment: async (ticketId, creatorId) => {
    assertOwner(ticketId, creatorId);
    return { id: "50000000-0000-4000-8000-000000000011" } as never;
  },
};

const technicianTickets = {
  listQueue: async () => ({ tickets: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  listAssigned: async () => ({ tickets: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  getRelevantDetails: async () => ({ activities: [] }) as never,
  claim: async () => { throw new HttpError(409, "TICKET_NOT_CLAIMABLE", "Ticket is no longer available to claim"); },
  start: async () => ({}) as never,
  resolve: async () => ({}) as never,
  updateClassification: async () => ({}) as never,
  listComments: async () => [],
  addComment: async () => ({}) as never,
};

const start = async () => {
  const server = await new Promise<Server>((resolve) => {
    const candidate = createApp({
      attachments: {} as never,
      users,
      sessions: createSessionService(secret),
      categories: { listActive: async () => [] },
      tickets,
      technicianTickets,
      adminTickets: {} as never,
      adminManagement: {} as never,
      nodeEnv: "development",
    }).listen(0, "127.0.0.1", () => resolve(candidate));
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const cookieFor = (user: AuthUser) => `helpdesk_session=${createSessionService(secret).createToken(user.id)}`;

describe("requester ticket API security", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    ({ server, baseUrl } = await start());
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("allows the owning student to view a ticket", async () => {
    const response = await fetch(`${baseUrl}/api/tickets/${ownedTicketId}`, {
      headers: { cookie: cookieFor(owner) },
    });
    assert.equal(response.status, 200);
  });

  it("returns 404 when another student changes the ticket ID in the URL", async () => {
    const response = await fetch(`${baseUrl}/api/tickets/${ownedTicketId}`, {
      headers: { cookie: cookieFor(otherStudent) },
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json() as { error: string }).error, "TICKET_NOT_FOUND");
  });

  it("blocks technician access to requester-only routes", async () => {
    const response = await fetch(`${baseUrl}/api/tickets/mine`, {
      headers: { cookie: cookieFor(technician) },
    });
    assert.equal(response.status, 403);
  });

  it("allows queue access and returns a clean 409 claim conflict for technicians", async () => {
    const queue = await fetch(`${baseUrl}/api/tickets/queue`, {
      headers: { cookie: cookieFor(technician) },
    });
    assert.equal(queue.status, 200);

    const claim = await fetch(`${baseUrl}/api/tickets/${ownedTicketId}/claim`, {
      method: "POST",
      headers: { cookie: cookieFor(technician) },
    });
    assert.equal(claim.status, 409);
    assert.deepEqual(await claim.json(), {
      error: "TICKET_NOT_CLAIMABLE",
      message: "Ticket is no longer available to claim",
    });
  });

  it("rejects requester-supplied priority", async () => {
    const response = await fetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers: { cookie: cookieFor(owner), "content-type": "application/json" },
      body: JSON.stringify({
        title: "A valid ticket title",
        description: "A sufficiently detailed ticket description",
        categoryIntent: "AUTO_DETECT",
        priority: "URGENT",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error: string }).error, "VALIDATION_ERROR");
  });
});
