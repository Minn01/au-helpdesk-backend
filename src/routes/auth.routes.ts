import { Router } from "express";
import type { UserRepository } from "../auth/auth.types.js";
import type { SessionService } from "../auth/session.service.js";
import { createLogout, getMe } from "../controllers/auth.controller.js";
import { createRequireAuth } from "../middleware/auth.middleware.js";
import { createMicrosoftAuthController, type MicrosoftAuthDependencies } from "../controllers/microsoft-auth.controller.js";

export const createAuthRouter = (
  users: UserRepository,
  sessions: SessionService,
  isProduction: boolean,
  microsoft?: MicrosoftAuthDependencies,
) => {
  const router = Router();
  if (microsoft) {
    const controller = createMicrosoftAuthController(microsoft);
    router.get("/microsoft", controller.login);
    router.get("/microsoft/callback", controller.callback);
  }
  router.get("/me", createRequireAuth(users, sessions), getMe);
  router.post("/logout", createLogout(isProduction));
  return router;
};
