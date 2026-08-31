import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TicketStatus, UserRole } from "../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.types.js";
import { HttpError } from "../errors/http-error.js";
import { AttachmentService } from "../services/attachment.service.js";
import type { StorageService, StoredFile } from "../storage/storage.service.js";
import { MAX_ATTACHMENT_BYTES, validateAttachmentFile } from "../validation/attachment.validation.js";

const ticketId = "30000000-0000-4000-8000-000000000001";
const attachmentId = "60000000-0000-4000-8000-000000000001";
const requester = user("10000000-0000-4000-8000-000000000001", UserRole.STUDENT);
const otherRequester = user("10000000-0000-4000-8000-000000000002", UserRole.STUDENT);
const technician = user("10000000-0000-4000-8000-000000000003", UserRole.TECHNICIAN);
const admin = user("10000000-0000-4000-8000-000000000004", UserRole.ADMIN);

function user(id: string, role: UserRole): AuthUser {
  return { id, role, email: `${id}@au.edu`, displayName: role, isActive: true };
}

const textFile = (name = "notes.txt", body = Buffer.from("printer makes a grinding noise")): Express.Multer.File => ({
  fieldname: "files", originalname: name, encoding: "7bit", mimetype: "text/plain",
  size: body.length, buffer: body, destination: "", filename: "", path: "", stream: undefined as never,
});

type Ticket = { creatorId: string; assignedTechnicianId: string | null; status: TicketStatus };

const harness = (options: {
  ticket?: Ticket | null;
  attachment?: { id: string; fileName: string; storagePath: string; mimeType: string; uploadedById: string } | null;
  failUploadAt?: number;
  failMetadata?: boolean;
} = {}) => {
  const ticket = options.ticket === undefined
    ? { creatorId: requester.id, assignedTechnicianId: null, status: TicketStatus.OPEN }
    : options.ticket;
  const attachment = options.attachment === undefined
    ? { id: attachmentId, fileName: "notes.txt", storagePath: `tickets/${ticketId}/generated-notes.txt`, mimeType: "text/plain", uploadedById: requester.id }
    : options.attachment;
  const storageState = { uploads: [] as string[], removals: [] as string[], signed: [] as string[], downloads: [] as string[] };
  let uploadCount = 0;
  const storage: StorageService = {
    upload: async (path) => {
      uploadCount += 1;
      if (options.failUploadAt === uploadCount) throw new Error("storage unavailable");
      storageState.uploads.push(path);
    },
    download: async (path) => { storageState.downloads.push(path); return { body: Buffer.from("backup"), contentType: "text/plain" }; },
    remove: async (path) => { storageState.removals.push(path); },
    createSignedUrl: async (path) => { storageState.signed.push(path); return "https://signed.invalid/object"; },
  };
  const database = {
    ticket: { findUnique: async () => ticket },
    attachment: {
      findFirst: async () => attachment,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.failMetadata) throw new Error("database unavailable");
        return {
          id: attachmentId, fileName: data.fileName, mimeType: data.mimeType, sizeBytes: data.sizeBytes,
          createdAt: new Date(), uploadedBy: { id: requester.id, displayName: requester.displayName, role: requester.role },
        };
      },
      deleteMany: async () => ({ count: attachment ? 1 : 0 }),
    },
    ticketActivity: { create: async () => ({}) },
    $transaction: async (callback: (transaction: unknown) => unknown) => callback(database),
  };
  return { service: new AttachmentService(database as never, storage), storageState };
};

const errorCode = async (promise: Promise<unknown>) => {
  try { await promise; assert.fail("Expected an HttpError"); } catch (error) {
    assert.ok(error instanceof HttpError);
    return error.code;
  }
};

