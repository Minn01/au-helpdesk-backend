import "dotenv/config";
import { createDefaultApp } from "./bootstrap.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const server = createDefaultApp().listen(env.port, () => {
  logger.info("AU HelpDesk API started", {
    environment: env.nodeEnv,
    port: env.port,
  });
});

const shutdown = (signal: NodeJS.Signals) => {
  logger.info("Shutting down AU HelpDesk API", { signal });
  server.close((error) => {
    if (error) {
      logger.error("Failed to close HTTP server", { error: error.message });
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
