import { TicketPriority, TicketStatus } from "../../generated/prisma/client.js";
import { assertObject, parseUuid, validationError } from "./common.js";
import { parseMineQuery } from "./ticket.validation.js";

export const parseQueueQuery = (query: Record<string, unknown>) => {
  if (query.status !== undefined) return validationError("Queue status is always OPEN");
  return parseMineQuery(query);
};

export const parseAssignedQuery = (query: Record<string, unknown>) => parseMineQuery(query);

export const parseClassificationUpdate = (value: unknown) => {
  const body = assertObject(value);
  const allowed = new Set(["categoryId", "priority"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return validationError(`Unknown field: ${unknown}`);
  if (body.categoryId === undefined && body.priority === undefined) {
    return validationError("categoryId or priority is required");
  }
  let priority: TicketPriority | undefined;
  if (body.priority !== undefined) {
    if (typeof body.priority !== "string" || !Object.values(TicketPriority).includes(body.priority as TicketPriority)) {
      return validationError("priority is invalid");
    }
    priority = body.priority as TicketPriority;
  }
  return {
    categoryId: body.categoryId === undefined ? undefined : parseUuid(body.categoryId, "categoryId"),
    priority,
  };
};

export const technicianAssignedStatuses = [
  TicketStatus.CLAIMED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.RESOLVED,
] as const;
