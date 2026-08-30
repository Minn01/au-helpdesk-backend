import type { RequestHandler } from "express";
import type { TicketApi } from "../services/ticket.service.js";
import { parseUuid } from "../validation/common.js";
import {
  parseComment,
  parseCreateTicket,
  parseMineQuery,
  parseUpdateTicket,
} from "../validation/ticket.validation.js";

const userId = (request: Parameters<RequestHandler>[0]) => request.user!.id;
const ticketId = (request: Parameters<RequestHandler>[0]) => parseUuid(request.params.ticketId, "ticketId");

export const createTicketController = (tickets: TicketApi) => ({
  listMine: (async (request, response, next) => {
    try {
      response.status(200).json(await tickets.listMine(userId(request), parseMineQuery(request.query)));
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  getOne: (async (request, response, next) => {
    try {
      response.status(200).json({ ticket: await tickets.getOwnedDetails(ticketId(request), userId(request)) });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  create: (async (request, response, next) => {
    try {
      const ticket = await tickets.create(userId(request), parseCreateTicket(request.body));
      response.status(201).json({ ticket });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  update: (async (request, response, next) => {
    try {
      const ticket = await tickets.update(
        ticketId(request),
        userId(request),
        parseUpdateTicket(request.body),
      );
      response.status(200).json({ ticket });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  cancel: (async (request, response, next) => {
    try {
      const ticket = await tickets.cancel(ticketId(request), userId(request));
      response.status(200).json({ ticket });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  listComments: (async (request, response, next) => {
    try {
      const comments = await tickets.listComments(ticketId(request), userId(request));
      response.status(200).json({ comments });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  addComment: (async (request, response, next) => {
    try {
      const input = parseComment(request.body);
      const comment = await tickets.addComment(ticketId(request), userId(request), input.body);
      response.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  listActivity: (async (request, response, next) => {
    try {
      const ticket = await tickets.getOwnedDetails(ticketId(request), userId(request));
      response.status(200).json({ activities: ticket.activities });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,
});
