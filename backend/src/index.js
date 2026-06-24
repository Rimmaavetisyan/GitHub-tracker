import "dotenv/config";
import { loadConfig }      from "./config.js";
import { createLogger }    from "./logger.js";
import { createGitHubClient } from "./github.js";
import { createDatabase }  from "./database.js";
import { createNotifier }  from "./notifier.js";
import { createPoller }    from "./poller.js";

function main() {
  const config   = loadConfig();
  const logger   = createLogger({ level: config.logLevel });

  const db       = createDatabase({ dbPath: config.dbPath });
  const ghClient = createGitHubClient({ token: config.token, logger });
  const notifier = createNotifier({ logger });
  const poller   = createPoller({ githubClient: ghClient, db, notifier, logger, repos: config.repos });

  logger.info("tracker_start", { repos: config.repos, poll_interval_ms: config.pollIntervalMs });

  poller.start(config.pollIntervalMs);

  const shutdown = (signal) => {
    logger.info("shutdown", { signal });
    db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

main();
