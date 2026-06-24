import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "..", "tracker.db");

export function createDatabase({ dbPath } = {}) {
  const db = new DatabaseSync(dbPath ?? DEFAULT_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS poll_logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      repo              TEXT    NOT NULL,
      polled_at         TEXT    NOT NULL,
      internal_trace_id TEXT    NOT NULL,
      github_request_id TEXT,
      http_status       INTEGER,
      error_type        TEXT,
      prs_found         INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pr_events (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      repo              TEXT    NOT NULL,
      pr_number         INTEGER NOT NULL,
      pr_title          TEXT    NOT NULL,
      pr_author         TEXT    NOT NULL,
      event_type        TEXT    NOT NULL CHECK(event_type IN ('opened','merged')),
      event_at          TEXT    NOT NULL,
      internal_trace_id TEXT    NOT NULL,
      github_request_id TEXT,
      recorded_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, pr_number, event_type)
    );
  `);

  return {
    insertPollLog({ repo, polled_at, internal_trace_id, github_request_id, http_status, error_type, prs_found }) {
      db.prepare(`
        INSERT INTO poll_logs (repo, polled_at, internal_trace_id, github_request_id, http_status, error_type, prs_found)
        VALUES (@repo, @polled_at, @internal_trace_id, @github_request_id, @http_status, @error_type, @prs_found)
      `).run({ repo, polled_at, internal_trace_id, github_request_id: github_request_id ?? null, http_status: http_status ?? null, error_type: error_type ?? null, prs_found: prs_found ?? 0 });
    },

    upsertPrEvent({ repo, pr_number, pr_title, pr_author, event_type, event_at, internal_trace_id, github_request_id }) {
      const result = db.prepare(`
        INSERT OR IGNORE INTO pr_events (repo, pr_number, pr_title, pr_author, event_type, event_at, internal_trace_id, github_request_id)
        VALUES (@repo, @pr_number, @pr_title, @pr_author, @event_type, @event_at, @internal_trace_id, @github_request_id)
      `).run({ repo, pr_number, pr_title, pr_author, event_type, event_at, internal_trace_id, github_request_id: github_request_id ?? null });
      return result.changes > 0;
    },

    getRecentEvents(limit = 100) {
      return db.prepare(`
        SELECT repo, pr_number, pr_title, pr_author, event_type, event_at, github_request_id
        FROM pr_events ORDER BY event_at DESC LIMIT ?
      `).all(limit);
    },

    getSummaryStats() {
      const counts    = db.prepare(`SELECT event_type, COUNT(*) as cnt FROM pr_events GROUP BY event_type`).all();
      const lastPoll  = db.prepare(`SELECT polled_at, repo, prs_found FROM poll_logs WHERE http_status = 200 ORDER BY polled_at DESC LIMIT 1`).get();
      const totalPolls = db.prepare(`SELECT COUNT(*) as cnt FROM poll_logs WHERE http_status = 200`).get();
      return { counts, lastPoll, totalPolls: totalPolls?.cnt ?? 0 };
    },

    close() { db.close(); },
  };
}
