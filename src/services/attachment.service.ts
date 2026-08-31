import { randomUUID } from "node:crypto";
import {
  type Prisma,
  type PrismaClient,
  TicketStatus,
  UserRole,
} from "../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.types.js";
import { HttpError } from "../errors/http-error.js";
import { logger } from "../lib/logger.js";
import type { StorageService, StoredFile } from "../storage/storage.service.js";
import { validateAttachmentFile } from "../validation/attachment.validation.js";
import { attachmentSelect } from "./attachment-select.js";

const activeStatuses = [TicketStatus.OPEN, TicketStatus.CLAIMED, TicketStatus.IN_PROGRESS] as const;
const signedUrlLifetimeSeconds = 600;
type Database = PrismaClient | Prisma.TransactionClient;

type UploadFile = ReturnType<typeof validateAttachmentFile> & { storagePath: string };

export class AttachmentService {
  constructor(private readonly database: PrismaClient, private readonly storage: StorageService) {}

  async upload(ticketId: string, actor: AuthUser, files: Express.Multer.File[]) {
    if (files.length === 0) throw new HttpError(400, "ATTACHMENT_REQUIRED", "Provide at least one file in the files field");
    await this.assertUploadAccess(this.database, ticketId, actor);
    const prepared: UploadFile[] = files.map((file) => {
      const validated = validateAttachmentFile(file);
      return {
        ...validated,
        storagePath: `tickets/${ticketId}/${randomUUID()}-${validated.fileName}`,
      };
    });
    const uploaded: UploadFile[] = [];
    try {
      for (const file of prepared) {
        await this.storage.upload(file.storagePath, { body: file.body, contentType: file.mimeType });
        uploaded.push(file);
      }
    } catch (error) {
      await this.cleanupUploaded(uploaded, ticketId, actor.id);
      throw new HttpError(502, "ATTACHMENT_UPLOAD_FAILED", "Attachment storage is temporarily unavailable");
    }

    try {
      return await this.database.$transaction(async (transaction) => {
        await this.assertUploadAccess(transaction, ticketId, actor);
        const attachments = [];
        for (const file of prepared) {
          const attachment = await transaction.attachment.create({
            data: {
              ticketId,
              uploadedById: actor.id,
              fileName: file.fileName,
              storagePath: file.storagePath,
              mimeType: file.mimeType,
              sizeBytes: BigInt(file.sizeBytes),
            },
            select: attachmentSelect,
          });
          attachments.push(attachment);
          await transaction.ticketActivity.create({
            data: {
              ticketId,
              actorId: actor.id,
              type: "ATTACHMENT_UPLOADED",
              message: "Attachment uploaded",
              metadata: { attachmentId: attachment.id, fileName: attachment.fileName },
            },
          });
        }
        return attachments;
      });
    } catch (error) {
      await this.cleanupUploaded(uploaded, ticketId, actor.id);
      if (error instanceof HttpError) throw error;
      logger.error("Attachment metadata creation failed", { ticketId, actorId: actor.id, fileCount: prepared.length });
      throw new HttpError(500, "ATTACHMENT_UPLOAD_FAILED", "Attachment metadata could not be saved");
    }
  }

  async createUrl(ticketId: string, attachmentId: string, actor: AuthUser) {
    await this.assertViewAccess(ticketId, actor);
    const attachment = await this.database.attachment.findFirst({
      where: { id: attachmentId, ticketId },
      select: { id: true, storagePath: true },
    });
    if (!attachment) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
    try {
      const url = await this.storage.createSignedUrl(attachment.storagePath, signedUrlLifetimeSeconds);
      return { url, expiresAt: new Date(Date.now() + signedUrlLifetimeSeconds * 1_000).toISOString() };
    } catch {
      logger.warn("Attachment signed URL creation failed", { ticketId, attachmentId });
      throw new HttpError(502, "ATTACHMENT_RETRIEVAL_FAILED", "Attachment storage is temporarily unavailable");
    }
  }

