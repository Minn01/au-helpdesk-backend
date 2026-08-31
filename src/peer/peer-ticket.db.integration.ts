import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { PeerSourceSystem, TicketPriority, TicketStatus, UserRole } from "../../generated/prisma/client.js";
import { createPrismaClient } from "../lib/prisma.js";
import { PeerTicketService } from "../services/peer-integrations/peer-ticket.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database integration tests");
const firstDatabase = createPrismaClient(connectionString);
const secondDatabase = createPrismaClient(connectionString);
const createdTicketIds: string[] = [];
const studentId = randomUUID();
const studentEmail = `peer-test-student-${studentId}@au.edu`;
let createdCategoryId: string | undefined;

describe("EduCore peer ticket persistence", () => {
  before(async () => {
    await firstDatabase.user.create({
      data: { id: studentId, email: studentEmail, displayName: "Peer Test Student", role: UserRole.STUDENT },
    });
    const category = await firstDatabase.category.findUnique({ where: { name: "Course Registration" } });
    if (!category) {
      const created = await firstDatabase.category.create({
        data: { name: "Course Registration", description: "Temporary peer integration-test category" },
      });
      createdCategoryId = created.id;
    } else if (!category.isActive) {
      throw new Error("Course Registration must be active for the EduCore integration test");
    }
  });

  after(async () => {
    await firstDatabase.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
    await firstDatabase.user.deleteMany({ where: { id: studentId } });
    if (createdCategoryId) await firstDatabase.category.deleteMany({ where: { id: createdCategoryId } });
    await Promise.all([firstDatabase.$disconnect(), secondDatabase.$disconnect()]);
  });

  it("creates one normal OPEN ticket and one reference under simultaneous retries", async () => {
    const student = await firstDatabase.user.findUniqueOrThrow({
      where: { id: studentId },
      select: { email: true, displayName: true },
    });
    const eventId = `peer-integration-${randomUUID()}`;
    const input = {
      eventId,
      student: { email: student.email, name: student.displayName },
      course: { courseCode: "ITX4181", courseName: "Systems Integration" },
      registrationStatus: "FAILED" as const,
      failureReason: "Technical failure during registration processing",
      occurredAt: new Date().toISOString(),
    };
    const [first, second] = await Promise.all([
      new PeerTicketService(firstDatabase).createFromEduCore(input),
      new PeerTicketService(secondDatabase).createFromEduCore(input),
    ]);
    const created = [first, second].filter((result) => result.created);
    assert.equal(created.length, 1);
    assert.equal(first.ticket.id, second.ticket.id);
    createdTicketIds.push(first.ticket.id);

    const ticket = await firstDatabase.ticket.findUniqueOrThrow({
      where: { id: first.ticket.id },
      include: { category: true, activities: true, peerReferences: true },
    });
    assert.equal(ticket.status, TicketStatus.OPEN);
    assert.equal(ticket.priority, TicketPriority.HIGH);
    assert.equal(ticket.category.name, "Course Registration");
    assert.equal(ticket.peerReferences.length, 1);
    assert.equal(ticket.peerReferences[0]?.sourceSystem, PeerSourceSystem.EDUCORE);
    assert.equal(ticket.activities.filter((activity) => activity.type === "PEER_TICKET_CREATED").length, 1);
  });
});
