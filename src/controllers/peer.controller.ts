import type { RequestHandler } from "express";
import type { EduCoreContextApi } from "../services/peer-integrations/educore-context.service.js";
import type { PeerTicketApi } from "../services/peer-integrations/peer-ticket.service.js";
import { parseUuid } from "../validation/common.js";
import { parseEduCoreTicket } from "../validation/peer.validation.js";

export const createPeerController = (tickets: PeerTicketApi) => ({
  createEduCoreTicket: (async (request, response, next) => {
    try {
      const result = await tickets.createFromEduCore(parseEduCoreTicket(request.body));
      response.status(result.created ? 201 : 200).json(result);
    } catch (error) { next(error); }
  }) satisfies RequestHandler,
});

export const createEduCoreContextController = (context: EduCoreContextApi) => ({
  get: (async (request, response, next) => {
    try {
      const ticketId = parseUuid(request.params.ticketId, "ticketId");
      response.status(200).json({ context: await context.getForTicket(ticketId, request.user!) });
    } catch (error) { next(error); }
  }) satisfies RequestHandler,
});
