import { Router } from "express";
import type { UserRepository } from "../auth/auth.types.js";
import type { SessionService } from "../auth/session.service.js";
import { createDevelopmentLogin } from "../controllers/auth.controller.js";

export const createDevelopmentAuthRouter = (
  users: UserRepository,
  sessions: SessionService,
  isProduction: boolean,
) => {
  const router = Router();
  router.post("/login", createDevelopmentLogin(users, sessions, isProduction));
  return router;
};
