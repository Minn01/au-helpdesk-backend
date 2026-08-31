import {
  CategorySource,
  PeerSourceSystem,
  Prisma,
  type PrismaClient,
  TicketPriority,
  UserRole,
} from "../../../generated/prisma/client.js";
import { HttpError } from "../../errors/http-error.js";
import type { EduCoreTicketInput } from "../../validation/peer.validation.js";

const ticketSelect = { id: true, ticketNumber: true, status: true } as const;

export class PeerTicketService {
  constructor(private readonly database: PrismaClient) {}

  async createFromEduCore(input: EduCoreTicketInput) {
    const existing = await this.findExisting(input.eventId);
    if (existing) return { ticket: existing, created: false };
    const student = await this.database.user.findFirst({
      where: {
        email: { equals: input.student.email, mode: "insensitive" },
        isActive: true,
        role: { in: [UserRole.STUDENT, UserRole.FACULTY] },
      },
      select: { id: true },
    });
    if (!student) throw new HttpError(404, "STUDENT_NOT_FOUND", "No active HelpDesk requester matches this student");
    const category = await this.database.category.findFirst({
      where: { name: { equals: "Course Registration", mode: "insensitive" }, isActive: true },
      select: { id: true },
    });
    if (!category) throw new HttpError(503, "PEER_CATEGORY_UNAVAILABLE", "Course Registration category is unavailable");

    try {
      const ticket = await this.database.$transaction(async (transaction) => transaction.ticket.create({
        data: {
          creatorId: student.id,
          title: "Course registration technical issue",
          description: this.description(input),
          categoryId: category.id,
          categorySource: CategorySource.PEER_INTEGRATION,
          priority: TicketPriority.HIGH,
          peerReferences: {
            create: { sourceSystem: PeerSourceSystem.EDUCORE, externalEventId: input.eventId },
          },
          activities: {
            create: {
              type: "PEER_TICKET_CREATED",
              message: "Ticket automatically created from EduCore",
              metadata: {
                sourceSystem: PeerSourceSystem.EDUCORE,
                externalEventId: input.eventId,
                courseCode: input.course.courseCode,
              },
            },
          },
        },
        select: ticketSelect,
      }));
      return { ticket, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await this.findExisting(input.eventId);
        if (replay) return { ticket: replay, created: false };
      }
      throw error;
    }
  }

  private async findExisting(externalEventId: string) {
    const reference = await this.database.peerTicketReference.findUnique({
      where: { sourceSystem_externalEventId: { sourceSystem: PeerSourceSystem.EDUCORE, externalEventId } },
      select: { ticket: { select: ticketSelect } },
    });
    return reference?.ticket ?? null;
  }

  private description(input: EduCoreTicketInput) {
    return [
      "EduCore reported a technical failure during course registration.",
      `Student: ${input.student.name} (${input.student.email})`,
      `Course: ${input.course.courseCode}${input.course.courseName ? ` — ${input.course.courseName}` : ""}`,
      `Registration status: ${input.registrationStatus}`,
      `Failure reason: ${input.failureReason}`,
      `Occurred at: ${input.occurredAt}`,
    ].join("\n");
  }
}

export type PeerTicketApi = Pick<PeerTicketService, "createFromEduCore">;
