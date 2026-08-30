import { Router } from "express";
import { UserRole } from "../../generated/prisma/client.js";
import type { UserRepository } from "../auth/auth.types.js";
import type { SessionService } from "../auth/session.service.js";
import { createAdminController } from "../controllers/admin.controller.js";
import { createRequireAuth, requireRole } from "../middleware/auth.middleware.js";
import type { AdminManagementApi } from "../services/admin-management.service.js";
import type { AdminTicketApi } from "../services/admin-ticket.service.js";

export const createAdminRouter = (
  users: UserRepository,
  sessions: SessionService,
  tickets: AdminTicketApi,
  management: AdminManagementApi,
) => {
  const router = Router();
  const controller = createAdminController(tickets, management);
  router.use(createRequireAuth(users, sessions));
  router.use(requireRole(UserRole.ADMIN));
  router.get("/dashboard", controller.dashboard);
  router.get("/tickets", controller.listTickets);
  router.get("/tickets/:ticketId", controller.getTicket);
  router.post("/tickets/:ticketId/assign", controller.assignTicket);
  router.get("/categories", controller.listCategories);
  router.post("/categories", controller.createCategory);
  router.patch("/categories/:categoryId", controller.updateCategory);
  router.post("/categories/:categoryId/disable", controller.disableCategory);
  router.post("/categories/:categoryId/enable", controller.enableCategory);
  router.get("/users", controller.listUsers);
  router.patch("/users/:userId", controller.updateUser);
  return router;
};
