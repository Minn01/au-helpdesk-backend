import type { RequestHandler } from "express";
import type { TechnicianTicketApi } from "../services/technician-ticket.service.js";
import { parseUuid } from "../validation/common.js";
import { parseComment } from "../validation/ticket.validation.js";
import {
  parseAssignedQuery,
  parseClassificationUpdate,
  parseQueueQuery,
} from "../validation/technician.validation.js";

const userId = (request: Parameters<RequestHandler>[0]) => request.user!.id;
const ticketId = (request: Parameters<RequestHandler>[0]) => parseUuid(request.params.ticketId, "ticketId");

export const createTechnicianTicketController = (tickets: TechnicianTicketApi) => ({
  listQueue: (async (request, response, next) => {
    try {
      response.status(200).json(await tickets.listQueue(parseQueueQuery(request.query)));
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  listAssigned: (async (request, response, next) => {
    try {
      response.status(200).json(await tickets.listAssigned(userId(request), parseAssignedQuery(request.query)));
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  getOne: (async (request, response, next) => {
    try {
      response.status(200).json({ ticket: await tickets.getRelevantDetails(ticketId(request), userId(request)) });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  claim: (async (request, response, next) => {
    try {
      response.status(200).json({ ticket: await tickets.claim(ticketId(request), userId(request)) });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  start: (async (request, response, next) => {
    try {
      response.status(200).json({ ticket: await tickets.start(ticketId(request), userId(request)) });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  resolve: (async (request, response, next) => {
    try {
      response.status(200).json({ ticket: await tickets.resolve(ticketId(request), userId(request)) });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  updateClassification: (async (request, response, next) => {
    try {
      const ticket = await tickets.updateClassification(
        ticketId(request),
        userId(request),
        parseClassificationUpdate(request.body),
      );
      response.status(200).json({ ticket });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  listComments: (async (request, response, next) => {
    try {
      response.status(200).json({ comments: await tickets.listComments(ticketId(request), userId(request)) });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  addComment: (async (request, response, next) => {
    try {
      const input = parseComment(request.body);
      response.status(201).json({
        comment: await tickets.addComment(ticketId(request), userId(request), input.body),
      });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,

  listActivity: (async (request, response, next) => {
    try {
      const ticket = await tickets.getRelevantDetails(ticketId(request), userId(request));
      response.status(200).json({ activities: ticket.activities });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,
});
