import {
  CategorySource,
  type Prisma,
  type PrismaClient,
  TicketStatus,
  UserRole,
  type TicketPriority,
} from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import type { MineFilters } from "./ticket.service.js";

const userSelect = { id: true, displayName: true, role: true } as const;
const categorySelect = { id: true, name: true, description: true } as const;
const listSelect = {
  id: true,
  ticketNumber: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  location: true,
  createdAt: true,
  updatedAt: true,
  category: { select: categorySelect },
  creator: { select: userSelect },
  assignedTechnician: { select: userSelect },
  aiSuggestedCategory: { select: categorySelect },
  aiSuggestedPriority: true,
  aiSummary: true,
  _count: { select: { comments: true, attachments: true } },
} as const;
const detailInclude = {
  category: { select: categorySelect },
  aiSuggestedCategory: { select: categorySelect },
  creator: { select: userSelect },
  assignedTechnician: { select: userSelect },
  comments: { orderBy: { createdAt: "asc" as const }, include: { author: { select: userSelect } } },
  attachments: { orderBy: { createdAt: "asc" as const }, include: { uploadedBy: { select: userSelect } } },
  assignments: {
    orderBy: { assignedAt: "asc" as const },
    include: {
      technician: { select: userSelect },
      assignedBy: { select: userSelect },
    },
  },
  activities: { orderBy: { createdAt: "asc" as const }, include: { actor: { select: userSelect } } },
} as const;

const searchWhere = (search: string | undefined): Prisma.TicketWhereInput => search ? {
  OR: [
    { ticketNumber: { contains: search, mode: "insensitive" } },
    { title: { contains: search, mode: "insensitive" } },
    { description: { contains: search, mode: "insensitive" } },
    { location: { contains: search, mode: "insensitive" } },
  ],
} : {};

export class TechnicianTicketService {
  constructor(private readonly database: PrismaClient) {}

  listQueue(filters: MineFilters) {
    return this.list({
      status: TicketStatus.OPEN,
      assignedTechnicianId: null,
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...searchWhere(filters.search),
    }, filters);
  }

  listAssigned(technicianId: string, filters: MineFilters) {
    return this.list({
      assignedTechnicianId: technicianId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...searchWhere(filters.search),
    }, filters);
  }

