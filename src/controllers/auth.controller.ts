import type { RequestHandler } from "express";
import { clearSessionCookie } from "../auth/session-cookie.js";

export const getMe: RequestHandler = (request, response) => {
  response.status(200).json({ user: request.user });
};

export const createLogout = (isProduction: boolean): RequestHandler =>
  (_request, response) => {
    clearSessionCookie(response, isProduction);
    response.status(204).send();
  };
