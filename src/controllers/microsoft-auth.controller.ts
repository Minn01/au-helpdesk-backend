import type { RequestHandler } from "express";
import type { SessionService } from "../auth/session.service.js";
import { setSessionCookie } from "../auth/session-cookie.js";
import type { MicrosoftConfig, MicrosoftOAuthClient, MicrosoftUserProvisioner } from "../auth/microsoft-auth.service.js";
import { clearMicrosoftStateCookie, setMicrosoftStateCookie } from "../auth/microsoft-state-cookie.js";
import { MICROSOFT_STATE_COOKIE_NAME, type OAuthStateService } from "../auth/oauth-state.service.js";
import { HttpError } from "../errors/http-error.js";
import { logger } from "../lib/logger.js";

export type MicrosoftAuthDependencies = {
  config: MicrosoftConfig;
  oauth: MicrosoftOAuthClient;
  users: MicrosoftUserProvisioner;
  state: OAuthStateService;
  sessions: SessionService;
  isProduction: boolean;
};

const queryString = (value: unknown) => typeof value === "string" ? value : undefined;

const failureUrl = (frontendUrl: string, code: string) => {
  const url = new URL(`${frontendUrl}/login`);
  url.searchParams.set("authError", code);
  return url.toString();
};

export const createMicrosoftAuthController = (dependencies: MicrosoftAuthDependencies) => ({
  login: (async (_request, response, next) => {
    try {
      const state = dependencies.state.create();
      setMicrosoftStateCookie(response, state.token, dependencies.isProduction);
      response.redirect(302, await dependencies.oauth.authorizationUrl(state.state, state.nonce));
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  callback: (async (request, response) => {
    try {
      const providerError = queryString(request.query.error);
      if (providerError) throw new HttpError(401, "MICROSOFT_AUTH_REJECTED", "Microsoft authentication was not completed");
      const state = dependencies.state.verify(
        queryString(request.cookies?.[MICROSOFT_STATE_COOKIE_NAME]),
        queryString(request.query.state),
      );
      const code = queryString(request.query.code);
      if (!code) throw new HttpError(400, "MICROSOFT_CODE_MISSING", "Microsoft authorization code is missing");
      const identity = await dependencies.oauth.exchangeCode(code, state.nonce);
      const user = await dependencies.users.findOrCreate(identity);
      if (!user.isActive) throw new HttpError(403, "ACCOUNT_INACTIVE", "This account is inactive");
      setSessionCookie(response, dependencies.sessions.createToken(user.id), dependencies.isProduction);
      clearMicrosoftStateCookie(response, dependencies.isProduction);
      response.redirect(302, `${dependencies.config.frontendUrl}/dashboard`);
    } catch (error) {
      clearMicrosoftStateCookie(response, dependencies.isProduction);
      const code = error instanceof HttpError ? error.code : "MICROSOFT_AUTH_FAILED";
      logger.warn("Microsoft authentication callback failed", { code });
      response.redirect(302, failureUrl(dependencies.config.frontendUrl, code));
    }
  }) satisfies RequestHandler,
});
