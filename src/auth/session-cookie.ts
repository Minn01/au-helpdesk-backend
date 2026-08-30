import type { CookieOptions, Response } from "express";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./session.service.js";

const cookieOptions = (isProduction: boolean): CookieOptions => ({
  httpOnly: true,
  maxAge: SESSION_TTL_SECONDS * 1_000,
  // Root works both locally at /api and publicly behind /helpdesk/api.
  path: "/",
  sameSite: "lax",
  secure: isProduction,
});

export const setSessionCookie = (response: Response, token: string, isProduction: boolean) => {
  response.cookie(SESSION_COOKIE_NAME, token, cookieOptions(isProduction));
};

export const clearSessionCookie = (response: Response, isProduction: boolean) => {
  const { maxAge: _maxAge, ...options } = cookieOptions(isProduction);
  response.clearCookie(SESSION_COOKIE_NAME, options);
};
