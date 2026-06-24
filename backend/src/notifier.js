export function createNotifier({ logger }) {
  return {
    prOpened({ repo, pr_number, pr_title, pr_author, event_at, internal_trace_id, github_request_id }) {
      logger.info("PR_OPENED", { internal_trace_id, github_request_id, repo, pr_number, pr_title, pr_author, event_at });
      process.stdout.write(`\n[PR OPENED]  ${repo}#${pr_number} — "${pr_title}" by @${pr_author}  (${event_at})\n\n`);
    },

    prMerged({ repo, pr_number, pr_title, pr_author, event_at, internal_trace_id, github_request_id }) {
      logger.info("PR_MERGED", { internal_trace_id, github_request_id, repo, pr_number, pr_title, pr_author, event_at });
      process.stdout.write(`\n[PR MERGED]  ${repo}#${pr_number} — "${pr_title}" by @${pr_author}  (${event_at})\n\n`);
    },
  };
}
