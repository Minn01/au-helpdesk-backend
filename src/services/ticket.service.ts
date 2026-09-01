import {
  CategorySource,
  type Prisma,
  type PrismaClient,
  TicketPriority,
  TicketStatus,
} from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import type { CreateTicketInput, UpdateTicketInput } from "../validation/ticket.validation.js";
import type { ClassificationService } from "./classification.service.js";
import { attachmentSelect } from "./attachment-select.js";
import { logger } from "../lib/logger.js";

const userSelect = { id: true, displayName: true, role: true } as const;
const categorySelect = { id: true, name: true, description: true } as const;

const listSelect = {
  id: true,
  ticketNumber: true,
  title: true,
  description: true,
  categorySource: true,
  priority: true,
  status: true,
  location: true,
  createdAt: true,
  updatedAt: true,
  category: { select: categorySelect },
  assignedTechnician: { select: userSelect },
  _count: { select: { comments: true, attachments: true } },
} as const;

const detailInclude = {
  category: { select: categorySelect },
  aiSuggestedCategory: { select: categorySelect },
  creator: { select: userSelect },
  assignedTechnician: { select: userSelect },
  comments: {
    where: { isInternal: false },
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: userSelect } },
  },
  attachments: {
    orderBy: { createdAt: "asc" as const },
    select: attachmentSelect,
  },
  activities: {
    orderBy: { createdAt: "asc" as const },
    include: { actor: { select: userSelect } },
  },
} as const;

export type MineFilters = {
  search?: string | undefined;
  status?: Prisma.EnumTicketStatusFilter["equals"] | undefined;
  priority?: Prisma.EnumTicketPriorityFilter["equals"] | undefined;
  categoryId?: string | undefined;
  sort: "newest" | "oldest";
  page: number;
  pageSize: number;
};

export class TicketService {
  constructor(
    private readonly database: PrismaClient,
    private readonly classification: ClassificationService,
  ) {}

