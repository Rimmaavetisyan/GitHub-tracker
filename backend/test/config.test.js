import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const KEYS = ["GITHUB_TOKEN", "REPOS", "POLL_INTERVAL_MS", "LOG_LEVEL", "DB_PATH", "PORT"];

describe("loadConfig", () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("throws when GITHUB_TOKEN is missing", () => {
    process.env.REPOS = "octocat/hello-world";
    assert.throws(() => loadConfig(), /GITHUB_TOKEN is not set/);
  });

  it("throws when REPOS is missing", () => {
    process.env.GITHUB_TOKEN = "token";
    assert.throws(() => loadConfig(), /REPOS is not set/);
  });

  it("throws when REPOS contains only separators", () => {
    process.env.GITHUB_TOKEN = "token";
    process.env.REPOS = " , , ";
    assert.throws(() => loadConfig(), /REPOS is not set/);
  });

  it("splits and trims the repo list", () => {
    process.env.GITHUB_TOKEN = "token";
    process.env.REPOS = " octocat/hello-world , nodejs/node,";

    assert.deepEqual(loadConfig().repos, ["octocat/hello-world", "nodejs/node"]);
  });

  it("applies defaults for the optional settings", () => {
    process.env.GITHUB_TOKEN = "token";
    process.env.REPOS = "octocat/hello-world";

    const config = loadConfig();

    assert.equal(config.pollIntervalMs, 60_000);
    assert.equal(config.logLevel, "info");
    assert.equal(config.dbPath, null);
    assert.equal(config.port, 4000);
  });

  it("reads the optional settings from the environment", () => {
    process.env.GITHUB_TOKEN = "token";
    process.env.REPOS = "octocat/hello-world";
    process.env.POLL_INTERVAL_MS = "5000";
    process.env.LOG_LEVEL = "debug";
    process.env.DB_PATH = "/data/tracker.db";
    process.env.PORT = "8080";

    const config = loadConfig();

    assert.equal(config.token, "token");
    assert.equal(config.pollIntervalMs, 5_000);
    assert.equal(config.logLevel, "debug");
    assert.equal(config.dbPath, "/data/tracker.db");
    assert.equal(config.port, 8080);
  });
});
