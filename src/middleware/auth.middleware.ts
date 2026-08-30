import type { RequestHandler } from "express";
import type { UserRole } from "../../generated/prisma/client.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SESSION_COOKIE_NAME, type SessionService } from "../auth/session.service.js";
import { HttpError } from "../errors/http-error.js";

export const createRequireAuth = (
  users: UserRepository,
  sessions: SessionService,
): RequestHandler => async (request, _response, next) => {
  try {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token !== "string") {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required");
    }

    const userId = sessions.verifyToken(token);
    const user = await users.findById(userId);
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required");
    if (!user.isActive) throw new HttpError(403, "ACCOUNT_INACTIVE", "This account is inactive");

    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAnyRole = (...roles: readonly UserRole[]): RequestHandler =>
  (request, _response, next) => {
    if (!request.user) {
      next(new HttpError(401, "UNAUTHENTICATED", "Authentication is required"));
      return;
    }

    if (!roles.includes(request.user.role)) {
      next(new HttpError(403, "FORBIDDEN", "You do not have permission to perform this action"));
      return;
    }

    next();
  };

export const requireRole = (role: UserRole): RequestHandler => requireAnyRole(role);
