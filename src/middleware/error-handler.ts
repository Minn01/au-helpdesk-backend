import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../errors/http-error.js";
import { logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    error: "Not Found",
    message: `No route for ${request.method} ${request.originalUrl}`,
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: error.code,
      message: error.message,
    });
    return;
  }

  logger.error("Unhandled request error", {
    error: error instanceof Error ? error.message : String(error),
    method: request.method,
    path: request.originalUrl,
  });

  response.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred",
  });
};
