import { randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { HttpError } from "../errors/http-error.js";

const ISSUER = "au-helpdesk-api";
const AUDIENCE = "au-helpdesk-microsoft-oauth";
const TTL_SECONDS = 10 * 60;

export const MICROSOFT_STATE_COOKIE_NAME = "helpdesk_microsoft_state";
export const MICROSOFT_STATE_TTL_SECONDS = TTL_SECONDS;

type StatePayload = { state: string; nonce: string };

export type OAuthStateService = {
  create(): StatePayload & { token: string };
  verify(token: string | undefined, returnedState: string | undefined): StatePayload;
};

const equal = (left: string, right: string) => {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
};

export const createOAuthStateService = (secret: string): OAuthStateService => ({
  create: () => {
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const token = jwt.sign({ state, nonce }, secret, {
      algorithm: "HS256",
      audience: AUDIENCE,
      expiresIn: TTL_SECONDS,
      issuer: ISSUER,
    });
    return { state, nonce, token };
  },
  verify: (token, returnedState) => {
    if (!token || !returnedState) throw new HttpError(400, "INVALID_OAUTH_STATE", "Authentication state is invalid or expired");
    try {
      const payload = jwt.verify(token, secret, { algorithms: ["HS256"], audience: AUDIENCE, issuer: ISSUER });
      if (typeof payload === "string" || typeof payload.state !== "string" || typeof payload.nonce !== "string") {
        throw new Error("Invalid state payload");
      }
      if (!equal(payload.state, returnedState)) throw new Error("State mismatch");
      return { state: payload.state, nonce: payload.nonce };
    } catch {
      throw new HttpError(400, "INVALID_OAUTH_STATE", "Authentication state is invalid or expired");
    }
  },
});
