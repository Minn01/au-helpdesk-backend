import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
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
  id: "10000000-0000-4000-8000-000000000001",
  email: "student@au.edu",
  displayName: "Narin Chaiyasit",
  role: UserRole.STUDENT,
  isActive: true,
};
const inactiveFaculty: AuthUser = {
  id: "10000000-0000-4000-8000-000000000099",
  email: "inactive@au.edu",
  displayName: "Inactive Faculty",
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

const listen = async (nodeEnv: "development" | "production") => {
  const server = await new Promise<Server>((resolve) => {
    const candidate = createApp({
      users,
      sessions: createSessionService(secret),
      categories: unusedCategories,
      tickets: unusedTickets,
      technicianTickets: unusedTechnicianTickets,
      adminTickets: {} as never,
      adminManagement: {} as never,
      nodeEnv,
    }).listen(0, "127.0.0.1", () => resolve(candidate));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

describe("development authentication", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    ({ server, baseUrl } = await listen("development"));
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("logs in an existing active user, returns /auth/me, and logs out", async () => {
    const login = await fetch(`${baseUrl}/api/dev/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: activeStudent.id, role: UserRole.ADMIN }),
    });

    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { user: activeStudent });
    const setCookie = login.headers.get("set-cookie");
    if (!setCookie) assert.fail("Login did not set a session cookie");
    assert.ok(setCookie.includes("helpdesk_session="));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";", 1)[0];
    assert.ok(cookie);

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user: activeStudent });

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /helpdesk_session=;/);

    const afterLogout = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(afterLogout.status, 401);
  });

  it("returns 404 for a missing development user", async () => {
    const response = await fetch(`${baseUrl}/api/dev/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "10000000-0000-4000-8000-000000000404" }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "USER_NOT_FOUND",
      message: "Development user not found",
    });
  });

  it("rejects an inactive development user", async () => {
    const response = await fetch(`${baseUrl}/api/dev/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: inactiveFaculty.id }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "ACCOUNT_INACTIVE");
  });

  it("rejects an inactive user whose existing session is otherwise valid", async () => {
    const token = createSessionService(secret).createToken(inactiveFaculty.id);
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `helpdesk_session=${token}` },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "ACCOUNT_INACTIVE");
  });
});

describe("production route configuration", () => {
  it("does not mount development login", async () => {
    const { server, baseUrl } = await listen("production");
    try {
      const response = await fetch(`${baseUrl}/api/dev/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: activeStudent.id }),
      });
      assert.equal(response.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
