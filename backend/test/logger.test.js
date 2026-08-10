import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  let stdout, stderr, originalOut, originalErr;

  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalOut = process.stdout.write;
    originalErr = process.stderr.write;
    process.stdout.write = (chunk) => { stdout.push(chunk); return true; };
    process.stderr.write = (chunk) => { stderr.push(chunk); return true; };
  });

  afterEach(() => {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  });

  it("writes one JSON line per entry with level, message and fields", () => {
    createLogger({ level: "info" }).info("poll_success", { repo: "octocat/hello-world", pr_count: 3 });

    assert.equal(stdout.length, 1);
    assert.ok(stdout[0].endsWith("\n"));

    const entry = JSON.parse(stdout[0]);
    assert.equal(entry.level, "info");
    assert.equal(entry.message, "poll_success");
    assert.equal(entry.repo, "octocat/hello-world");
    assert.equal(entry.pr_count, 3);
    assert.ok(!Number.isNaN(Date.parse(entry.ts)));
  });

  it("suppresses entries below the configured level", () => {
    const logger = createLogger({ level: "warn" });

    logger.debug("skipped");
    logger.info("skipped");
    logger.warn("kept");

    assert.equal(stdout.length, 1);
    assert.equal(JSON.parse(stdout[0]).message, "kept");
  });

  it("sends errors to stderr and everything else to stdout", () => {
    const logger = createLogger({ level: "debug" });

    logger.info("to_stdout");
    logger.error("to_stderr");

    assert.equal(stdout.length, 1);
    assert.equal(stderr.length, 1);
    assert.equal(JSON.parse(stderr[0]).message, "to_stderr");
  });

  it("defaults to info when the level is missing or unknown", () => {
    createLogger().debug("skipped");
    createLogger({ level: "nonsense" }).debug("skipped");
    createLogger({ level: "nonsense" }).info("kept");

    assert.equal(stdout.length, 1);
    assert.equal(JSON.parse(stdout[0]).message, "kept");
  });

  it("accepts the level case-insensitively", () => {
    createLogger({ level: "DEBUG" }).debug("kept");

    assert.equal(stdout.length, 1);
  });
});
