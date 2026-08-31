import type { RequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../errors/http-error.js";
import {
  isAllowedDeclaredMimeType,
  MAX_ATTACHMENTS_PER_REQUEST,
  MAX_ATTACHMENT_BYTES,
} from "../validation/attachment.validation.js";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_REQUEST, fields: 0 },
  fileFilter: (_request, file, callback) => {
    if (!isAllowedDeclaredMimeType(file.mimetype)) {
      callback(new HttpError(415, "UNSUPPORTED_FILE_TYPE", "This attachment type is not allowed"));
      return;
    }
    callback(null, true);
  },
}).array("files", MAX_ATTACHMENTS_PER_REQUEST);

export const parseAttachmentUpload: RequestHandler = (request, response, next) => {
  parser(request, response, (error) => {
    if (!error) { next(); return; }
    if (error instanceof HttpError) { next(error); return; }
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(413, "FILE_TOO_LARGE", "Each attachment must be 13 MB or smaller"));
        return;
      }
      if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
        next(new HttpError(400, "TOO_MANY_FILES", `Upload at most ${MAX_ATTACHMENTS_PER_REQUEST} files using the files field`));
        return;
      }
    }
    next(new HttpError(400, "INVALID_MULTIPART_UPLOAD", "The multipart attachment upload is invalid"));
  });
};
