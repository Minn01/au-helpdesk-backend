import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CategorySource,
  PrismaClient,
  TicketPriority,
  TicketStatus,
  UserRole,
} from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the development database");
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed is disabled when NODE_ENV=production");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const ids = {
  users: {
    student: "10000000-0000-4000-8000-000000000001",
    faculty: "10000000-0000-4000-8000-000000000002",
    admin: "10000000-0000-4000-8000-000000000003",
    technicianOne: "10000000-0000-4000-8000-000000000004",
    technicianTwo: "10000000-0000-4000-8000-000000000005",
  },
  tickets: {
    open: "30000000-0000-4000-8000-000000000001",
    claimed: "30000000-0000-4000-8000-000000000002",
    inProgress: "30000000-0000-4000-8000-000000000003",
    resolved: "30000000-0000-4000-8000-000000000004",
    closed: "30000000-0000-4000-8000-000000000005",
    cancelled: "30000000-0000-4000-8000-000000000006",
  },
} as const;

const categories = [
  ["Network", "Wi-Fi, wired network, and connectivity issues"],
  ["Hardware", "University-owned computers and peripheral hardware"],
  ["Software", "Applications, licensing, and installation support"],
  ["University Account", "University identity and account access"],
  ["Course Registration", "Technical issues affecting course registration"],
  ["Printer", "Campus printing and printer problems"],
  ["Classroom Equipment", "Teaching-room displays, audio, and control systems"],
  ["Other", "Requests that do not match another active category"],
] as const;

