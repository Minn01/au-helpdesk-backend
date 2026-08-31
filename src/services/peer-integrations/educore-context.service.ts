import { PeerSourceSystem, type PrismaClient, TicketStatus, UserRole } from "../../../generated/prisma/client.js";
import type { AuthUser } from "../../auth/auth.types.js";
import { HttpError } from "../../errors/http-error.js";
import type { EduCoreClient } from "./educore.client.js";

export class EduCoreContextService {
  constructor(private readonly database: PrismaClient, private readonly educore: EduCoreClient) {}

  async getForTicket(ticketId: string, actor: AuthUser) {
    if (actor.role !== UserRole.TECHNICIAN && actor.role !== UserRole.ADMIN) {
      throw new HttpError(403, "FORBIDDEN", "EduCore diagnostic context is restricted to support staff");
    }
    const ticket = await this.database.ticket.findUnique({
      where: { id: ticketId },
      select: {
        assignedTechnicianId: true,
        status: true,
        peerReferences: {
          where: { sourceSystem: PeerSourceSystem.EDUCORE },
          take: 1,
          select: { externalEventId: true },
        },
      },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    if (
      actor.role === UserRole.TECHNICIAN
      && ticket.assignedTechnicianId !== actor.id
      && !(ticket.status === TicketStatus.OPEN && ticket.assignedTechnicianId === null)
    ) {
      throw new HttpError(403, "FORBIDDEN", "You are not authorized to investigate this ticket");
    }
    const reference = ticket.peerReferences[0];
    if (!reference) {
      throw new HttpError(404, "EDUCORE_CONTEXT_NOT_AVAILABLE", "This ticket has no EduCore registration reference");
    }
    return this.educore.getRegistrationContext(reference.externalEventId);
  }
}

export type EduCoreContextApi = Pick<EduCoreContextService, "getForTicket">;