  async remove(ticketId: string, attachmentId: string, actor: AuthUser) {
    const attachment = await this.findAttachmentForRemoval(ticketId, attachmentId, actor);
    let backup: StoredFile;
    try {
      backup = await this.storage.download(attachment.storagePath);
      await this.storage.remove(attachment.storagePath);
    } catch {
      logger.warn("Attachment storage removal failed", { ticketId, attachmentId, actorId: actor.id });
      throw new HttpError(502, "ATTACHMENT_DELETE_FAILED", "Attachment storage is temporarily unavailable");
    }

    try {
      await this.database.$transaction(async (transaction) => {
        await this.assertRemovalAccess(transaction, ticketId, actor, attachment.uploadedById);
        const deleted = await transaction.attachment.deleteMany({ where: { id: attachmentId, ticketId } });
        if (deleted.count !== 1) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
        await transaction.ticketActivity.create({
          data: {
            ticketId,
            actorId: actor.id,
            type: "ATTACHMENT_REMOVED",
            message: "Attachment removed",
            metadata: { attachmentId, fileName: attachment.fileName },
          },
        });
      });
    } catch (error) {
      try {
        await this.storage.upload(attachment.storagePath, { ...backup, contentType: attachment.mimeType });
      } catch {
        logger.error("Attachment restoration failed after database error", { ticketId, attachmentId, actorId: actor.id });
      }
      if (error instanceof HttpError) throw error;
      logger.error("Attachment metadata removal failed", { ticketId, attachmentId, actorId: actor.id });
      throw new HttpError(500, "ATTACHMENT_DELETE_FAILED", "Attachment metadata could not be removed");
    }
  }

  private async assertUploadAccess(database: Database, ticketId: string, actor: AuthUser) {
    const ticket = await database.ticket.findUnique({
      where: { id: ticketId },
      select: { creatorId: true, assignedTechnicianId: true, status: true },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    const active = activeStatuses.includes(ticket.status as typeof activeStatuses[number]);
    const allowed = actor.role === UserRole.ADMIN
      ? active
      : actor.role === UserRole.TECHNICIAN
        ? ticket.assignedTechnicianId === actor.id && active
        : ticket.creatorId === actor.id && active;
    if (!allowed) throw new HttpError(403, "ATTACHMENT_ACCESS_DENIED", "You cannot upload attachments to this ticket");
  }

  private async assertViewAccess(ticketId: string, actor: AuthUser) {
    const ticket = await this.database.ticket.findUnique({
      where: { id: ticketId },
      select: { creatorId: true, assignedTechnicianId: true, status: true },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    const allowed = actor.role === UserRole.ADMIN
      || (actor.role === UserRole.TECHNICIAN
        ? ticket.assignedTechnicianId === actor.id || (ticket.status === TicketStatus.OPEN && !ticket.assignedTechnicianId)
        : ticket.creatorId === actor.id);
    if (!allowed) throw new HttpError(403, "ATTACHMENT_ACCESS_DENIED", "You cannot view attachments for this ticket");
  }

  private async findAttachmentForRemoval(ticketId: string, attachmentId: string, actor: AuthUser) {
    const attachment = await this.database.attachment.findFirst({
      where: { id: attachmentId, ticketId },
      select: { id: true, fileName: true, storagePath: true, mimeType: true, uploadedById: true },
    });
    if (!attachment) {
      const ticket = await this.database.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
      if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
      throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
    }
    await this.assertRemovalAccess(this.database, ticketId, actor, attachment.uploadedById);
    return attachment;
  }

  private async assertRemovalAccess(database: Database, ticketId: string, actor: AuthUser, uploadedById: string) {
    const ticket = await database.ticket.findUnique({
      where: { id: ticketId },
      select: { creatorId: true, assignedTechnicianId: true, status: true },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    const allowed = actor.role === UserRole.ADMIN
      || (actor.role === UserRole.TECHNICIAN
        ? ticket.assignedTechnicianId === actor.id && uploadedById === actor.id && activeStatuses.includes(ticket.status as typeof activeStatuses[number])
        : ticket.creatorId === actor.id && uploadedById === actor.id && ticket.status === TicketStatus.OPEN);
    if (!allowed) throw new HttpError(403, "ATTACHMENT_ACCESS_DENIED", "You cannot remove this attachment");
  }

  private async cleanupUploaded(files: UploadFile[], ticketId: string, actorId: string) {
    const results = await Promise.allSettled(files.map((file) => this.storage.remove(file.storagePath)));
    if (results.some((result) => result.status === "rejected")) {
      logger.error("Attachment upload cleanup was incomplete", { ticketId, actorId, fileCount: files.length });
    }
  }
}

export type AttachmentApi = Pick<AttachmentService, "upload" | "createUrl" | "remove">;
