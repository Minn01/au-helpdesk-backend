import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TicketStatus, UserRole } from "../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.types.js";
import { HttpError } from "../errors/http-error.js";
import type { EduCoreClient } from "../services/peer-integrations/educore.client.js";
import { EduCoreContextService } from "../services/peer-integrations/educore-context.service.js";

const ticketId = "30000000-0000-4000-8000-000000000001";
const technician = user("10000000-0000-4000-8000-000000000001", UserRole.TECHNICIAN);
const otherTechnician = user("10000000-0000-4000-8000-000000000002", UserRole.TECHNICIAN);
const admin = user("10000000-0000-4000-8000-000000000003", UserRole.ADMIN);
const student = user("10000000-0000-4000-8000-000000000004", UserRole.STUDENT);

function user(id: string, role: UserRole): AuthUser {
  return { id, role, email: `${id}@au.edu`, displayName: role, isActive: true };
}

const context = {
  studentId: "S123", courseCode: "ITX4181", registrationStatus: "FAILED",
  failureReason: "System error", attemptedAt: "2026-08-31T01:02:03.000Z", additionalContext: null,
};

const harness = (ticket: null | { assignedTechnicianId: string | null; status: TicketStatus; peerReferences: Array<{ externalEventId: string }> }) => {
  let calls = 0;
  const client: EduCoreClient = { getRegistrationContext: async () => { calls += 1; return context; } };
  const database = { ticket: { findUnique: async () => ticket } };
  return { service: new EduCoreContextService(database as never, client), calls: () => calls };
};

const errorCode = async (promise: Promise<unknown>) => {
  try { await promise; assert.fail("Expected an HttpError"); } catch (error) {
    assert.ok(error instanceof HttpError);
    return error.code;
  }
};

describe("EduCore diagnostic context authorization", () => {
  const assignedTicket = { assignedTechnicianId: technician.id, status: TicketStatus.IN_PROGRESS, peerReferences: [{ externalEventId: "event-1" }] };

  it("does not allow requesters to fetch internal peer context", async () => {
    const { service, calls } = harness(assignedTicket);
    assert.equal(await errorCode(service.getForTicket(ticketId, student)), "FORBIDDEN");
    assert.equal(calls(), 0);
  });

  it("allows the assigned technician", async () => {
    const { service, calls } = harness(assignedTicket);
    assert.equal((await service.getForTicket(ticketId, technician)).courseCode, "ITX4181");
    assert.equal(calls(), 1);
  });

  it("rejects an unrelated technician", async () => {
    const { service, calls } = harness(assignedTicket);
    assert.equal(await errorCode(service.getForTicket(ticketId, otherTechnician)), "FORBIDDEN");
    assert.equal(calls(), 0);
  });

  it("allows an administrator", async () => {
    const { service } = harness(assignedTicket);
    assert.equal((await service.getForTicket(ticketId, admin)).registrationStatus, "FAILED");
  });

  it("does not use an unrelated ticket as an arbitrary EduCore proxy", async () => {
    const { service, calls } = harness({ ...assignedTicket, peerReferences: [] });
    assert.equal(await errorCode(service.getForTicket(ticketId, admin)), "EDUCORE_CONTEXT_NOT_AVAILABLE");
    assert.equal(calls(), 0);
  });
});