const seed = async () => {
  const categoryByName = new Map<string, string>();

  for (const [name, description] of categories) {
    const category = await prisma.category.upsert({
      where: { name },
      update: { description, isActive: true },
      create: { name, description },
    });
    categoryByName.set(name, category.id);
  }

  const users = [
    { id: ids.users.student, email: "student@au.edu", displayName: "Narin Chaiyasit", role: UserRole.STUDENT },
    { id: ids.users.faculty, email: "faculty@au.edu", displayName: "Dr. Mali Sutham", role: UserRole.FACULTY },
    { id: ids.users.admin, email: "helpdesk.admin@au.edu", displayName: "Pimchanok Arun", role: UserRole.ADMIN },
    { id: ids.users.technicianOne, email: "tech.anurak@au.edu", displayName: "Anurak Kiet", role: UserRole.TECHNICIAN },
    { id: ids.users.technicianTwo, email: "tech.siriporn@au.edu", displayName: "Siriporn Meechai", role: UserRole.TECHNICIAN },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { email: user.email, displayName: user.displayName, role: user.role, isActive: true },
      create: user,
    });
  }

  const categoryId = (name: string) => {
    const id = categoryByName.get(name);
    if (!id) throw new Error(`Seed category not found: ${name}`);
    return id;
  };

  const tickets = [
    {
      id: ids.tickets.open,
      creatorId: ids.users.student,
      title: "Cannot connect to campus Wi-Fi in library",
      description: "The university Wi-Fi repeatedly asks me to sign in and disconnects on the third floor.",
      categoryId: categoryId("Network"),
      categorySource: CategorySource.USER_SELECTED,
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.OPEN,
      location: "Main Library, Floor 3",
    },
    {
      id: ids.tickets.claimed,
      creatorId: ids.users.faculty,
      title: "Lecture hall projector has no signal",
      description: "The projector reports no HDMI signal even after reconnecting the lectern cable.",
      categoryId: categoryId("Classroom Equipment"),
      categorySource: CategorySource.USER_SELECTED,
      priority: TicketPriority.HIGH,
      status: TicketStatus.CLAIMED,
      location: "CL Building, Room 401",
      assignedTechnicianId: ids.users.technicianOne,
    },
    {
      id: ids.tickets.inProgress,
      creatorId: ids.users.student,
      title: "Course registration fails at final confirmation",
      description: "Registration returns a system error after I confirm section CSX3002.",
      categoryId: categoryId("Course Registration"),
      categorySource: CategorySource.AI_SUGGESTED,
      priority: TicketPriority.URGENT,
      status: TicketStatus.IN_PROGRESS,
      location: "Online",
      assignedTechnicianId: ids.users.technicianTwo,
      aiSuggestedCategoryId: categoryId("Course Registration"),
      aiSuggestedPriority: TicketPriority.HIGH,
      aiSummary: "Student cannot complete course registration because final confirmation returns a system error.",
    },
    {
      id: ids.tickets.resolved,
      creatorId: ids.users.faculty,
      title: "Microsoft account locked",
      description: "My university Microsoft account was locked after a password change.",
      categoryId: categoryId("University Account"),
      categorySource: CategorySource.AI_SUGGESTED,
      priority: TicketPriority.HIGH,
      status: TicketStatus.RESOLVED,
      location: "Faculty Office, VME 210",
      assignedTechnicianId: ids.users.technicianOne,
      aiSuggestedCategoryId: categoryId("University Account"),
      aiSuggestedPriority: TicketPriority.HIGH,
      aiSummary: "Faculty member needs account recovery after a password-change lockout.",
      resolvedAt: new Date("2026-08-25T08:30:00.000Z"),
    },
    {
      id: ids.tickets.closed,
      creatorId: ids.users.student,
      title: "Printer charged credit but did not print",
      description: "The library printer deducted my balance but the job remained queued.",
      categoryId: categoryId("Printer"),
      categorySource: CategorySource.TECHNICIAN_OVERRIDE,
      priority: TicketPriority.LOW,
      status: TicketStatus.CLOSED,
      location: "Main Library, Floor 1",
      assignedTechnicianId: ids.users.technicianTwo,
      aiSuggestedCategoryId: categoryId("Other"),
      aiSuggestedPriority: TicketPriority.LOW,
      aiSummary: "A print job failed after student credit was deducted.",
      resolvedAt: new Date("2026-08-20T04:00:00.000Z"),
      closedAt: new Date("2026-08-21T03:00:00.000Z"),
    },
    {
      id: ids.tickets.cancelled,
      creatorId: ids.users.student,
      title: "Need software installed on personal laptop",
      description: "I thought a lab application was missing, but found the university download instructions.",
      categoryId: categoryId("Software"),
      categorySource: CategorySource.USER_SELECTED,
      priority: TicketPriority.LOW,
      status: TicketStatus.CANCELLED,
      location: "Online",
      cancelledAt: new Date("2026-08-22T06:00:00.000Z"),
    },
  ];

  for (const ticket of tickets) {
    await prisma.ticket.upsert({
      where: { id: ticket.id },
      update: ticket,
      create: ticket,
    });
  }

  const assignments = [
    ["40000000-0000-4000-8000-000000000001", ids.tickets.claimed, ids.users.technicianOne, ids.users.technicianOne, null],
    ["40000000-0000-4000-8000-000000000002", ids.tickets.inProgress, ids.users.technicianOne, ids.users.admin, new Date("2026-08-24T03:00:00.000Z")],
    ["40000000-0000-4000-8000-000000000003", ids.tickets.inProgress, ids.users.technicianTwo, ids.users.admin, null],
    ["40000000-0000-4000-8000-000000000004", ids.tickets.resolved, ids.users.technicianOne, ids.users.technicianOne, null],
    ["40000000-0000-4000-8000-000000000005", ids.tickets.closed, ids.users.technicianTwo, ids.users.admin, null],
  ] as const;

  for (const [id, ticketId, technicianId, assignedById, unassignedAt] of assignments) {
    await prisma.ticketAssignment.upsert({
      where: { id },
      update: { ticketId, technicianId, assignedById, unassignedAt },
      create: { id, ticketId, technicianId, assignedById, unassignedAt },
    });
  }

  const comments = [
    ["50000000-0000-4000-8000-000000000001", ids.tickets.claimed, ids.users.technicianOne, "I have claimed this ticket and will test the lectern connection before the next class."],
    ["50000000-0000-4000-8000-000000000002", ids.tickets.inProgress, ids.users.student, "The error also occurs in a private browser window."],
    ["50000000-0000-4000-8000-000000000003", ids.tickets.inProgress, ids.users.technicianTwo, "We are checking the registration service logs for this section."],
    ["50000000-0000-4000-8000-000000000004", ids.tickets.resolved, ids.users.technicianOne, "Your account was unlocked. Please sign in again and confirm access."],
  ] as const;

  for (const [id, ticketId, authorId, body] of comments) {
    await prisma.comment.upsert({
      where: { id },
      update: { ticketId, authorId, body },
      create: { id, ticketId, authorId, body },
    });
  }

  const activities = [
    ["60000000-0000-4000-8000-000000000001", ids.tickets.open, ids.users.student, "TICKET_CREATED", "Ticket created", { categorySource: "USER_SELECTED" }],
    ["60000000-0000-4000-8000-000000000002", ids.tickets.claimed, ids.users.technicianOne, "TICKET_CLAIMED", "Ticket claimed by Anurak Kiet", { fromStatus: "OPEN", toStatus: "CLAIMED" }],
    ["60000000-0000-4000-8000-000000000003", ids.tickets.inProgress, null, "AI_CLASSIFIED", "Category and priority suggestions recorded", { suggestedCategory: "Course Registration", suggestedPriority: "HIGH" }],
    ["60000000-0000-4000-8000-000000000004", ids.tickets.inProgress, ids.users.admin, "TICKET_REASSIGNED", "Ticket reassigned to Siriporn Meechai", { previousTechnicianId: ids.users.technicianOne, technicianId: ids.users.technicianTwo }],
    ["60000000-0000-4000-8000-000000000005", ids.tickets.resolved, ids.users.technicianOne, "STATUS_CHANGED", "Ticket resolved", { fromStatus: "IN_PROGRESS", toStatus: "RESOLVED" }],
    ["60000000-0000-4000-8000-000000000006", ids.tickets.closed, ids.users.technicianTwo, "CATEGORY_CHANGED", "Category corrected to Printer", { fromCategory: "Other", toCategory: "Printer", source: "TECHNICIAN_OVERRIDE" }],
    ["60000000-0000-4000-8000-000000000007", ids.tickets.cancelled, ids.users.student, "TICKET_CANCELLED", "Ticket cancelled by requester", { fromStatus: "OPEN", toStatus: "CANCELLED" }],
  ] as const;

  for (const [id, ticketId, actorId, type, message, metadata] of activities) {
    await prisma.ticketActivity.upsert({
      where: { id },
      update: { ticketId, actorId, type, message, metadata },
      create: { id, ticketId, actorId, type, message, metadata },
    });
  }

  console.log(`Seeded ${users.length} users, ${categories.length} categories, and ${tickets.length} tickets.`);
};

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
