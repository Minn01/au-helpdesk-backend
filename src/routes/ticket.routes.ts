import { Router } from "express";
import { UserRole } from "../../generated/prisma/client.js";
import type { SessionService } from "../auth/session.service.js";
import type { UserRepository } from "../auth/auth.types.js";
import { createTicketController } from "../controllers/ticket.controller.js";
import { createTechnicianTicketController } from "../controllers/technician-ticket.controller.js";
import { createRequireAuth, requireAnyRole } from "../middleware/auth.middleware.js";
import type { TechnicianTicketApi } from "../services/technician-ticket.service.js";
import type { TicketApi } from "../services/ticket.service.js";
import type { AttachmentApi } from "../services/attachment.service.js";
import { createAttachmentController } from "../controllers/attachment.controller.js";
import { parseAttachmentUpload } from "../middleware/attachment-upload.middleware.js";
import type { EduCoreContextApi } from "../services/peer-integrations/educore-context.service.js";
import { createEduCoreContextController } from "../controllers/peer.controller.js";

export const createTicketRouter = (
  users: UserRepository,
  sessions: SessionService,
  tickets: TicketApi,
  technicianTickets: TechnicianTicketApi,
  attachments: AttachmentApi,
  educoreContext?: EduCoreContextApi,
) => {
  const router = Router();
  const requester = createTicketController(tickets);
  const technician = createTechnicianTicketController(technicianTickets);
  const attachment = createAttachmentController(attachments);
  const educore = educoreContext ? createEduCoreContextController(educoreContext) : undefined;
  const requesterOnly = requireAnyRole(UserRole.STUDENT, UserRole.FACULTY);
  const technicianOnly = requireAnyRole(UserRole.TECHNICIAN);
  const ticketUser = requireAnyRole(UserRole.STUDENT, UserRole.FACULTY, UserRole.TECHNICIAN);
  const attachmentUser = requireAnyRole(UserRole.STUDENT, UserRole.FACULTY, UserRole.TECHNICIAN, UserRole.ADMIN);
  const dispatch = (requesterHandler: typeof requester.getOne, technicianHandler: typeof technician.getOne) =>
    ((request, response, next) => request.user!.role === UserRole.TECHNICIAN
      ? technicianHandler(request, response, next)
      : requesterHandler(request, response, next)) satisfies typeof requester.getOne;

  router.use(createRequireAuth(users, sessions));
  router.get("/queue", technicianOnly, technician.listQueue);
  router.get("/assigned", technicianOnly, technician.listAssigned);
  router.get("/mine", requesterOnly, requester.listMine);
  router.post("/", requesterOnly, requester.create);
  router.post("/:ticketId/claim", technicianOnly, technician.claim);
  router.post("/:ticketId/start", technicianOnly, technician.start);
  router.post("/:ticketId/resolve", technicianOnly, technician.resolve);
  router.patch("/:ticketId/classification", technicianOnly, technician.updateClassification);
  router.post("/:ticketId/attachments", attachmentUser, parseAttachmentUpload, attachment.upload);
  router.get("/:ticketId/attachments/:attachmentId/url", attachmentUser, attachment.createUrl);
  router.delete("/:ticketId/attachments/:attachmentId", attachmentUser, attachment.remove);
  if (educore) router.get("/:ticketId/educore-context", attachmentUser, educore.get);
  router.get("/:ticketId/comments", ticketUser, dispatch(requester.listComments, technician.listComments));
  router.post("/:ticketId/comments", ticketUser, dispatch(requester.addComment, technician.addComment));
  router.get("/:ticketId/activity", ticketUser, dispatch(requester.listActivity, technician.listActivity));
  router.post("/:ticketId/cancel", requesterOnly, requester.cancel);
  router.get("/:ticketId", ticketUser, dispatch(requester.getOne, technician.getOne));
  router.patch("/:ticketId", requesterOnly, requester.update);
  return router;
};
