import { HttpError } from "../errors/http-error.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validationError = (message: string): never => {
  throw new HttpError(400, "VALIDATION_ERROR", message);
};

export const parseUuid = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    return validationError(`${field} must be a valid UUID`);
  }
  return value.toLowerCase();
};

export const parseString = (
  value: unknown,
  field: string,
  { min, max }: { min: number; max: number },
): string => {
  if (typeof value !== "string") return validationError(`${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    return validationError(`${field} must be between ${min} and ${max} characters`);
  }
  return normalized;
};

export const parseOptionalString = (
  value: unknown,
  field: string,
  max: number,
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return validationError(`${field} must be a string or null`);
  const normalized = value.trim();
  if (normalized.length > max) return validationError(`${field} must be at most ${max} characters`);
  return normalized === "" ? null : normalized;
};

export const assertObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validationError("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
};
