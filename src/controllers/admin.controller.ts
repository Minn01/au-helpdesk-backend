import type { RequestHandler } from "express";
import type { AdminManagementApi } from "../services/admin-management.service.js";
import type { AdminTicketApi } from "../services/admin-ticket.service.js";
import { parseUuid } from "../validation/common.js";
import {
  parseAdminTicketQuery,
  parseAssignment,
  parseCreateCategory,
  parseUpdateCategory,
  parseUserQuery,
  parseUserUpdate,
} from "../validation/admin.validation.js";

const id = (request: Parameters<RequestHandler>[0], name: string) => parseUuid(request.params[name], name);

export const createAdminController = (tickets: AdminTicketApi, management: AdminManagementApi) => ({
  dashboard: (async (_request, response, next) => {
    try { response.status(200).json(await management.dashboard()); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  listTickets: (async (request, response, next) => {
    try { response.status(200).json(await tickets.listAll(parseAdminTicketQuery(request.query))); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  getTicket: (async (request, response, next) => {
    try { response.status(200).json({ ticket: await tickets.getDetails(id(request, "ticketId")) }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  assignTicket: (async (request, response, next) => {
    try {
      const input = parseAssignment(request.body);
      response.status(200).json({ ticket: await tickets.assign(id(request, "ticketId"), input.technicianId, request.user!.id) });
    } catch (error) { next(error); }
  }) satisfies RequestHandler,
  listCategories: (async (_request, response, next) => {
    try { response.status(200).json({ categories: await management.listCategories() }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  createCategory: (async (request, response, next) => {
    try { response.status(201).json({ category: await management.createCategory(parseCreateCategory(request.body)) }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  updateCategory: (async (request, response, next) => {
    try { response.status(200).json({ category: await management.updateCategory(id(request, "categoryId"), parseUpdateCategory(request.body)) }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  disableCategory: (async (request, response, next) => {
    try { response.status(200).json({ category: await management.setCategoryActive(id(request, "categoryId"), false) }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  enableCategory: (async (request, response, next) => {
    try { response.status(200).json({ category: await management.setCategoryActive(id(request, "categoryId"), true) }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  listUsers: (async (request, response, next) => {
    try { response.status(200).json({ users: await management.listUsers(parseUserQuery(request.query)) }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
  updateUser: (async (request, response, next) => {
    try { response.status(200).json({ user: await management.updateUser(id(request, "userId"), parseUserUpdate(request.body), request.user!.id) }); } catch (error) { next(error); }
  }) satisfies RequestHandler,
});