  async listMine(creatorId: string, filters: MineFilters) {
    const where: Prisma.TicketWhereInput = {
      creatorId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.search ? {
        OR: [
          { ticketNumber: { contains: filters.search, mode: "insensitive" } },
          { title: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
          { location: { contains: filters.search, mode: "insensitive" } },
        ],
      } : {}),
    };
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

  async getOwnedDetails(ticketId: string, creatorId: string) {
    const ticket = await this.database.ticket.findFirst({
      where: { id: ticketId, creatorId },
      include: detailInclude,
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    return ticket;
  }

  async create(creatorId: string, input: CreateTicketInput) {
    const category = await this.resolveCategory(input, true);
    return this.database.ticket.create({
      data: {
        creatorId,
        title: input.title,
        description: input.description,
        location: input.location,
        categoryId: category.id,
        categorySource: category.source,
        ...(category.priority ? { priority: category.priority } : {}),
        aiSuggestedCategoryId: category.aiSuggestedCategoryId,
        aiSuggestedPriority: category.aiSuggestedPriority,
        aiSummary: category.aiSummary,
        activities: {
          create: [
            {
              actorId: creatorId,
              type: "TICKET_CREATED",
              message: "Ticket created",
              metadata: {
                categoryId: category.id,
                categorySource: category.source,
              },
            },
            ...(category.classificationSucceeded ? [{
              type: "AI_CLASSIFICATION_COMPLETED",
              message: "AI ticket classification completed",
              metadata: {
                suggestedCategoryId: category.aiSuggestedCategoryId,
                suggestedPriority: category.aiSuggestedPriority,
              },
            }] : []),
          ],
        },
      },
      include: detailInclude,
    });
  }

  async update(ticketId: string, creatorId: string, input: UpdateTicketInput) {
    const snapshot = await this.database.ticket.findFirst({
      where: { id: ticketId, creatorId },
      select: { title: true, description: true, status: true },
    });
    if (!snapshot) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    if (snapshot.status !== TicketStatus.OPEN) {
      throw new HttpError(409, "TICKET_NOT_OPEN", "Only OPEN tickets can be edited");
    }
    const category = input.category ? await this.resolveCategory({
      ...input.category,
      title: input.title ?? snapshot.title,
      description: input.description ?? snapshot.description,
      location: null,
    }, false) : undefined;

    return this.database.$transaction(async (transaction) => {
      const current = await transaction.ticket.findFirst({
        where: { id: ticketId, creatorId },
        select: { id: true, status: true },
      });
      if (!current) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
      if (current.status !== TicketStatus.OPEN) {
        throw new HttpError(409, "TICKET_NOT_OPEN", "Only OPEN tickets can be edited");
      }

      const changedFields = [
        ...(input.title !== undefined ? ["title"] : []),
        ...(input.description !== undefined ? ["description"] : []),
        ...(input.location !== undefined ? ["location"] : []),
        ...(category ? ["category"] : []),
      ];
      const result = await transaction.ticket.updateMany({
        where: { id: ticketId, creatorId, status: TicketStatus.OPEN },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(category ? {
            categoryId: category.id,
            categorySource: category.source,
            ...(category.priority ? { priority: category.priority } : {}),
            aiSuggestedCategoryId: category.aiSuggestedCategoryId,
            aiSuggestedPriority: category.aiSuggestedPriority,
            aiSummary: category.aiSummary,
          } : {}),
        },
      });
      if (result.count !== 1) {
        throw new HttpError(409, "TICKET_NOT_OPEN", "Only OPEN tickets can be edited");
      }
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: creatorId,
          type: "TICKET_EDITED",
          message: "Ticket details edited",
          metadata: { changedFields },
        },
      });
      return transaction.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: detailInclude });
    });
  }

  async cancel(ticketId: string, creatorId: string) {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.ticket.findFirst({
        where: { id: ticketId, creatorId },
        select: { id: true, status: true },
      });
      if (!current) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
      if (current.status !== TicketStatus.OPEN) {
        throw new HttpError(409, "TICKET_NOT_OPEN", "Only OPEN tickets can be cancelled");
      }
      const result = await transaction.ticket.updateMany({
        where: { id: ticketId, creatorId, status: TicketStatus.OPEN },
        data: {
          status: TicketStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
      if (result.count !== 1) {
        throw new HttpError(409, "TICKET_NOT_OPEN", "Only OPEN tickets can be cancelled");
      }
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: creatorId,
          type: "TICKET_CANCELLED",
          message: "Ticket cancelled by requester",
          metadata: { fromStatus: TicketStatus.OPEN, toStatus: TicketStatus.CANCELLED },
        },
      });
      return transaction.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: detailInclude });
    });
  }

  async listComments(ticketId: string, creatorId: string) {
    await this.assertOwned(ticketId, creatorId);
    return this.database.comment.findMany({
      where: { ticketId, isInternal: false },
      orderBy: { createdAt: "asc" },
      include: { author: { select: userSelect } },
    });
  }

  async addComment(ticketId: string, creatorId: string, body: string) {
    return this.database.$transaction(async (transaction) => {
      const ticket = await transaction.ticket.findFirst({
        where: { id: ticketId, creatorId },
        select: { id: true },
      });
      if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
      const comment = await transaction.comment.create({
        data: { ticketId, authorId: creatorId, body },
        include: { author: { select: userSelect } },
      });
      await transaction.ticketActivity.create({
        data: {
          ticketId,
          actorId: creatorId,
          type: "COMMENT_ADDED",
          message: "Requester added a comment",
          metadata: { commentId: comment.id },
        },
      });
      return comment;
    });
  }

  private async assertOwned(ticketId: string, creatorId: string) {
    const ticket = await this.database.ticket.findFirst({
      where: { id: ticketId, creatorId },
      select: { id: true },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  }

  private async resolveCategory(input: CreateTicketInput, useAI: boolean) {
    const activeCategories = await this.database.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const selected = input.categoryIntent === "CATEGORY"
      ? activeCategories.find((category) => category.id === input.categoryId)
      : undefined;
    if (input.categoryIntent === "CATEGORY" && !selected) {
      throw new HttpError(400, "INVALID_CATEGORY", "Category is not active or does not exist");
    }

    let classification: Awaited<ReturnType<ClassificationService["classify"]>> | undefined;
    let suggestedCategory: (typeof activeCategories)[number] | undefined;
    if (useAI) {
      try {
        classification = await this.classification.classify({
          title: input.title,
          description: input.description,
          location: input.location,
          activeCategoryNames: activeCategories.map((category) => category.name),
        });
        suggestedCategory = activeCategories.find((category) => category.name === classification!.categoryName);
        if (!suggestedCategory) throw new Error("Classifier returned an inactive or nonexistent category");
      } catch (error) {
        logger.warn("OpenAI ticket classification failed; using deterministic fallback", {
          failureType: error instanceof Error ? error.constructor.name : "UnknownError",
        });
        classification = undefined;
        suggestedCategory = undefined;
      }
    }

    if (input.categoryIntent === "CATEGORY") {
      return {
        id: selected!.id,
        source: CategorySource.USER_SELECTED,
        priority: useAI ? classification?.priority ?? TicketPriority.MEDIUM : undefined,
        aiSuggestedCategoryId: suggestedCategory?.id ?? null,
        aiSuggestedPriority: classification?.priority ?? null,
        aiSummary: classification?.summary ?? null,
        classificationSucceeded: Boolean(classification),
      } as const;
    }

    if (classification && suggestedCategory) {
      return {
        id: suggestedCategory.id,
        source: CategorySource.AI_SUGGESTED,
        priority: classification.priority,
        aiSuggestedCategoryId: suggestedCategory.id,
        aiSuggestedPriority: classification.priority,
        aiSummary: classification.summary ?? null,
        classificationSucceeded: true,
      } as const;
    }
    const fallback = activeCategories.find((category) => category.name.toLocaleLowerCase() === "other");
    if (!fallback) throw new HttpError(503, "CLASSIFICATION_UNAVAILABLE", "Automatic classification is unavailable");
    return {
      id: fallback.id,
      source: CategorySource.AI_SUGGESTED,
      priority: TicketPriority.MEDIUM,
      aiSuggestedCategoryId: null,
      aiSuggestedPriority: null,
      aiSummary: null,
      classificationSucceeded: false,
    } as const;
  }
}

export type TicketApi = Pick<
  TicketService,
  "listMine" | "getOwnedDetails" | "create" | "update" | "cancel" | "listComments" | "addComment"
>;
