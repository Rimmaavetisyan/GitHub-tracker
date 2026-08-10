import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPoller } from "../src/poller.js";
import { AuthError, PermissionError, BackoffExhaustedError } from "../src/github.js";

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const pr = (overrides = {}) => ({
  number:     1,
  title:      "Add CI",
  user:       { login: "octocat" },
  created_at: "2026-08-01T10:00:00Z",
  merged_at:  null,
  ...overrides,
});

function fakeDb() {
  const pollLogs = [];
  const events   = [];
  return {
    pollLogs,
    events,
    insertPollLog(row) { pollLogs.push(row); },
    upsertPrEvent(row) {
      const seen = events.some((e) => e.repo === row.repo && e.pr_number === row.pr_number && e.event_type === row.event_type);
      if (seen) return false;
      events.push(row);
      return true;
    },
  };
}

function fakeNotifier() {
  const opened = [];
  const merged = [];
  return { opened, merged, prOpened: (e) => opened.push(e), prMerged: (e) => merged.push(e) };
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    fetchPullRequests: async (owner, repo) => {
      calls.push(`${owner}/${repo}`);
      const result = handler(`${owner}/${repo}`, calls.length);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const ok = (prs) => ({ data: prs, traceId: "trace-1", githubRequestId: "GH-1" });

describe("createPoller", () => {
  let exits, originalExit;

  beforeEach(() => {
    exits = [];
    originalExit = process.exit;
    process.exit = (code) => { exits.push(code); throw new Error("process.exit"); };
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it("polls every configured repo", async () => {
    const client = fakeClient(() => ok([]));
    const poller = createPoller({ githubClient: client, db: fakeDb(), notifier: fakeNotifier(), logger: silentLogger, repos: ["a/one", "b/two"] });

    await poller.pollAll();

    assert.deepEqual(client.calls.sort(), ["a/one", "b/two"]);
  });

  it("records a successful poll with the PR count and trace ids", async () => {
    const db = fakeDb();
    const poller = createPoller({ githubClient: fakeClient(() => ok([pr(), pr({ number: 2 })])), db, notifier: fakeNotifier(), logger: silentLogger, repos: ["octocat/hello-world"] });

    await poller.pollAll();

    assert.equal(db.pollLogs.length, 1);
    assert.deepEqual(db.pollLogs[0], {
      repo:              "octocat/hello-world",
      polled_at:         db.pollLogs[0].polled_at,
      internal_trace_id: "trace-1",
      github_request_id: "GH-1",
      http_status:       200,
      prs_found:         2,
    });
  });

  it("notifies once for a newly seen open PR", async () => {
    const db = fakeDb();
    const notifier = fakeNotifier();
    const poller = createPoller({ githubClient: fakeClient(() => ok([pr()])), db, notifier, logger: silentLogger, repos: ["octocat/hello-world"] });

    await poller.pollAll();
    await poller.pollAll();

    assert.equal(notifier.opened.length, 1);
    assert.equal(notifier.opened[0].pr_number, 1);
    assert.equal(notifier.opened[0].pr_title, "Add CI");
    assert.equal(notifier.opened[0].event_at, "2026-08-01T10:00:00Z");
  });

  it("records and notifies a merge using merged_at", async () => {
    const db = fakeDb();
    const notifier = fakeNotifier();
    const merged = pr({ merged_at: "2026-08-02T12:00:00Z" });
    const poller = createPoller({ githubClient: fakeClient(() => ok([merged])), db, notifier, logger: silentLogger, repos: ["octocat/hello-world"] });

    await poller.pollAll();

    assert.equal(notifier.merged.length, 1);
    assert.equal(notifier.merged[0].event_at, "2026-08-02T12:00:00Z");
    assert.deepEqual(db.events.map((e) => e.event_type), ["opened", "merged"]);
  });

  it("does not notify a merge for an open PR", async () => {
    const notifier = fakeNotifier();
    const poller = createPoller({ githubClient: fakeClient(() => ok([pr()])), db: fakeDb(), notifier, logger: silentLogger, repos: ["octocat/hello-world"] });

    await poller.pollAll();

    assert.equal(notifier.merged.length, 0);
  });

  it("falls back to an unknown author when the PR has no user", async () => {
    const notifier = fakeNotifier();
    const poller = createPoller({ githubClient: fakeClient(() => ok([pr({ user: null })])), db: fakeDb(), notifier, logger: silentLogger, repos: ["octocat/hello-world"] });

    await poller.pollAll();

    assert.equal(notifier.opened[0].pr_author, "unknown");
  });

  it("logs an unexpected HTTP status and records no events", async () => {
    const db = fakeDb();
    const poller = createPoller({
      githubClient: fakeClient(() => ({ data: null, traceId: "trace-1", githubRequestId: "GH-1", httpStatus: 404 })),
      db, notifier: fakeNotifier(), logger: silentLogger, repos: ["octocat/missing"],
    });

    await poller.pollAll();

    assert.equal(db.pollLogs[0].error_type, "HTTP_404");
    assert.equal(db.pollLogs[0].http_status, 404);
    assert.equal(db.events.length, 0);
  });

  it("disables a repo after a permission error and stops polling it", async () => {
    const db = fakeDb();
    const client = fakeClient((repo) => (repo === "octocat/private" ? new PermissionError(repo) : ok([])));
    const poller = createPoller({ githubClient: client, db, notifier: fakeNotifier(), logger: silentLogger, repos: ["octocat/private", "octocat/hello-world"] });

    await poller.pollAll();
    await poller.pollAll();

    assert.equal(db.pollLogs[0].error_type, "PERMISSION_ERROR");
    assert.equal(client.calls.filter((c) => c === "octocat/private").length, 1);
    assert.equal(client.calls.filter((c) => c === "octocat/hello-world").length, 2);
  });

  it("records the error name for a recoverable failure and keeps the repo enabled", async () => {
    const db = fakeDb();
    const client = fakeClient(() => new BackoffExhaustedError(503));
    const poller = createPoller({ githubClient: client, db, notifier: fakeNotifier(), logger: silentLogger, repos: ["octocat/hello-world"] });

    await poller.pollAll();
    await poller.pollAll();

    assert.equal(db.pollLogs[0].error_type, "BackoffExhaustedError");
    assert.equal(client.calls.length, 2);
  });

  it("keeps polling the other repos when one fails", async () => {
    const client = fakeClient((repo) => (repo === "a/one" ? new BackoffExhaustedError(503) : ok([])));
    const db = fakeDb();
    const poller = createPoller({ githubClient: client, db, notifier: fakeNotifier(), logger: silentLogger, repos: ["a/one", "b/two"] });

    await poller.pollAll();

    assert.equal(db.pollLogs.length, 2);
  });

  it("exits on an auth error", async () => {
    const poller = createPoller({ githubClient: fakeClient(() => new AuthError()), db: fakeDb(), notifier: fakeNotifier(), logger: silentLogger, repos: ["octocat/hello-world"] });

    await poller.pollAll();

    assert.deepEqual(exits, [1]);
  });

  it("exits when every repo has been disabled", async () => {
    const client = fakeClient((repo) => new PermissionError(repo));
    const poller = createPoller({ githubClient: client, db: fakeDb(), notifier: fakeNotifier(), logger: silentLogger, repos: ["octocat/private"] });

    await poller.pollAll();
    await poller.pollAll().catch(() => {});

    assert.deepEqual(exits, [1]);
  });
});
