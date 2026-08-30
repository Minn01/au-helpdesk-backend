import type { RequestHandler } from "express";

export const getHealth: RequestHandler = (_request, response) => {
  response.status(200).json({
    service: "au-helpdesk-api",
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
};
