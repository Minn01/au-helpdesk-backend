import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { HttpError } from "../errors/http-error.js";

const SESSION_ISSUER = "au-helpdesk-api";
const SESSION_AUDIENCE = "au-helpdesk-app";

export const SESSION_COOKIE_NAME = "helpdesk_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type SessionService = {
  createToken(userId: string): string;
  verifyToken(token: string): string;
};

export const createSessionService = (secret: string): SessionService => ({
  createToken: (userId) =>
    jwt.sign({}, secret, {
      algorithm: "HS256",
      audience: SESSION_AUDIENCE,
      expiresIn: SESSION_TTL_SECONDS,
      issuer: SESSION_ISSUER,
      jwtid: randomUUID(),
      subject: userId,
    }),

  verifyToken: (token) => {
    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        audience: SESSION_AUDIENCE,
        issuer: SESSION_ISSUER,
      });

      if (typeof payload === "string" || !payload.sub) throw new Error("Missing subject");
      return payload.sub;
    } catch {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required");
    }
  },
});
