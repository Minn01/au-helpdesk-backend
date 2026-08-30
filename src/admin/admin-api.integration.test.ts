import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { UserRole } from "../../generated/prisma/client.js";
import { createApp } from "../app.js";
import type { AuthUser } from "../auth/auth.types.js";
import { createSessionService } from "../auth/session.service.js";

const secret = "phase6-admin-test-secret-at-least-32-characters";
const admin: AuthUser = { id: "10000000-0000-4000-8000-000000000003", email: "admin@au.edu", displayName: "Admin", role: UserRole.ADMIN, isActive: true };
const student: AuthUser = { id: "10000000-0000-4000-8000-000000000001", email: "student@au.edu", displayName: "Student", role: UserRole.STUDENT, isActive: true };
const users = { findById: async (id: string) => id === admin.id ? admin : id === student.id ? student : null };
const sessions = createSessionService(secret);
let assignedTo: string | undefined;

describe("admin API authorization and validation", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = await new Promise<Server>((resolve) => {
      const candidate = createApp({
        users,
        sessions,
        categories: { listActive: async () => [] },
        tickets: {} as never,
        technicianTickets: {} as never,
        adminTickets: {
          listAll: async () => ({ tickets: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
          getDetails: async () => ({}) as never,
          listComments: async () => [],
          assign: async (_ticketId, technicianId) => { assignedTo = technicianId; return { id: _ticketId } as never; },
        },
        adminManagement: ({
          dashboard: async () => ({ totalTickets: 0 }),
          listCategories: async () => [],
          createCategory: async (input: { name: string; description: string | null }) => ({ id: "20000000-0000-4000-8000-000000000001", ...input }) as never,
          updateCategory: async () => ({}) as never,
          setCategoryActive: async () => ({}) as never,
          listUsers: async () => [],
          updateUser: async () => ({}) as never,
        }) as never,
        nodeEnv: "test",
      }).listen(0, "127.0.0.1", () => resolve(candidate));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const cookie = (user: AuthUser) => `helpdesk_session=${sessions.createToken(user.id)}`;

  it("rejects non-admin users", async () => {
    const response = await fetch(`${baseUrl}/api/admin/dashboard`, { headers: { cookie: cookie(student) } });
    assert.equal(response.status, 403);
  });

  it("allows admins to view dashboard data", async () => {
    const response = await fetch(`${baseUrl}/api/admin/dashboard`, { headers: { cookie: cookie(admin) } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { totalTickets: 0 });
  });

  it("validates assignment IDs before calling the service", async () => {
    const bad = await fetch(`${baseUrl}/api/admin/tickets/not-a-uuid/assign`, {
      method: "POST",
      headers: { cookie: cookie(admin), "content-type": "application/json" },
      body: JSON.stringify({ technicianId: "also-not-a-uuid" }),
    });
    assert.equal(bad.status, 400);

    const ticketId = "30000000-0000-4000-8000-000000000001";
    const technicianId = "10000000-0000-4000-8000-000000000004";
    const good = await fetch(`${baseUrl}/api/admin/tickets/${ticketId}/assign`, {
      method: "POST",
      headers: { cookie: cookie(admin), "content-type": "application/json" },
      body: JSON.stringify({ technicianId }),
    });
    assert.equal(good.status, 200);
    assert.equal(assignedTo, technicianId);
  });

  it("rejects blank category names", async () => {
    const response = await fetch(`${baseUrl}/api/admin/categories`, {
      method: "POST",
      headers: { cookie: cookie(admin), "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(response.status, 400);
  });
});