  async getRelevantDetails(ticketId: string, technicianId: string) {
    const ticket = await this.database.ticket.findFirst({
      where: {
        id: ticketId,
        OR: [
          { status: TicketStatus.OPEN, assignedTechnicianId: null },
          { assignedTechnicianId: technicianId },
        ],
      },
      include: detailInclude,
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    return ticket;
  }

  async claim(ticketId: string, technicianId: string) {
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveTechnician(transaction, technicianId);
      const claimed = await transaction.ticket.updateMany({
        where: { id: ticketId, status: TicketStatus.OPEN, assignedTechnicianId: null },
        data: { assignedTechnicianId: technicianId, status: TicketStatus.CLAIMED },
      });
      if (claimed.count !== 1) {
        throw new HttpError(409, "TICKET_NOT_CLAIMABLE", "Ticket is no longer available to claim");
      }
      await transaction.ticketAssignment.create({
        data: { ticketId, technicianId, assignedById: technicianId },
      });
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: technicianId,
          type: "TICKET_CLAIMED",
          message: "Ticket claimed by technician",
          metadata: { fromStatus: TicketStatus.OPEN, toStatus: TicketStatus.CLAIMED, technicianId },
        },
      });
      return transaction.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: detailInclude });
    });
  }

  start(ticketId: string, technicianId: string) {
    return this.transition(ticketId, technicianId, TicketStatus.CLAIMED, TicketStatus.IN_PROGRESS);
  }

  resolve(ticketId: string, technicianId: string) {
    return this.transition(ticketId, technicianId, TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED);
  }

  async updateClassification(
    ticketId: string,
    technicianId: string,
    input: { categoryId?: string | undefined; priority?: TicketPriority | undefined },
  ) {
    if (input.categoryId) {
      const category = await this.database.category.findFirst({
        where: { id: input.categoryId, isActive: true },
        select: { id: true },
      });
      if (!category) throw new HttpError(400, "INVALID_CATEGORY", "Category is not active or does not exist");
    }
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveTechnician(transaction, technicianId);
      const current = await transaction.ticket.findFirst({
        where: {
          id: ticketId,
          assignedTechnicianId: technicianId,
          status: { in: [TicketStatus.CLAIMED, TicketStatus.IN_PROGRESS] },
        },
        select: { id: true, categoryId: true, priority: true },
      });
      if (!current) {
        throw new HttpError(409, "TICKET_NOT_EDITABLE", "Only assigned active tickets can be reclassified");
      }
      const result = await transaction.ticket.updateMany({
        where: {
          id: ticketId,
          assignedTechnicianId: technicianId,
          status: { in: [TicketStatus.CLAIMED, TicketStatus.IN_PROGRESS] },
        },
        data: {
          ...(input.categoryId ? { categoryId: input.categoryId, categorySource: CategorySource.TECHNICIAN_OVERRIDE } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
        },
      });
      if (result.count !== 1) {
        throw new HttpError(409, "TICKET_NOT_EDITABLE", "Only assigned active tickets can be reclassified");
      }
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: technicianId,
          type: "CLASSIFICATION_CHANGED",
          message: "Ticket classification updated by technician",
          metadata: {
            previousCategoryId: current.categoryId,
            categoryId: input.categoryId ?? current.categoryId,
            previousPriority: current.priority,
            priority: input.priority ?? current.priority,
          },
        },
      });
      return transaction.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: detailInclude });
    });
  }

  async listComments(ticketId: string, technicianId: string) {
    await this.assertAssigned(ticketId, technicianId);
    return this.database.comment.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: userSelect } },
    });
  }

  async addComment(ticketId: string, technicianId: string, body: string) {
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveTechnician(transaction, technicianId);
      const ticket = await transaction.ticket.findFirst({
        where: { id: ticketId, assignedTechnicianId: technicianId },
        select: { id: true },
      });
      if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
      const comment = await transaction.comment.create({
        data: { ticketId, authorId: technicianId, body },
        include: { author: { select: userSelect } },
      });
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: technicianId,
          type: "COMMENT_ADDED",
          message: "Technician added a comment",
          metadata: { commentId: comment.id },
        },
      });
      return comment;
    });
  }

  private async list(where: Prisma.TicketWhereInput, filters: MineFilters) {
    const [tickets, total] = await this.database.$transaction([
      this.database.ticket.findMany({
        where,
        select: listSelect,
        orderBy: [{ createdAt: filters.sort === "newest" ? "desc" : "asc" }, { id: "asc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.database.ticket.count({ where }),
    ]);
    return {
      tickets,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
    };
  }

  private async transition(
    ticketId: string,
    technicianId: string,
    fromStatus: TicketStatus,
    toStatus: TicketStatus,
  ) {
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveTechnician(transaction, technicianId);
      const result = await transaction.ticket.updateMany({
        where: { id: ticketId, assignedTechnicianId: technicianId, status: fromStatus },
        data: {
          status: toStatus,
          ...(toStatus === TicketStatus.RESOLVED ? { resolvedAt: new Date() } : {}),
        },
      });
      if (result.count !== 1) {
        throw new HttpError(409, "INVALID_TICKET_TRANSITION", `Ticket must be ${fromStatus} and assigned to you`);
      }
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: technicianId,
          type: "STATUS_CHANGED",
          message: `Ticket moved from ${fromStatus} to ${toStatus}`,
          metadata: { fromStatus, toStatus },
        },
      });
      return transaction.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: detailInclude });
    });
  }

  private async assertAssigned(ticketId: string, technicianId: string) {
    const ticket = await this.database.ticket.findFirst({
      where: { id: ticketId, assignedTechnicianId: technicianId },
      select: { id: true },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  }

  private async assertActiveTechnician(transaction: Prisma.TransactionClient, technicianId: string) {
    const technician = await transaction.user.findFirst({
      where: { id: technicianId, role: UserRole.TECHNICIAN, isActive: true },
      select: { id: true },
    });
    if (!technician) throw new HttpError(403, "FORBIDDEN", "An active technician account is required");
  }
}

export type TechnicianTicketApi = Pick<
  TechnicianTicketService,
  | "listQueue"
  | "listAssigned"
  | "getRelevantDetails"
  | "claim"
  | "start"
  | "resolve"
  | "updateClassification"
  | "listComments"
  | "addComment"
>;
