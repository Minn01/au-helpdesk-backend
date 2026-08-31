import { createApp } from "./app.js";
import { createSessionService } from "./auth/session.service.js";
import { createUserRepository } from "./auth/user.repository.js";
import type { AppConfig } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { CategoryService } from "./services/category.service.js";
import { fallbackClassificationService } from "./services/classification.service.js";
import { TicketService } from "./services/ticket.service.js";
import { TechnicianTicketService } from "./services/technician-ticket.service.js";
import { AdminManagementService } from "./services/admin-management.service.js";
import { AdminTicketService } from "./services/admin-ticket.service.js";
import { MsalMicrosoftOAuthClient, PrismaMicrosoftUserProvisioner } from "./auth/microsoft-auth.service.js";
import { createOAuthStateService } from "./auth/oauth-state.service.js";
import { SupabaseStorageService } from "./storage/storage.service.js";
import { AttachmentService } from "./services/attachment.service.js";
import { HttpEduCoreClient } from "./services/peer-integrations/educore.client.js";
import { EduCoreContextService } from "./services/peer-integrations/educore-context.service.js";
import { PeerTicketService } from "./services/peer-integrations/peer-ticket.service.js";

export const createDefaultApp = (config: AppConfig) => {
  const prisma = createPrismaClient(config.databaseUrl);
  const storage = new SupabaseStorageService(config.supabase.url, config.supabase.secretKey, config.supabase.storageBucket);
  const microsoft = config.microsoft ? {
    config: config.microsoft,
    oauth: new MsalMicrosoftOAuthClient(config.microsoft),
    users: new PrismaMicrosoftUserProvisioner(prisma),
    state: createOAuthStateService(config.jwtSecret),
    sessions: createSessionService(config.jwtSecret),
    isProduction: config.nodeEnv === "production",
  } : undefined;
  const educoreClient = config.educore ? new HttpEduCoreClient({
    baseUrl: config.educore.baseUrl,
    apiKey: config.educore.outgoingApiKey,
    contextPathTemplate: config.educore.contextPathTemplate,
    timeoutMs: config.educore.timeoutMs,
  }) : undefined;
  return createApp({
    users: createUserRepository(prisma),
    sessions: createSessionService(config.jwtSecret),
    categories: new CategoryService(prisma),
    tickets: new TicketService(prisma, fallbackClassificationService),
    technicianTickets: new TechnicianTicketService(prisma),
    adminTickets: new AdminTicketService(prisma),
    adminManagement: new AdminManagementService(prisma),
    attachments: new AttachmentService(prisma, storage),
    peer: config.educore && educoreClient ? {
      apiKey: config.educore.incomingApiKey,
      tickets: new PeerTicketService(prisma),
      context: new EduCoreContextService(prisma, educoreClient),
    } : undefined,
    microsoft,
    nodeEnv: config.nodeEnv,
  });
};
