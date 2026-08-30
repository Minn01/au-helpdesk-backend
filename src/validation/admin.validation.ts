import { UserRole } from "../../generated/prisma/client.js";
import { assertObject, parseOptionalString, parseString, parseUuid, validationError } from "./common.js";
import { parseMineQuery } from "./ticket.validation.js";

const oneQueryValue = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return validationError(`${field} must be provided once`);
  return value;
};

export const parseAdminTicketQuery = (query: Record<string, unknown>) => ({
  ...parseMineQuery(query),
  assignedTechnicianId: query.assignedTechnicianId === undefined
    ? undefined
    : parseUuid(oneQueryValue(query.assignedTechnicianId, "assignedTechnicianId"), "assignedTechnicianId"),
});

export const parseAssignment = (value: unknown) => {
  const body = assertObject(value);
  const unknown = Object.keys(body).find((key) => key !== "technicianId");
  if (unknown) return validationError(`Unknown field: ${unknown}`);
  return { technicianId: parseUuid(body.technicianId, "technicianId") };
};

export const parseCreateCategory = (value: unknown) => {
  const body = assertObject(value);
  const allowed = new Set(["name", "description"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return validationError(`Unknown field: ${unknown}`);
  return {
    name: parseString(body.name, "name", { min: 1, max: 100 }),
    description: parseOptionalString(body.description, "description", 500) ?? null,
  };
};

export const parseUpdateCategory = (value: unknown) => {
  const body = assertObject(value);
  const allowed = new Set(["name", "description"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return validationError(`Unknown field: ${unknown}`);
  const result: { name?: string; description?: string | null } = {};
  if (body.name !== undefined) result.name = parseString(body.name, "name", { min: 1, max: 100 });
  if (body.description !== undefined) {
    result.description = parseOptionalString(body.description, "description", 500) ?? null;
  }
  if (Object.keys(result).length === 0) return validationError("name or description is required");
  return result;
};

export const parseUserQuery = (query: Record<string, unknown>) => {
  const search = oneQueryValue(query.search, "search")?.trim();
  if (search && search.length > 200) return validationError("search must be at most 200 characters");
  const role = oneQueryValue(query.role, "role");
  if (role && !Object.values(UserRole).includes(role as UserRole)) return validationError("role is invalid");
  const active = oneQueryValue(query.active, "active");
  if (active !== undefined && active !== "true" && active !== "false") {
    return validationError("active must be true or false");
  }
  return {
    search: search || undefined,
    role: role as UserRole | undefined,
    isActive: active === undefined ? undefined : active === "true",
  };
};

export const parseUserUpdate = (value: unknown) => {
  const body = assertObject(value);
  const allowed = new Set(["role", "isActive"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return validationError(`Unknown field: ${unknown}`);
  let role: UserRole | undefined;
  if (body.role !== undefined) {
    if (typeof body.role !== "string" || !Object.values(UserRole).includes(body.role as UserRole)) {
      return validationError("role is invalid");
    }
    role = body.role as UserRole;
  }
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    return validationError("isActive must be a boolean");
  }
  if (role === undefined && body.isActive === undefined) return validationError("role or isActive is required");
  return { role, isActive: body.isActive as boolean | undefined };
};
