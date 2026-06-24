import { AuthError, PermissionError } from "./github.js";

export function createPoller({ githubClient, db, notifier, logger, repos }) {
  const disabledRepos = new Set();

  async function pollRepo(fullName) {
    const [owner, repo] = fullName.split("/");
    const polledAt = new Date().toISOString();

    let result;
    try {
      result = await githubClient.fetchPullRequests(owner, repo);
    } catch (err) {
      if (err instanceof AuthError) {
        logger.error("fatal_auth_error", { message: err.message });
        process.exit(1);
      }

      if (err instanceof PermissionError) {
        disabledRepos.add(fullName);
        db.insertPollLog({ repo: fullName, polled_at: polledAt, internal_trace_id: "N/A", error_type: "PERMISSION_ERROR" });
        return;
      }

      logger.error("poll_error", { repo: fullName, error: err.message });
      db.insertPollLog({ repo: fullName, polled_at: polledAt, internal_trace_id: "N/A", error_type: err.name ?? "UNKNOWN_ERROR" });
      return;
    }

    const { data: prs, traceId, githubRequestId, httpStatus } = result;

    if (!prs) {
      db.insertPollLog({ repo: fullName, polled_at: polledAt, internal_trace_id: traceId, github_request_id: githubRequestId, http_status: httpStatus, error_type: `HTTP_${httpStatus}` });
      return;
    }

    logger.info("poll_success", { internal_trace_id: traceId, github_request_id: githubRequestId, repo: fullName, pr_count: prs.length });
    db.insertPollLog({ repo: fullName, polled_at: polledAt, internal_trace_id: traceId, github_request_id: githubRequestId, http_status: 200, prs_found: prs.length });

    for (const pr of prs) {
      const base = {
        repo:              fullName,
        pr_number:         pr.number,
        pr_title:          pr.title,
        pr_author:         pr.user?.login ?? "unknown",
        internal_trace_id: traceId,
        github_request_id: githubRequestId,
      };

      const isNew = db.upsertPrEvent({ ...base, event_type: "opened", event_at: pr.created_at });
      if (isNew) notifier.prOpened({ ...base, event_at: pr.created_at });

      if (pr.merged_at) {
        const wasMerged = db.upsertPrEvent({ ...base, event_type: "merged", event_at: pr.merged_at });
        if (wasMerged) notifier.prMerged({ ...base, event_at: pr.merged_at });
      }
    }
  }

  async function pollAll() {
    const active = repos.filter((r) => !disabledRepos.has(r));
    if (active.length === 0) {
      logger.error("no_active_repos", { message: "All repos disabled. Exiting." });
      process.exit(1);
    }
    await Promise.allSettled(active.map(pollRepo));
  }

  return {
    start(intervalMs) {
      pollAll();
      setInterval(pollAll, intervalMs);
    },
    pollAll,
  };
}
