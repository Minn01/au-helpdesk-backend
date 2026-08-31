import { Router } from "express";
import { createPeerController } from "../controllers/peer.controller.js";
import { requirePeerApiKey } from "../middleware/peer-api-key.middleware.js";
import type { PeerTicketApi } from "../services/peer-integrations/peer-ticket.service.js";

export const createPeerRouter = (apiKey: string, tickets: PeerTicketApi) => {
  const router = Router();
  const controller = createPeerController(tickets);
  router.use(requirePeerApiKey(apiKey));
  router.post("/educore/tickets", controller.createEduCoreTicket);
  return router;
};
