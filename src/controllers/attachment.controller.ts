import type { RequestHandler } from "express";
import type { AttachmentApi } from "../services/attachment.service.js";
import { parseUuid } from "../validation/common.js";

const id = (request: Parameters<RequestHandler>[0], name: string) => parseUuid(request.params[name], name);

export const createAttachmentController = (attachments: AttachmentApi) => ({
  upload: (async (request, response, next) => {
    try {
      const uploaded = await attachments.upload(id(request, "ticketId"), request.user!, request.files as Express.Multer.File[] ?? []);
      response.status(201).json({ attachments: uploaded });
    } catch (error) { next(error); }
  }) satisfies RequestHandler,

  createUrl: (async (request, response, next) => {
    try {
      response.status(200).json(await attachments.createUrl(
        id(request, "ticketId"), id(request, "attachmentId"), request.user!,
      ));
    } catch (error) { next(error); }
  }) satisfies RequestHandler,

  remove: (async (request, response, next) => {
    try {
      await attachments.remove(id(request, "ticketId"), id(request, "attachmentId"), request.user!);
      response.status(204).send();
    } catch (error) { next(error); }
  }) satisfies RequestHandler,
});
