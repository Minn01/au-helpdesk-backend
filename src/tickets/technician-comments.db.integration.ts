import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { CategorySource, TicketStatus, UserRole } from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import { createPrismaClient } from "../lib/prisma.js";
import { TechnicianTicketService } from "../services/technician-ticket.service.js";

const studentId = randomUUID();
const assignedTechnicianId = randomUUID();
const unrelatedTechnicianId = randomUUID();
const categoryId = randomUUID();
const unassignedTicketId = randomUUID();
const assignedTicketId = randomUUID();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database integration tests");
const prisma = createPrismaClient(connectionString);
const service = new TechnicianTicketService(prisma);

describe("technician comment authorization", () => {
  before(async () => {
    await prisma.user.createMany({
      data: [
        { id: studentId, email: `comment-test-student-${studentId}@au.edu`, displayName: "Comment Test Student", role: UserRole.STUDENT },
        { id: assignedTechnicianId, email: `comment-test-tech1-${assignedTechnicianId}@au.edu`, displayName: "Assigned Comment Technician", role: UserRole.TECHNICIAN },
        { id: unrelatedTechnicianId, email: `comment-test-tech2-${unrelatedTechnicianId}@au.edu`, displayName: "Unrelated Comment Technician", role: UserRole.TECHNICIAN },
      ],
    });
    await prisma.category.create({ data: { id: categoryId, name: `Technician comment test ${randomUUID()}` } });
    await prisma.ticket.createMany({
      data: [
        {
          id: unassignedTicketId,
          creatorId: studentId,
          title: "Unassigned technician comment test",
          description: "An unassigned OPEN queue ticket for technician comment authorization testing.",
          categoryId,
          categorySource: CategorySource.USER_SELECTED,
          status: TicketStatus.OPEN,
        },
        {
          id: assignedTicketId,
          creatorId: studentId,
          title: "Assigned technician comment test",
          description: "An assigned ticket for technician comment authorization testing.",
          categoryId,
          categorySource: CategorySource.USER_SELECTED,
          status: TicketStatus.CLAIMED,
          assignedTechnicianId,
        },
      ],
    });
    await prisma.comment.createMany({
      data: [
        { ticketId: unassignedTicketId, authorId: studentId, body: "Requester comment on the queue ticket." },
        { ticketId: assignedTicketId, authorId: studentId, body: "Requester comment on the assigned ticket." },
      ],
    });
  });

  after(async () => {
    await prisma.ticket.deleteMany({ where: { id: { in: [unassignedTicketId, assignedTicketId] } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [studentId, assignedTechnicianId, unrelatedTechnicianId] } } });
    await prisma.$disconnect();
  });

  it("allows a technician to read comments on an unassigned OPEN queue ticket", async () => {
    const comments = await service.listComments(unassignedTicketId, unrelatedTechnicianId);
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.body, "Requester comment on the queue ticket.");
  });

  it("allows the assigned technician to read comments", async () => {
    const comments = await service.listComments(assignedTicketId, assignedTechnicianId);
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.body, "Requester comment on the assigned ticket.");
  });

  it("hides comments from an unrelated technician", async () => {
    await assert.rejects(
      service.listComments(assignedTicketId, unrelatedTechnicianId),
      (error) => error instanceof HttpError && error.status === 404 && error.code === "TICKET_NOT_FOUND",
    );
  });

  it("does not allow a technician to comment before claiming", async () => {
    await assert.rejects(
      service.addComment(unassignedTicketId, unrelatedTechnicianId, "This must not be written."),
      (error) => error instanceof HttpError && error.status === 404 && error.code === "TICKET_NOT_FOUND",
    );
  });

  it("allows the assigned technician to add a comment", async () => {
    const comment = await service.addComment(assignedTicketId, assignedTechnicianId, "Assigned technician response.");
    assert.equal(comment.authorId, assignedTechnicianId);
    assert.equal(comment.body, "Assigned technician response.");
  });
});
