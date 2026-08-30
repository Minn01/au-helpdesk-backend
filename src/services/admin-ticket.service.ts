import {
  type Prisma,
  type PrismaClient,
  TicketStatus,
  UserRole,
} from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import type { MineFilters } from "./ticket.service.js";

const userSelect = { id: true, email: true, displayName: true, role: true, isActive: true } as const;
const categorySelect = { id: true, name: true, description: true, isActive: true } as const;
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
    include: { technician: { select: userSelect }, assignedBy: { select: userSelect } },
  },
  activities: { orderBy: { createdAt: "asc" as const }, include: { actor: { select: userSelect } } },
} as const;

export type AdminTicketFilters = MineFilters & { assignedTechnicianId?: string | undefined };

export class AdminTicketService {
  constructor(private readonly database: PrismaClient) {}

  async listAll(filters: AdminTicketFilters) {
    const where: Prisma.TicketWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.assignedTechnicianId ? { assignedTechnicianId: filters.assignedTechnicianId } : {}),
      ...(filters.search ? {
        OR: [
          { ticketNumber: { contains: filters.search, mode: "insensitive" } },
          { title: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
          { creator: { is: { displayName: { contains: filters.search, mode: "insensitive" } } } },
        ],
      } : {}),
    };
    return this.database.$transaction(async (transaction) => {
      const tickets = await transaction.ticket.findMany({
        where,
        select: listSelect,
        orderBy: [{ createdAt: filters.sort === "newest" ? "desc" : "asc" }, { id: "asc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      });
      const total = await transaction.ticket.count({ where });
      return {
        tickets,
        pagination: {
          page: filters.page,
          pageSize: filters.pageSize,
          total,
          totalPages: Math.ceil(total / filters.pageSize),
        },
      };
    });
  }

  async getDetails(ticketId: string) {
    const ticket = await this.database.ticket.findUnique({
      where: { id: ticketId },
      include: detailInclude,
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    return ticket;
  }

  async listComments(ticketId: string) {
    await this.assertExists(ticketId);
    return this.database.comment.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: userSelect } },
    });
  }

  async assign(ticketId: string, technicianId: string, adminId: string) {
    return this.database.$transaction(async (transaction) => {
      const technician = await transaction.user.findFirst({
        where: { id: technicianId, role: UserRole.TECHNICIAN, isActive: true },
        select: { id: true },
      });
      if (!technician) {
        throw new HttpError(400, "INVALID_TECHNICIAN", "Target user must be an active technician");
      }
      const current = await transaction.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, status: true, assignedTechnicianId: true },
      });
      if (!current) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
      if (
        current.status === TicketStatus.RESOLVED
        || current.status === TicketStatus.CLOSED
        || current.status === TicketStatus.CANCELLED
      ) {
        throw new HttpError(409, "TICKET_NOT_ASSIGNABLE", "Completed or cancelled tickets cannot be assigned");
      }
      if (current.assignedTechnicianId === technicianId) {
        throw new HttpError(409, "TICKET_ALREADY_ASSIGNED", "Ticket is already assigned to this technician");
      }

      const updated = await transaction.ticket.updateMany({
        where: {
          id: ticketId,
          status: current.status,
          assignedTechnicianId: current.assignedTechnicianId,
        },
        data: {
          assignedTechnicianId: technicianId,
          ...(current.status === TicketStatus.OPEN ? { status: TicketStatus.CLAIMED } : {}),
        },
      });
      if (updated.count !== 1) {
        throw new HttpError(409, "ASSIGNMENT_CONFLICT", "Ticket assignment changed; refresh and try again");
      }

      const changedAt = new Date();
      if (current.assignedTechnicianId) {
        const ended = await transaction.ticketAssignment.updateMany({
          where: { ticketId, technicianId: current.assignedTechnicianId, unassignedAt: null },
          data: { unassignedAt: changedAt },
        });
        if (ended.count !== 1) {
          throw new HttpError(409, "ASSIGNMENT_HISTORY_CONFLICT", "Current assignment history is inconsistent");
        }
      }
      await transaction.ticketAssignment.create({
        data: { ticketId, technicianId, assignedById: adminId, assignedAt: changedAt },
      });
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: adminId,
          type: current.assignedTechnicianId ? "TICKET_REASSIGNED" : "TICKET_ASSIGNED",
          message: current.assignedTechnicianId ? "Ticket reassigned by administrator" : "Ticket assigned by administrator",
          metadata: {
            previousTechnicianId: current.assignedTechnicianId,
            technicianId,
            fromStatus: current.status,
            toStatus: current.status === TicketStatus.OPEN ? TicketStatus.CLAIMED : current.status,
          },
        },
      });
      return transaction.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: detailInclude });
    });
  }

  private async assertExists(ticketId: string) {
    const ticket = await this.database.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  }
}

export type AdminTicketApi = Pick<AdminTicketService, "listAll" | "getDetails" | "listComments" | "assign">;
