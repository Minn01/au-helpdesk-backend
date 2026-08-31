import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import { HttpError } from "../errors/http-error.js";
import type { PeerTicketApi } from "../services/peer-integrations/peer-ticket.service.js";

const apiKey = "helpdesk-peer-api-test-key-at-least-32-chars";
const payload = {
  eventId: "registration-failure-abc123",
  student: { email: "student@au.edu", name: "Student Name" },
  course: { courseCode: "ITX4181", courseName: "Systems Integration" },
  registrationStatus: "FAILED",
  failureReason: "System error while processing registration",
  occurredAt: "2026-08-31T01:02:03.000Z",
};
let calls = 0;
const tickets: PeerTicketApi = {
  createFromEduCore: async (input) => {
    calls += 1;
    if (input.student.email === "missing@au.edu") throw new HttpError(404, "STUDENT_NOT_FOUND", "No matching student");
    return {
      ticket: { id: "30000000-0000-4000-8000-000000000001", ticketNumber: "HD-000123", status: "OPEN" },
      created: input.eventId !== "replay-event",
    } as never;
  },
};

describe("EduCore incoming peer API", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = await new Promise<Server>((resolve) => {
      const candidate = createApp({
        users: {} as never, sessions: {} as never, categories: {} as never, tickets: {} as never,
        technicianTickets: {} as never, adminTickets: {} as never, adminManagement: {} as never,
        attachments: {} as never,
        peer: { apiKey, tickets, context: {} as never },
        nodeEnv: "test",
      }).listen(0, "127.0.0.1", () => resolve(candidate));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const post = (body: unknown, key?: string) => fetch(`${baseUrl}/api/peer/educore/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    body: JSON.stringify(body),
  });

  it("rejects missing and incorrect x-api-key headers", async () => {
    const missing = await post(payload);
    assert.equal(missing.status, 401);
    assert.equal((await missing.json() as { error: string }).error, "INVALID_PEER_API_KEY");
    const invalid = await post(payload, "incorrect-peer-key");
    assert.equal(invalid.status, 401);
    assert.equal(calls, 0);
  });

  it("accepts a valid key and validated payload", async () => {
    const response = await post(payload, apiKey);
    assert.equal(response.status, 201);
    assert.equal((await response.json() as { created: boolean }).created, true);
  });

  it("rejects invalid payloads", async () => {
    const response = await post({ ...payload, eventId: "../unsafe", registrationStatus: "SUCCESS" }, apiKey);
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error: string }).error, "VALIDATION_ERROR");
  });

  it("returns a stable unknown-student error", async () => {
    const response = await post({ ...payload, eventId: "unknown-student", student: { ...payload.student, email: "missing@au.edu" } }, apiKey);
    assert.equal(response.status, 404);
    assert.equal((await response.json() as { error: string }).error, "STUDENT_NOT_FOUND");
  });

  it("returns 200 and created=false for an idempotent replay", async () => {
    const response = await post({ ...payload, eventId: "replay-event" }, apiKey);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { created: boolean }).created, false);
  });
});
