import type { CookieOptions, Response } from "express";
import { MICROSOFT_STATE_COOKIE_NAME, MICROSOFT_STATE_TTL_SECONDS } from "./oauth-state.service.js";

const options = (isProduction: boolean): CookieOptions => ({
  httpOnly: true,
  maxAge: MICROSOFT_STATE_TTL_SECONDS * 1_000,
  path: "/",
  sameSite: "lax",
  secure: isProduction,
});

export const setMicrosoftStateCookie = (response: Response, token: string, isProduction: boolean) => {
  response.cookie(MICROSOFT_STATE_COOKIE_NAME, token, options(isProduction));
};

export const clearMicrosoftStateCookie = (response: Response, isProduction: boolean) => {
  const { maxAge: _maxAge, ...cookieOptions } = options(isProduction);
  response.clearCookie(MICROSOFT_STATE_COOKIE_NAME, cookieOptions);
};
