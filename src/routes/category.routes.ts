import { Router } from "express";
import { UserRole } from "../../generated/prisma/client.js";
import type { SessionService } from "../auth/session.service.js";
import type { UserRepository } from "../auth/auth.types.js";
import { createListCategories } from "../controllers/category.controller.js";
import { createRequireAuth, requireAnyRole } from "../middleware/auth.middleware.js";
import type { CategoryApi } from "../services/category.service.js";

export const createCategoryRouter = (
  users: UserRepository,
  sessions: SessionService,
  categories: CategoryApi,
) => {
  const router = Router();
  router.use(createRequireAuth(users, sessions));
  router.use(requireAnyRole(UserRole.STUDENT, UserRole.FACULTY, UserRole.TECHNICIAN, UserRole.ADMIN));
  router.get("/", createListCategories(categories));
  return router;
};
