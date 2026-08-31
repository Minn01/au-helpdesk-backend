import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { UserRole } from "../../generated/prisma/client.js";
import { createApp } from "../app.js";
import type { AuthUser, UserRepository } from "./auth.types.js";
import { createSessionService } from "./session.service.js";

const unusedCategories = { listActive: async () => [] };
const unusedTickets = {
  listMine: async () => ({ tickets: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  getOwnedDetails: async () => ({ activities: [] }) as never,
  create: async () => ({}) as never,
  update: async () => ({}) as never,
  cancel: async () => ({}) as never,
  listComments: async () => [],
  addComment: async () => ({}) as never,
};
const unusedTechnicianTickets = {
  listQueue: async () => ({ tickets: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  listAssigned: async () => ({ tickets: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  getRelevantDetails: async () => ({ activities: [] }) as never,
  claim: async () => ({}) as never,
  start: async () => ({}) as never,
  resolve: async () => ({}) as never,
  updateClassification: async () => ({}) as never,
  listComments: async () => [],
  addComment: async () => ({}) as never,
};

const secret = "integration-test-secret-that-is-at-least-32-characters";
const activeStudent: AuthUser = {
  id: "auth-test-active-user",
  email: "active-auth-test@au.edu",
  displayName: "Active Auth Test User",
  role: UserRole.STUDENT,
  isActive: true,
};
const inactiveFaculty: AuthUser = {
  id: "auth-test-inactive-user",
  email: "inactive-auth-test@au.edu",
  displayName: "Inactive Auth Test User",
  role: UserRole.FACULTY,
  isActive: false,
};
const usersById = new Map([
  [activeStudent.id, activeStudent],
  [inactiveFaculty.id, inactiveFaculty],
]);
const users: UserRepository = {
  findById: async (id) => usersById.get(id) ?? null,
};

describe("session authentication", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = await new Promise<Server>((resolve) => {
      const candidate = createApp({
        attachments: {} as never,
        users,
        sessions: createSessionService(secret),
        categories: unusedCategories,
        tickets: unusedTickets,
        technicianTickets: unusedTechnicianTickets,
        adminTickets: {} as never,
        adminManagement: {} as never,
        nodeEnv: "development",
      }).listen(0, "127.0.0.1", () => resolve(candidate));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("loads an active user from a valid HelpDesk session and logs out", async () => {
    const token = createSessionService(secret).createToken(activeStudent.id);
    const cookie = `helpdesk_session=${token}`;
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user: activeStudent });

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /helpdesk_session=;/);
  });

  it("rejects an inactive user whose session is otherwise valid", async () => {
    const token = createSessionService(secret).createToken(inactiveFaculty.id);
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `helpdesk_session=${token}` },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "ACCOUNT_INACTIVE");
  });

  it("does not expose the removed development login route", async () => {
    const response = await fetch(`${baseUrl}/api/dev/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: activeStudent.id }),
    });
    assert.equal(response.status, 404);
  });
});
