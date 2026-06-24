export function loadConfig() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const repos = (process.env.REPOS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (repos.length === 0) throw new Error("REPOS is not set");

  return {
    token,
    repos,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? "60000", 10),
    logLevel:       process.env.LOG_LEVEL ?? "info",
    dbPath:         process.env.DB_PATH   ?? null,
    port:           parseInt(process.env.PORT ?? "4000", 10),
  };
}