describe("attachment validation", () => {
  it("accepts allowed MIME content and sanitizes the display filename", () => {
    const result = validateAttachmentFile(textFile("../../classroom notes.txt"));
    assert.equal(result.mimeType, "text/plain");
    assert.equal(result.fileName, "classroom notes.txt");
  });

  it("rejects an unsupported MIME type", () => {
    const file = { ...textFile("payload.exe"), mimetype: "application/octet-stream" };
    assert.throws(() => validateAttachmentFile(file), (error: unknown) => error instanceof HttpError && error.code === "UNSUPPORTED_FILE_TYPE");
  });

  it("rejects files over 13 MB", () => {
    const file = textFile("large.txt", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61));
    assert.throws(() => validateAttachmentFile(file), (error: unknown) => error instanceof HttpError && error.code === "FILE_TOO_LARGE");
  });

  it("rejects declared MIME types that do not match file content", () => {
    const file = { ...textFile("fake.png"), mimetype: "image/png" };
    assert.throws(() => validateAttachmentFile(file), (error: unknown) => error instanceof HttpError && error.code === "UNSUPPORTED_FILE_TYPE");
  });
});

describe("attachment service authorization and consistency", () => {
  it("allows a requester to upload to their own active ticket", async () => {
    const { service, storageState } = harness();
    const result = await service.upload(ticketId, requester, [textFile()]);
    assert.equal(result.length, 1);
    assert.equal(storageState.uploads.length, 1);
    assert.match(storageState.uploads[0]!, new RegExp(`^tickets/${ticketId}/[0-9a-f-]+-notes\\.txt$`));
  });

  it("prevents a requester viewing another requester's attachment", async () => {
    const { service } = harness();
    assert.equal(await errorCode(service.createUrl(ticketId, attachmentId, otherRequester)), "ATTACHMENT_ACCESS_DENIED");
  });

  it("prevents requester removal after the ticket leaves OPEN", async () => {
    const { service } = harness({ ticket: { creatorId: requester.id, assignedTechnicianId: technician.id, status: TicketStatus.CLAIMED } });
    assert.equal(await errorCode(service.remove(ticketId, attachmentId, requester)), "ATTACHMENT_ACCESS_DENIED");
  });

  it("allows the assigned technician to upload while active", async () => {
    const { service } = harness({ ticket: { creatorId: requester.id, assignedTechnicianId: technician.id, status: TicketStatus.IN_PROGRESS } });
    assert.equal((await service.upload(ticketId, technician, [textFile()])).length, 1);
  });

  it("rejects an unassigned technician upload", async () => {
    const { service } = harness();
    assert.equal(await errorCode(service.upload(ticketId, technician, [textFile()])), "ATTACHMENT_ACCESS_DENIED");
  });

  it("allows an administrator to view any ticket attachment", async () => {
    const { service } = harness();
    const result = await service.createUrl(ticketId, attachmentId, admin);
    assert.equal(result.url, "https://signed.invalid/object");
  });

  it("distinguishes an invalid ticket from a missing attachment", async () => {
    const invalid = harness({ ticket: null, attachment: null });
    assert.equal(await errorCode(invalid.service.createUrl(ticketId, attachmentId, requester)), "TICKET_NOT_FOUND");
    const missing = harness({ attachment: null });
    assert.equal(await errorCode(missing.service.createUrl(ticketId, attachmentId, requester)), "ATTACHMENT_NOT_FOUND");
  });

  it("cleans up earlier objects when a multi-file storage upload fails", async () => {
    const { service, storageState } = harness({ failUploadAt: 2 });
    assert.equal(await errorCode(service.upload(ticketId, requester, [textFile("one.txt"), textFile("two.txt")])), "ATTACHMENT_UPLOAD_FAILED");
    assert.equal(storageState.uploads.length, 1);
    assert.deepEqual(storageState.removals, storageState.uploads);
  });

  it("cleans up storage when database metadata creation fails", async () => {
    const { service, storageState } = harness({ failMetadata: true });
    assert.equal(await errorCode(service.upload(ticketId, requester, [textFile()])), "ATTACHMENT_UPLOAD_FAILED");
    assert.deepEqual(storageState.removals, storageState.uploads);
  });
});
