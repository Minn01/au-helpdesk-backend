import cookieParser from "cookie-parser";
import express from "express";
import type { SessionService } from "./auth/session.service.js";
import type { UserRepository } from "./auth/auth.types.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createDevelopmentAuthRouter } from "./routes/dev-auth.routes.js";
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

export type AppDependencies = {
  users: UserRepository;
  sessions: SessionService;
  categories: CategoryApi;
  tickets: TicketApi;
  technicianTickets: TechnicianTicketApi;
  adminTickets: AdminTicketApi;
  adminManagement: AdminManagementApi;
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
    ),
  );
  if (dependencies.nodeEnv === "development") {
    app.use(
      "/api/dev/auth",
      createDevelopmentAuthRouter(dependencies.users, dependencies.sessions, isProduction),
    );
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
