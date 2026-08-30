import { TicketPriority, TicketStatus } from "../../generated/prisma/client.js";
import { assertObject, parseOptionalString, parseString, parseUuid, validationError } from "./common.js";

export type CategoryIntent =
  | { categoryId: string; categoryIntent: "CATEGORY" }
  | { categoryIntent: "AUTO_DETECT" };

export type CreateTicketInput = CategoryIntent & {
  title: string;
  description: string;
  location: string | null;
};

export type UpdateTicketInput = {
  title?: string;
  description?: string;
  location?: string | null;
  category?: CategoryIntent;
};

const parseCategoryIntent = (body: Record<string, unknown>, required: boolean): CategoryIntent | undefined => {
  const hasCategoryId = body.categoryId !== undefined;
  const hasIntent = body.categoryIntent !== undefined;
  if (!hasCategoryId && !hasIntent) {
    if (required) return validationError("Provide categoryId or categoryIntent=AUTO_DETECT");
    return undefined;
  }
  if (hasCategoryId && hasIntent) return validationError("Provide either categoryId or categoryIntent, not both");
  if (hasCategoryId) {
    return { categoryId: parseUuid(body.categoryId, "categoryId"), categoryIntent: "CATEGORY" };
  }
  if (body.categoryIntent !== "AUTO_DETECT") {
    return validationError("categoryIntent must be AUTO_DETECT");
  }
  return { categoryIntent: "AUTO_DETECT" };
};

export const parseCreateTicket = (value: unknown): CreateTicketInput => {
  const body = assertObject(value);
  const allowed = new Set(["title", "description", "location", "categoryId", "categoryIntent"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return validationError(`Unknown field: ${unknown}`);
  return {
    title: parseString(body.title, "title", { min: 5, max: 160 }),
    description: parseString(body.description, "description", { min: 10, max: 5_000 }),
    location: parseOptionalString(body.location, "location", 200) ?? null,
    ...parseCategoryIntent(body, true)!,
  };
};

export const parseUpdateTicket = (value: unknown): UpdateTicketInput => {
  const body = assertObject(value);
  const allowed = new Set(["title", "description", "location", "categoryId", "categoryIntent"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return validationError(`Unknown field: ${unknown}`);

  const result: UpdateTicketInput = {};
  if (body.title !== undefined) result.title = parseString(body.title, "title", { min: 5, max: 160 });
  if (body.description !== undefined) {
    result.description = parseString(body.description, "description", { min: 10, max: 5_000 });
  }
  if (body.location !== undefined) result.location = parseOptionalString(body.location, "location", 200) ?? null;
  const category = parseCategoryIntent(body, false);
  if (category) result.category = category;
  if (Object.keys(result).length === 0) return validationError("At least one editable field is required");
  return result;
};

export const parseComment = (value: unknown) => {
  const body = assertObject(value);
  return { body: parseString(body.body, "body", { min: 1, max: 2_000 }) };
};

const oneQueryValue = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return validationError(`${field} must be provided once`);
  return value;
};

const parsePositiveInt = (value: string | undefined, field: string, fallback: number, max: number) => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return validationError(`${field} must be a positive integer`);
  const number = Number(value);
  if (number < 1 || number > max) return validationError(`${field} must be between 1 and ${max}`);
  return number;
};

export const parseMineQuery = (query: Record<string, unknown>) => {
  const searchValue = oneQueryValue(query.search, "search")?.trim();
  if (searchValue && searchValue.length > 200) return validationError("search must be at most 200 characters");
  const statusValue = oneQueryValue(query.status, "status");
  const priorityValue = oneQueryValue(query.priority, "priority");
  const sort = oneQueryValue(query.sort, "sort") ?? "newest";
  if (statusValue && !Object.values(TicketStatus).includes(statusValue as TicketStatus)) {
    return validationError("status is invalid");
  }
  if (priorityValue && !Object.values(TicketPriority).includes(priorityValue as TicketPriority)) {
    return validationError("priority is invalid");
  }
  if (sort !== "newest" && sort !== "oldest") return validationError("sort must be newest or oldest");

  return {
    search: searchValue || undefined,
    status: statusValue as TicketStatus | undefined,
    priority: priorityValue as TicketPriority | undefined,
    categoryId: query.category === undefined ? undefined : parseUuid(oneQueryValue(query.category, "category"), "category"),
    sort,
    page: parsePositiveInt(oneQueryValue(query.page, "page"), "page", 1, 1_000_000),
    pageSize: parsePositiveInt(oneQueryValue(query.pageSize, "pageSize"), "pageSize", 20, 100),
  } as const;
};
