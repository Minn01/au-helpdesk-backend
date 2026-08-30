import type { RequestHandler } from "express";
import type { UserRepository } from "../auth/auth.types.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session-cookie.js";
import type { SessionService } from "../auth/session.service.js";
import { HttpError } from "../errors/http-error.js";

export const getMe: RequestHandler = (request, response) => {
  response.status(200).json({ user: request.user });
};

export const createLogout = (isProduction: boolean): RequestHandler =>
  (_request, response) => {
    clearSessionCookie(response, isProduction);
    response.status(204).send();
  };

export const createDevelopmentLogin = (
  users: UserRepository,
  sessions: SessionService,
  isProduction: boolean,
): RequestHandler => async (request, response, next) => {
  try {
    const userId: unknown = request.body?.userId;
    if (typeof userId !== "string" || userId.trim() === "") {
      throw new HttpError(400, "VALIDATION_ERROR", "userId is required");
    }

    const user = await users.findById(userId);
    if (!user) throw new HttpError(404, "USER_NOT_FOUND", "Development user not found");
    if (!user.isActive) throw new HttpError(403, "ACCOUNT_INACTIVE", "This account is inactive");

    setSessionCookie(response, sessions.createToken(user.id), isProduction);
    response.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};
