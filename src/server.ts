import "dotenv/config";
import { createDefaultApp } from "./bootstrap.js";
import { loadConfiguration } from "./config/env.js";
import { logger } from "./lib/logger.js";

const config = await loadConfiguration();
const server = createDefaultApp(config).listen(config.port, () => {
  logger.info("AU HelpDesk API started", {
    environment: config.nodeEnv,
    port: config.port,
    secretSource: config.secretSource,
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
