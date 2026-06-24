import { v4 as uuidv4 } from "uuid";

const GITHUB_API = "https://api.github.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AuthError extends Error {
  constructor() { super("AUTH_ERROR"); this.name = "AuthError"; }
}

export class PermissionError extends Error {
  constructor(repo) { super("PERMISSION_ERROR"); this.name = "PermissionError"; this.repo = repo; }
}

export class BackoffExhaustedError extends Error {
  constructor(status) { super(`BACKOFF_EXHAUSTED after ${status}`); this.name = "BackoffExhaustedError"; }
}

export function createGitHubClient({ token, logger }) {
  const MAX_RETRIES    = 5;
  const MAX_BACKOFF_MS = 300_000;

  async function request(path) {
    const url = `${GITHUB_API}${path}`;
    let attempt  = 0;
    let backoffMs = 2_000;

    while (true) {
      const traceId = uuidv4();
      logger.debug("github_request_start", { internal_trace_id: traceId, url, attempt });

      let response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "github-tracker/1.0",
          },
        });
      } catch (networkErr) {
        logger.warn("network_error", { internal_trace_id: traceId, error: networkErr.message, attempt });
        if (attempt >= MAX_RETRIES) throw new BackoffExhaustedError("NETWORK");
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        attempt++;
        continue;
      }

      const githubRequestId = response.headers.get("x-github-request-id") ?? null;
      const status = response.status;
      logger.debug("github_response", { internal_trace_id: traceId, github_request_id: githubRequestId, status, url });

      if (status === 200) {
        return { data: await response.json(), traceId, githubRequestId };
      }

      if (status === 401) {
        logger.error("auth_error", { internal_trace_id: traceId, github_request_id: githubRequestId });
        throw new AuthError();
      }

      if (status === 403) {
        const retryAfter        = response.headers.get("retry-after");
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
        const rateLimitReset     = response.headers.get("x-ratelimit-reset");

        if (retryAfter) {
          const waitSec = parseInt(retryAfter, 10);
          logger.warn("rate_limit_retry_after", { internal_trace_id: traceId, github_request_id: githubRequestId, wait_sec: waitSec });
          await sleep(waitSec * 1_000);
          continue;
        }

        if (rateLimitRemaining === "0" && rateLimitReset) {
          const resetAt = parseInt(rateLimitReset, 10) * 1_000;
          const waitMs  = Math.max(resetAt - Date.now(), 0) + 1_000;
          logger.warn("rate_limit_exhausted", { internal_trace_id: traceId, github_request_id: githubRequestId, reset_at: new Date(resetAt).toISOString(), wait_ms: waitMs });
          await sleep(waitMs);
          continue;
        }

        logger.error("permission_error", { internal_trace_id: traceId, github_request_id: githubRequestId, url });
        throw new PermissionError(url);
      }

      if (status === 502 || status === 503) {
        if (attempt >= MAX_RETRIES) {
          logger.error("backoff_exhausted", { internal_trace_id: traceId, github_request_id: githubRequestId, status, attempts: attempt + 1 });
          throw new BackoffExhaustedError(status);
        }
        logger.warn("server_error_backoff", { internal_trace_id: traceId, github_request_id: githubRequestId, status, wait_ms: backoffMs, attempt });
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        attempt++;
        continue;
      }

      logger.warn("unexpected_status", { internal_trace_id: traceId, github_request_id: githubRequestId, status, url });
      return { data: null, traceId, githubRequestId, httpStatus: status };
    }
  }

  return {
    fetchPullRequests: (owner, repo, state = "all") =>
      request(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=100&sort=updated&direction=desc`),
  };
}
