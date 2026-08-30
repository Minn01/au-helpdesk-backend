import { createApp } from "./app.js";
import { createSessionService } from "./auth/session.service.js";
import { userRepository } from "./auth/user.repository.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { CategoryService } from "./services/category.service.js";
import { fallbackClassificationService } from "./services/classification.service.js";
import { TicketService } from "./services/ticket.service.js";
import { TechnicianTicketService } from "./services/technician-ticket.service.js";
import { AdminManagementService } from "./services/admin-management.service.js";
import { AdminTicketService } from "./services/admin-ticket.service.js";
import { MsalMicrosoftOAuthClient, PrismaMicrosoftUserProvisioner } from "./auth/microsoft-auth.service.js";
import { createOAuthStateService } from "./auth/oauth-state.service.js";

export const createDefaultApp = () => {
  const microsoft = env.microsoft ? {
    config: env.microsoft,
    oauth: new MsalMicrosoftOAuthClient(env.microsoft),
    users: new PrismaMicrosoftUserProvisioner(prisma),
    state: createOAuthStateService(env.jwtSecret),
    sessions: createSessionService(env.jwtSecret),
    isProduction: env.nodeEnv === "production",
  } : undefined;
  return createApp({
    users: userRepository,
    sessions: createSessionService(env.jwtSecret),
    categories: new CategoryService(prisma),
    tickets: new TicketService(prisma, fallbackClassificationService),
    technicianTickets: new TechnicianTicketService(prisma),
    adminTickets: new AdminTicketService(prisma),
    adminManagement: new AdminManagementService(prisma),
    microsoft,
    nodeEnv: env.nodeEnv,
  });
};
