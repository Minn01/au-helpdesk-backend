import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { HttpError } from "../errors/http-error.js";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export const requirePeerApiKey = (expectedKey: string): RequestHandler => {
  const expectedDigest = digest(expectedKey);
  return (request, _response, next) => {
    const supplied = request.get("x-api-key");
    if (!supplied || !timingSafeEqual(expectedDigest, digest(supplied))) {
      next(new HttpError(401, "INVALID_PEER_API_KEY", "A valid peer API key is required"));
      return;
    }
    next();
  };
};
