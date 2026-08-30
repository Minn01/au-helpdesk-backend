import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { CategorySource, TicketPriority, TicketStatus, UserRole } from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import { prisma } from "../lib/prisma.js";
import { AdminManagementService } from "../services/admin-management.service.js";
import { AdminTicketService } from "../services/admin-ticket.service.js";

const ids = {
  student: "10000000-0000-4000-8000-000000000001",
  admin: "10000000-0000-4000-8000-000000000003",
  technicianOne: "10000000-0000-4000-8000-000000000004",
  technicianTwo: "10000000-0000-4000-8000-000000000005",
};
const temporaryUserId = randomUUID();
let ticketId: string | undefined;
let categoryId: string | undefined;
let categoryName: string | undefined;

describe("admin management database behavior", () => {
  const management = new AdminManagementService(prisma);
  const tickets = new AdminTicketService(prisma);

  before(async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { name: "Other" }, select: { id: true } });
    const ticket = await prisma.ticket.create({
      data: {
        creatorId: ids.student,
        title: "Admin assignment integration test",
        description: "Temporary ticket for assignment history validation.",
        categoryId: category.id,
        categorySource: CategorySource.USER_SELECTED,
        priority: TicketPriority.MEDIUM,
        status: TicketStatus.OPEN,
      },
      select: { id: true },
    });
    ticketId = ticket.id;
    await prisma.user.create({
      data: {
        id: temporaryUserId,
        email: `phase6-${temporaryUserId}@au.edu`,
        displayName: "Phase 6 Temporary User",
        role: UserRole.STUDENT,
      },
    });
  });

  after(async () => {
    if (ticketId) await prisma.ticket.deleteMany({ where: { id: ticketId } });
    if (categoryName) {
      await prisma.category.deleteMany({ where: { name: { equals: categoryName, mode: "insensitive" } } });
    } else if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    await prisma.user.deleteMany({ where: { id: temporaryUserId } });
    await prisma.$disconnect();
  });

  it("assigns and reassigns without losing assignment history", async () => {
    assert.ok(ticketId);
    await tickets.assign(ticketId, ids.technicianOne, ids.admin);
    await tickets.assign(ticketId, ids.technicianTwo, ids.admin);
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { assignments: { orderBy: { assignedAt: "asc" } }, activities: true },
    });
    assert.equal(ticket.status, TicketStatus.CLAIMED);
    assert.equal(ticket.assignedTechnicianId, ids.technicianTwo);
    assert.equal(ticket.assignments.length, 2);
    assert.ok(ticket.assignments[0]?.unassignedAt);
    assert.equal(ticket.assignments[1]?.unassignedAt, null);
    assert.deepEqual(ticket.activities.map((activity) => activity.type).sort(), ["TICKET_ASSIGNED", "TICKET_REASSIGNED"]);
  });

  it("enforces case-insensitive category uniqueness and supports disable/re-enable", async () => {
    const name = `Phase 6 ${randomUUID()}`;
    categoryName = name;
    const category = await management.createCategory({ name, description: "Temporary category" });
    categoryId = category.id;
    await assert.rejects(
      management.createCategory({ name: name.toUpperCase(), description: null }),
      (error) => error instanceof HttpError && error.status === 409 && error.code === "CATEGORY_NAME_CONFLICT",
    );
    assert.equal((await management.setCategoryActive(category.id, false)).isActive, false);
    assert.equal((await management.setCategoryActive(category.id, true)).isActive, true);
  });

  it("updates internal roles but protects an administrator from self-lockout", async () => {
    const updated = await management.updateUser(temporaryUserId, { role: UserRole.FACULTY }, ids.admin);
    assert.equal(updated.role, UserRole.FACULTY);
    await assert.rejects(
      management.updateUser(ids.admin, { isActive: false }, ids.admin),
      (error) => error instanceof HttpError && error.status === 409 && error.code === "SELF_LOCKOUT_PROTECTED",
    );
  });
});
