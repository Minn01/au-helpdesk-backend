import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { UserRole } from "../../generated/prisma/client.js";
import { createApp } from "../app.js";
import type { AuthUser } from "./auth.types.js";
import type { MicrosoftIdentity } from "./microsoft-auth.service.js";
import { createOAuthStateService } from "./oauth-state.service.js";
import { createSessionService } from "./session.service.js";

const secret = "microsoft-auth-test-secret-at-least-32-characters";
const config = {
  tenantId: "20000000-0000-4000-8000-000000000001",
  clientId: "20000000-0000-4000-8000-000000000002",
  clientSecret: "not-used-by-mocked-client",
  redirectUri: "http://127.0.0.1/api/auth/microsoft/callback",
  frontendUrl: "http://frontend.test/helpdesk",
};
const activeUser: AuthUser = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "student@au.edu",
  displayName: "Student",
  role: UserRole.STUDENT,
  isActive: true,
};
const identity: MicrosoftIdentity = {
  tenantId: config.tenantId,
  objectId: "20000000-0000-4000-8000-000000000003",
  email: activeUser.email,
  displayName: activeUser.displayName,
};

describe("Microsoft application authentication", () => {
  let server: Server;
  let baseUrl: string;
  let issuedState = "";
  let issuedNonce = "";
  let exchangeCount = 0;
  let inactive = false;
  const sessions = createSessionService(secret);

  before(async () => {
    server = await new Promise<Server>((resolve) => {
      const candidate = createApp({
        users: { findById: async (id) => id === activeUser.id ? activeUser : null },
        sessions,
        categories: { listActive: async () => [] },
        tickets: {} as never,
        technicianTickets: {} as never,
        adminTickets: {} as never,
        adminManagement: {} as never,
        microsoft: {
          config,
          oauth: {
            authorizationUrl: async (state, nonce) => {
              issuedState = state;
              issuedNonce = nonce;
              return `https://login.microsoftonline.com/test/authorize?state=${encodeURIComponent(state)}`;
            },
            exchangeCode: async (code, nonce) => {
              exchangeCount += 1;
              assert.equal(code, "valid-code");
              assert.equal(nonce, issuedNonce);
              return identity;
            },
          },
          users: { findOrCreate: async () => ({ id: activeUser.id, isActive: !inactive }) },
          state: createOAuthStateService(secret),
          sessions,
          isProduction: false,
        },
        nodeEnv: "test",
      }).listen(0, "127.0.0.1", () => resolve(candidate));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const begin = async () => {
    const response = await fetch(`${baseUrl}/api/auth/microsoft`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /^https:\/\/login\.microsoftonline\.com\//);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    return cookie;
  };

  it("validates state, establishes the HelpDesk session, restores it, and logs out", async () => {
    const stateCookie = await begin();
    const callback = await fetch(`${baseUrl}/api/auth/microsoft/callback?code=valid-code&state=${encodeURIComponent(issuedState)}`, {
      headers: { cookie: stateCookie },
      redirect: "manual",
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), `${config.frontendUrl}/dashboard`);
    const cookies = callback.headers.getSetCookie();
    const sessionCookie = cookies.find((value) => value.startsWith("helpdesk_session="))?.split(";", 1)[0];
    assert.ok(sessionCookie);
    assert.ok(cookies.some((value) => value.startsWith("helpdesk_microsoft_state=;")));

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: sessionCookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user: activeUser });
    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: sessionCookie } });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /helpdesk_session=;/);
  });

  it("rejects a mismatched state without exchanging a code", async () => {
    const stateCookie = await begin();
    const before = exchangeCount;
    const callback = await fetch(`${baseUrl}/api/auth/microsoft/callback?code=valid-code&state=wrong-state`, {
      headers: { cookie: stateCookie },
      redirect: "manual",
    });
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get("location") ?? "", /authError=INVALID_OAUTH_STATE/);
    assert.equal(exchangeCount, before);
  });

  it("does not issue a session for an inactive HelpDesk user", async () => {
    inactive = true;
    const stateCookie = await begin();
    const callback = await fetch(`${baseUrl}/api/auth/microsoft/callback?code=valid-code&state=${encodeURIComponent(issuedState)}`, {
      headers: { cookie: stateCookie },
      redirect: "manual",
    });
    inactive = false;
    assert.match(callback.headers.get("location") ?? "", /authError=ACCOUNT_INACTIVE/);
    assert.ok(!callback.headers.getSetCookie().some((value) => value.startsWith("helpdesk_session=")));
  });
});
