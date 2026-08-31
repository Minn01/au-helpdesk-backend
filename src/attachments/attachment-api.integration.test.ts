import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { UserRole } from "../../generated/prisma/client.js";
import { createApp } from "../app.js";
import type { AuthUser } from "../auth/auth.types.js";
import { createSessionService } from "../auth/session.service.js";
import type { AttachmentApi } from "../services/attachment.service.js";
import { MAX_ATTACHMENT_BYTES } from "../validation/attachment.validation.js";

const secret = "attachment-api-test-secret-at-least-32-characters";
const user: AuthUser = {
  id: "10000000-0000-4000-8000-000000000001", email: "student@au.edu",
  displayName: "Student", role: UserRole.STUDENT, isActive: true,
};
const ticketId = "30000000-0000-4000-8000-000000000001";
let uploadCalls = 0;
const attachments: AttachmentApi = {
  upload: async (_ticketId, _actor, files) => {
    uploadCalls += 1;
    return files.map((file) => ({ id: "60000000-0000-4000-8000-000000000001", fileName: file.originalname })) as never;
  },
  createUrl: async () => ({ url: "https://signed.invalid", expiresAt: new Date().toISOString() }),
  remove: async () => undefined,
};

describe("attachment multipart API", () => {
  let server: Server;
  let baseUrl: string;
  const cookie = `helpdesk_session=${createSessionService(secret).createToken(user.id)}`;

  before(async () => {
    server = await new Promise<Server>((resolve) => {
      const candidate = createApp({
        users: { findById: async () => user }, sessions: createSessionService(secret), attachments,
        categories: {} as never, tickets: {} as never, technicianTickets: {} as never,
        adminTickets: {} as never, adminManagement: {} as never, nodeEnv: "test",
      }).listen(0, "127.0.0.1", () => resolve(candidate));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  it("accepts multipart files through the authenticated route", async () => {
    const form = new FormData();
    form.append("files", new Blob(["helpdesk notes"], { type: "text/plain" }), "notes.txt");
    const response = await fetch(`${baseUrl}/api/tickets/${ticketId}/attachments`, {
      method: "POST", headers: { cookie }, body: form,
    });
    assert.equal(response.status, 201);
    assert.equal(uploadCalls, 1);
  });

  it("rejects unsupported declared MIME types before the service", async () => {
    const form = new FormData();
    form.append("files", new Blob(["binary"], { type: "application/octet-stream" }), "payload.bin");
    const response = await fetch(`${baseUrl}/api/tickets/${ticketId}/attachments`, {
      method: "POST", headers: { cookie }, body: form,
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json() as { error: string }).error, "UNSUPPORTED_FILE_TYPE");
    assert.equal(uploadCalls, 1);
  });

  it("rejects files over 13 MB in multipart parsing", async () => {
    const form = new FormData();
    form.append("files", new Blob([Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61)], { type: "text/plain" }), "large.txt");
    const response = await fetch(`${baseUrl}/api/tickets/${ticketId}/attachments`, {
      method: "POST", headers: { cookie }, body: form,
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json() as { error: string }).error, "FILE_TOO_LARGE");
    assert.equal(uploadCalls, 1);
  });
});
