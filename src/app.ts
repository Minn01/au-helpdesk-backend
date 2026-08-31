import cookieParser from "cookie-parser";
import express from "express";
import type { SessionService } from "./auth/session.service.js";
import type { UserRepository } from "./auth/auth.types.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { createCategoryRouter } from "./routes/category.routes.js";
import { createTicketRouter } from "./routes/ticket.routes.js";
import { createAdminRouter } from "./routes/admin.routes.js";
import type { AdminManagementApi } from "./services/admin-management.service.js";
import type { AdminTicketApi } from "./services/admin-ticket.service.js";
import type { CategoryApi } from "./services/category.service.js";
import type { TicketApi } from "./services/ticket.service.js";
import type { TechnicianTicketApi } from "./services/technician-ticket.service.js";
import type { MicrosoftAuthDependencies } from "./controllers/microsoft-auth.controller.js";
import type { AttachmentApi } from "./services/attachment.service.js";
import type { PeerTicketApi } from "./services/peer-integrations/peer-ticket.service.js";
import type { EduCoreContextApi } from "./services/peer-integrations/educore-context.service.js";
import { createPeerRouter } from "./routes/peer.routes.js";

export type AppDependencies = {
  users: UserRepository;
  sessions: SessionService;
  categories: CategoryApi;
  tickets: TicketApi;
  technicianTickets: TechnicianTicketApi;
  adminTickets: AdminTicketApi;
  adminManagement: AdminManagementApi;
  attachments: AttachmentApi;
  peer?: { apiKey: string; tickets: PeerTicketApi; context: EduCoreContextApi } | undefined;
  microsoft?: MicrosoftAuthDependencies | undefined;
  nodeEnv: "development" | "test" | "production";
};

export const createApp = (dependencies: AppDependencies) => {
  const app = express();
  const isProduction = dependencies.nodeEnv === "production";

  app.disable("x-powered-by");
  app.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api/health", healthRouter);
  app.use("/api/auth", createAuthRouter(dependencies.users, dependencies.sessions, isProduction, dependencies.microsoft));
  app.use("/api/categories", createCategoryRouter(dependencies.users, dependencies.sessions, dependencies.categories));
  if (dependencies.peer) app.use("/api/peer", createPeerRouter(dependencies.peer.apiKey, dependencies.peer.tickets));
  app.use(
    "/api/admin",
    createAdminRouter(
      dependencies.users,
      dependencies.sessions,
      dependencies.adminTickets,
      dependencies.adminManagement,
    ),
  );
  app.use(
    "/api/tickets",
    createTicketRouter(
      dependencies.users,
      dependencies.sessions,
      dependencies.tickets,
      dependencies.technicianTickets,
      dependencies.attachments,
      dependencies.peer?.context,
    ),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
