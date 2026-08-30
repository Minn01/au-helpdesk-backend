import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../../generated/prisma/client.js";
import { HttpError } from "../errors/http-error.js";
import { requireAnyRole, requireRole } from "./auth.middleware.js";

const response = {} as Response;

const run = (middleware: ReturnType<typeof requireRole>, request: Request) => {
  let nextValue: unknown = Symbol("not-called");
  middleware(request, response, ((error?: unknown) => {
    nextValue = error;
  }) as NextFunction);
  return nextValue;
};

describe("role middleware", () => {
  it("allows the required role", () => {
    const request = {
      user: { role: UserRole.ADMIN },
    } as Request;
    assert.equal(run(requireRole(UserRole.ADMIN), request), undefined);
  });

  it("allows any configured role", () => {
    const request = {
      user: { role: UserRole.TECHNICIAN },
    } as Request;
    assert.equal(
      run(requireAnyRole(UserRole.TECHNICIAN, UserRole.ADMIN), request),
      undefined,
    );
  });

  it("returns forbidden for the wrong role", () => {
    const request = {
      user: { role: UserRole.STUDENT },
    } as Request;
    const error = run(requireRole(UserRole.ADMIN), request);
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 403);
  });

  it("returns unauthenticated when auth middleware has not populated a user", () => {
    const error = run(requireRole(UserRole.ADMIN), {} as Request);
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 401);
  });
});
