import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { CategorySource, TicketPriority, TicketStatus, UserRole } from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import { createPrismaClient } from "../lib/prisma.js";
import { AdminManagementService } from "../services/admin-management.service.js";
import { AdminTicketService } from "../services/admin-ticket.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database integration tests");
const prisma = createPrismaClient(connectionString);

const ids = {
  student: randomUUID(),
  admin: randomUUID(),
  technicianOne: randomUUID(),
  technicianTwo: randomUUID(),
};
const temporaryUserId = randomUUID();
let ticketId: string | undefined;
let fixtureCategoryId: string | undefined;
let categoryId: string | undefined;
let categoryName: string | undefined;

describe("admin management database behavior", () => {
  const management = new AdminManagementService(prisma);
  const tickets = new AdminTicketService(prisma);

  before(async () => {
    await prisma.user.createMany({
      data: [
        { id: ids.student, email: `admin-test-student-${ids.student}@au.edu`, displayName: "Admin Test Student", role: UserRole.STUDENT },
        { id: ids.admin, email: `admin-test-admin-${ids.admin}@au.edu`, displayName: "Admin Test Admin", role: UserRole.ADMIN },
        { id: ids.technicianOne, email: `admin-test-tech1-${ids.technicianOne}@au.edu`, displayName: "Admin Test Technician One", role: UserRole.TECHNICIAN },
        { id: ids.technicianTwo, email: `admin-test-tech2-${ids.technicianTwo}@au.edu`, displayName: "Admin Test Technician Two", role: UserRole.TECHNICIAN },
        { id: temporaryUserId, email: `admin-test-temporary-${temporaryUserId}@au.edu`, displayName: "Admin Test Temporary User", role: UserRole.STUDENT },
      ],
    });
    const category = await prisma.category.create({
      data: { name: `Admin test fixture ${randomUUID()}`, description: "Isolated integration-test category" },
      select: { id: true },
    });
    fixtureCategoryId = category.id;
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
  });

  after(async () => {
    if (ticketId) await prisma.ticket.deleteMany({ where: { id: ticketId } });
    if (categoryName) {
      await prisma.category.deleteMany({ where: { name: { equals: categoryName, mode: "insensitive" } } });
    } else if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    if (fixtureCategoryId) await prisma.category.deleteMany({ where: { id: fixtureCategoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [...Object.values(ids), temporaryUserId] } } });
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
    for (const role of [UserRole.FACULTY, UserRole.TECHNICIAN, UserRole.ADMIN]) {
      const updated = await management.updateUser(temporaryUserId, { role }, ids.admin);
      assert.equal(updated.role, role);
    }
    await assert.rejects(
      management.updateUser(ids.admin, { isActive: false }, ids.admin),
      (error) => error instanceof HttpError && error.status === 409 && error.code === "SELF_LOCKOUT_PROTECTED",
    );
  });
});
