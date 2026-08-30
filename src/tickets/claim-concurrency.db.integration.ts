import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { CategorySource, PrismaClient, TicketPriority, TicketStatus } from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import { prisma } from "../lib/prisma.js";
import { TechnicianTicketService } from "../services/technician-ticket.service.js";

const studentId = "10000000-0000-4000-8000-000000000001";
const technicianIds = [
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
] as const;
let ticketId: string | undefined;
let otherCategoryId: string | undefined;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database integration tests");
const competitorOne = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const competitorTwo = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

describe("concurrent technician claiming", () => {
  before(async () => {
    const category = await prisma.category.findFirstOrThrow({
      where: { name: "Other", isActive: true },
      select: { id: true },
    });
    const ticket = await prisma.ticket.create({
      data: {
        creatorId: studentId,
        title: "Concurrency claim integration test",
        description: "Temporary ticket used to prove that exactly one simultaneous technician claim succeeds.",
        categoryId: category.id,
        categorySource: CategorySource.USER_SELECTED,
        priority: TicketPriority.MEDIUM,
        aiSuggestedCategoryId: category.id,
        aiSuggestedPriority: TicketPriority.LOW,
        aiSummary: "Original automated recommendation retained for comparison.",
        status: TicketStatus.OPEN,
        location: "Automated integration test",
      },
      select: { id: true },
    });
    ticketId = ticket.id;
    otherCategoryId = category.id;
  });

  after(async () => {
    if (ticketId) await prisma.ticket.deleteMany({ where: { id: ticketId } });
    await competitorOne.$disconnect();
    await competitorTwo.$disconnect();
    await prisma.$disconnect();
  });

  it("allows exactly one winner and returns 409 to the loser", async () => {
    assert.ok(ticketId);
    const firstService = new TechnicianTicketService(competitorOne);
    const secondService = new TechnicianTicketService(competitorTwo);
    const results = await Promise.allSettled([
      firstService.claim(ticketId, technicianIds[0]),
      secondService.claim(ticketId, technicianIds[1]),
    ]);

    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    const loser = failures[0];
    assert.ok(loser?.status === "rejected" && loser.reason instanceof HttpError);
    assert.equal(loser.reason.status, 409);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: {
        status: true,
        assignedTechnicianId: true,
        assignments: { select: { technicianId: true } },
        activities: { where: { type: "TICKET_CLAIMED" }, select: { id: true } },
      },
    });
    assert.equal(ticket.status, TicketStatus.CLAIMED);
    assert.ok(technicianIds.includes(ticket.assignedTechnicianId as typeof technicianIds[number]));
    assert.equal(ticket.assignments.length, 1);
    assert.equal(ticket.activities.length, 1);

    const winnerId = ticket.assignedTechnicianId!;
    const service = new TechnicianTicketService(prisma);
    const started = await service.start(ticketId, winnerId);
    assert.equal(started.status, TicketStatus.IN_PROGRESS);

    const network = await prisma.category.findFirstOrThrow({
      where: { name: "Network", isActive: true },
      select: { id: true },
    });
    const classified = await service.updateClassification(ticketId, winnerId, {
      categoryId: network.id,
      priority: TicketPriority.HIGH,
    });
    assert.equal(classified.categoryId, network.id);
    assert.equal(classified.priority, TicketPriority.HIGH);
    assert.equal(classified.categorySource, CategorySource.TECHNICIAN_OVERRIDE);
    assert.equal(classified.aiSuggestedCategoryId, otherCategoryId);
    assert.equal(classified.aiSuggestedPriority, TicketPriority.LOW);

    const comment = await service.addComment(ticketId, winnerId, "Technician lifecycle integration comment.");
    assert.equal(comment.authorId, winnerId);

    const resolved = await service.resolve(ticketId, winnerId);
    assert.equal(resolved.status, TicketStatus.RESOLVED);
    assert.ok(resolved.resolvedAt);
  });
});
