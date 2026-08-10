import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/database.js";

const event = (overrides = {}) => ({
  repo:              "octocat/hello-world",
  pr_number:         1,
  pr_title:          "Add CI",
  pr_author:         "octocat",
  event_type:        "opened",
  event_at:          "2026-08-01T10:00:00Z",
  internal_trace_id: "trace-1",
  github_request_id: "gh-1",
  ...overrides,
});

const pollLog = (overrides = {}) => ({
  repo:              "octocat/hello-world",
  polled_at:         "2026-08-01T10:00:00Z",
  internal_trace_id: "trace-1",
  github_request_id: "gh-1",
  http_status:       200,
  prs_found:         2,
  ...overrides,
});

describe("createDatabase", () => {
  let dir, db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-test-"));
    db  = createDatabase({ dbPath: path.join(dir, "test.db") });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates its schema on an empty file", () => {
    assert.deepEqual(db.getRecentEvents(), []);
    assert.deepEqual(db.getSummaryStats(), { counts: [], lastPoll: undefined, totalPolls: 0 });
  });

  it("reports a newly inserted PR event as new", () => {
    assert.equal(db.upsertPrEvent(event()), true);
  });

  it("ignores a repeat of the same repo/PR/event and reports it as not new", () => {
    db.upsertPrEvent(event());

    assert.equal(db.upsertPrEvent(event({ pr_title: "Renamed" })), false);
    assert.equal(db.getRecentEvents().length, 1);
  });

  it("treats opened and merged on the same PR as separate events", () => {
    assert.equal(db.upsertPrEvent(event({ event_type: "opened" })), true);
    assert.equal(db.upsertPrEvent(event({ event_type: "merged", event_at: "2026-08-02T10:00:00Z" })), true);
    assert.equal(db.getRecentEvents().length, 2);
  });

  it("drops an event type outside opened/merged", () => {
    // INSERT OR IGNORE swallows the CHECK violation, so the row is skipped rather than raising.
    assert.equal(db.upsertPrEvent(event({ event_type: "closed" })), false);
    assert.deepEqual(db.getRecentEvents(), []);
  });

  it("returns recent events newest first, capped at the limit", () => {
    db.upsertPrEvent(event({ pr_number: 1, event_at: "2026-08-01T10:00:00Z" }));
    db.upsertPrEvent(event({ pr_number: 2, event_at: "2026-08-03T10:00:00Z" }));
    db.upsertPrEvent(event({ pr_number: 3, event_at: "2026-08-02T10:00:00Z" }));

    assert.deepEqual(db.getRecentEvents().map((e) => e.pr_number), [2, 3, 1]);
    assert.deepEqual(db.getRecentEvents(2).map((e) => e.pr_number), [2, 3]);
  });

  it("defaults the optional poll log columns to null", () => {
    db.insertPollLog({ repo: "octocat/hello-world", polled_at: "2026-08-01T10:00:00Z", internal_trace_id: "N/A", error_type: "PERMISSION_ERROR" });

    const stats = db.getSummaryStats();
    assert.equal(stats.totalPolls, 0);
    assert.equal(stats.lastPoll, undefined);
  });

  it("counts only successful polls and reports the latest one", () => {
    db.insertPollLog(pollLog({ polled_at: "2026-08-01T10:00:00Z" }));
    db.insertPollLog(pollLog({ polled_at: "2026-08-03T10:00:00Z", prs_found: 5 }));
    db.insertPollLog(pollLog({ polled_at: "2026-08-04T10:00:00Z", http_status: 500 }));

    const stats = db.getSummaryStats();
    assert.equal(stats.totalPolls, 2);
    assert.equal(stats.lastPoll.polled_at, "2026-08-03T10:00:00Z");
    assert.equal(stats.lastPoll.prs_found, 5);
  });

  it("counts events per type", () => {
    db.upsertPrEvent(event({ pr_number: 1 }));
    db.upsertPrEvent(event({ pr_number: 2 }));
    db.upsertPrEvent(event({ pr_number: 1, event_type: "merged" }));

    const counts = Object.fromEntries(db.getSummaryStats().counts.map((c) => [c.event_type, c.cnt]));
    assert.deepEqual(counts, { opened: 2, merged: 1 });
  });

  it("keeps data across reopens of the same file", () => {
    const dbPath = path.join(dir, "persist.db");
    const first = createDatabase({ dbPath });
    first.upsertPrEvent(event());
    first.close();

    const second = createDatabase({ dbPath });
    assert.equal(second.getRecentEvents().length, 1);
    second.close();
  });
});
