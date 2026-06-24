import "dotenv/config";
import express             from "express";
import { loadConfig }     from "./config.js";
import { createLogger }   from "./logger.js";
import { createDatabase } from "./database.js";

function main() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const db     = createDatabase({ dbPath: config.dbPath });

  const app = express();

  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
    res.setHeader("Access-Control-Allow-Methods", "GET");
    next();
  });

  app.get("/api/events", (_req, res) => res.json(db.getRecentEvents(100)));
  app.get("/api/stats",  (_req, res) => res.json(db.getSummaryStats()));

  app.listen(config.port, () => {
    logger.info("server_start", { port: config.port });
  });
}

main();
