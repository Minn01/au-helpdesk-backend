import { type Prisma, TicketStatus } from "../../generated/prisma/client.js";

type TechnicianTicketSnapshot = {
  assignedTechnicianId: string | null;
  status: TicketStatus;
};

export const technicianTicketRelevanceWhere = (technicianId: string): Prisma.TicketWhereInput => ({
  OR: [
    { status: TicketStatus.OPEN, assignedTechnicianId: null },
    { assignedTechnicianId: technicianId },
  ],
});

export const isTicketRelevantToTechnician = (
  ticket: TechnicianTicketSnapshot,
  technicianId: string,
): boolean => ticket.assignedTechnicianId === technicianId
  || (ticket.status === TicketStatus.OPEN && ticket.assignedTechnicianId === null);
