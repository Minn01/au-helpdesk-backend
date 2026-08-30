import {
  Prisma,
  type PrismaClient,
  TicketStatus,
  UserRole,
} from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";

type UserFilters = { search?: string | undefined; role?: UserRole | undefined; isActive?: boolean | undefined };
type UserUpdate = { role?: UserRole | undefined; isActive?: boolean | undefined };
type CategoryUpdate = { name?: string; description?: string | null };

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assignedTickets: true } },
} as const;

export class AdminManagementService {
  constructor(private readonly database: PrismaClient) {}

  listCategories() {
    return this.database.category.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  }

  async createCategory(input: { name: string; description: string | null }) {
    await this.assertCategoryNameAvailable(input.name);
    try {
      return await this.database.category.create({ data: input });
    } catch (error) {
      this.rethrowCategoryConflict(error);
    }
  }

  async updateCategory(categoryId: string, input: CategoryUpdate) {
    await this.assertCategory(categoryId);
    if (input.name !== undefined) await this.assertCategoryNameAvailable(input.name, categoryId);
    try {
      return await this.database.category.update({ where: { id: categoryId }, data: input });
    } catch (error) {
      this.rethrowCategoryConflict(error);
    }
  }

  async setCategoryActive(categoryId: string, isActive: boolean) {
    await this.assertCategory(categoryId);
    return this.database.category.update({ where: { id: categoryId }, data: { isActive } });
  }

  listUsers(filters: UserFilters) {
    return this.database.user.findMany({
      where: {
        ...(filters.role ? { role: filters.role } : {}),
        ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
        ...(filters.search ? {
          OR: [
            { displayName: { contains: filters.search, mode: "insensitive" as const } },
            { email: { contains: filters.search, mode: "insensitive" as const } },
          ],
        } : {}),
      },
      select: userSelect,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
  }

  async updateUser(userId: string, input: UserUpdate, actorId: string) {
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({ where: { id: userId }, select: userSelect });
      if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");

      if (userId === actorId && (input.isActive === false || (input.role && input.role !== UserRole.ADMIN))) {
        throw new HttpError(409, "SELF_LOCKOUT_PROTECTED", "Administrators cannot deactivate or demote themselves");
      }

      const removesTechnicianAccess = user.role === UserRole.TECHNICIAN
        && (input.isActive === false || (input.role !== undefined && input.role !== UserRole.TECHNICIAN));
      if (removesTechnicianAccess) {
        const activeAssignments = await transaction.ticket.count({
          where: {
            assignedTechnicianId: userId,
            status: { in: [TicketStatus.CLAIMED, TicketStatus.IN_PROGRESS] },
          },
        });
        if (activeAssignments > 0) {
          throw new HttpError(
            409,
            "TECHNICIAN_HAS_ACTIVE_TICKETS",
            "Reassign this technician's active tickets before changing their role or status",
          );
        }
      }

      return transaction.user.update({
        where: { id: userId },
        data: {
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        select: userSelect,
      });
    });
  }

  async dashboard() {
    const activeStatuses = [TicketStatus.CLAIMED, TicketStatus.IN_PROGRESS];
    const [totalTickets, byStatus, byPriority, unassignedOpen, activeTechnicians, workload, recentTickets] =
      await this.database.$transaction([
        this.database.ticket.count(),
        this.database.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
        this.database.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
        this.database.ticket.count({ where: { status: TicketStatus.OPEN, assignedTechnicianId: null } }),
        this.database.user.count({ where: { role: UserRole.TECHNICIAN, isActive: true } }),
        this.database.ticket.groupBy({
          by: ["assignedTechnicianId"],
          where: { assignedTechnicianId: { not: null }, status: { in: activeStatuses } },
          _count: { _all: true },
        }),
        this.database.ticket.findMany({
          take: 5,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            status: true,
            priority: true,
            createdAt: true,
            creator: { select: { id: true, displayName: true } },
            assignedTechnician: { select: { id: true, displayName: true } },
          },
        }),
      ]);
    const technicianIds = workload.flatMap((entry) => entry.assignedTechnicianId ? [entry.assignedTechnicianId] : []);
    const technicians = technicianIds.length === 0 ? [] : await this.database.user.findMany({
      where: { id: { in: technicianIds } },
      select: { id: true, displayName: true, isActive: true },
    });
    const names = new Map(technicians.map((technician) => [technician.id, technician]));
    return {
      totalTickets,
      unassignedOpen,
      activeTechnicians,
      ticketsByStatus: Object.fromEntries(byStatus.map((entry) => [entry.status, entry._count._all])),
      ticketsByPriority: Object.fromEntries(byPriority.map((entry) => [entry.priority, entry._count._all])),
      technicianWorkload: workload.flatMap((entry) => {
        if (!entry.assignedTechnicianId) return [];
        const technician = names.get(entry.assignedTechnicianId);
        return [{ technicianId: entry.assignedTechnicianId, displayName: technician?.displayName ?? "Unknown", isActive: technician?.isActive ?? false, activeTickets: entry._count._all }];
      }),
      recentTickets,
    };
  }

  private async assertCategory(categoryId: string) {
    const category = await this.database.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found");
  }

  private async assertCategoryNameAvailable(name: string, excludeId?: string) {
    const duplicate = await this.database.category.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new HttpError(409, "CATEGORY_NAME_CONFLICT", "A category with this name already exists");
    }
  }

  private rethrowCategoryConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "CATEGORY_NAME_CONFLICT", "A category with this name already exists");
    }
    throw error;
  }
}

export type AdminManagementApi = Pick<
  AdminManagementService,
  "listCategories" | "createCategory" | "updateCategory" | "setCategoryActive" | "listUsers" | "updateUser" | "dashboard"
>;
