# GitHub PR Tracker

Polls one or more GitHub repositories every 60 seconds (configurable), detects when pull requests are opened or merged, persists every event to a local SQLite database, and logs structured JSON notifications to the console.

## Requirements

- Node.js 18 or later (uses native `fetch`)
- A GitHub personal access token with `repo` (or `public_repo`) scope

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env .env.local        # or edit .env directly
```

Edit `.env`:

```
GITHUB_TOKEN=ghp_your_token_here
REPOS=facebook/react,microsoft/vscode
POLL_INTERVAL_MS=60000
```

| Variable          | Required | Description                                         |
|-------------------|----------|-----------------------------------------------------|
| `GITHUB_TOKEN`    | yes      | GitHub PAT — `repo` scope for private, `public_repo` for public |
| `REPOS`           | yes      | Comma-separated list of `owner/repo` pairs          |
| `POLL_INTERVAL_MS`| no       | Milliseconds between polls (default `60000`)        |
| `LOG_LEVEL`       | no       | `debug` / `info` / `warn` / `error` (default `info`) |

```bash
# 3. Start the tracker
npm start

# Or in watch/dev mode (auto-restarts on file changes)
npm run dev
```

## Project structure

```
github-tracker/
├── src/
│   ├── index.js      ← entry point — polling loop, event dispatch
│   ├── github.js     ← HTTP client, full retry/back-off logic
│   ├── database.js   ← SQLite init + insert helpers
│   ├── logger.js     ← structured JSON logger
│   └── notifier.js   ← console PR notifications
├── tracker.db        ← created automatically on first run
├── .env              ← secrets & config (git-ignored)
├── .gitignore
└── package.json
```

## Database schema

**`poll_logs`** — one row per API call:

| Column              | Type    | Notes                        |
|---------------------|---------|------------------------------|
| `id`                | INTEGER | primary key                  |
| `repo`              | TEXT    | `owner/repo`                 |
| `polled_at`         | TEXT    | ISO-8601 timestamp           |
| `internal_trace_id` | TEXT    | UUID v4 generated per request |
| `github_request_id` | TEXT    | `X-GitHub-Request-Id` header |
| `http_status`       | INTEGER | HTTP response code           |
| `error_type`        | TEXT    | e.g. `AUTH_ERROR`, `HTTP_404`|
| `prs_found`         | INTEGER | number of PRs returned       |

**`pr_events`** — one row per unique (repo, PR number, event type):

| Column              | Type    | Notes                              |
|---------------------|---------|------------------------------------|
| `id`                | INTEGER | primary key                        |
| `repo`              | TEXT    | `owner/repo`                       |
| `pr_number`         | INTEGER |                                    |
| `pr_title`          | TEXT    |                                    |
| `pr_author`         | TEXT    | GitHub login                       |
| `event_type`        | TEXT    | `opened` or `merged`               |
| `event_at`          | TEXT    | ISO-8601 timestamp from GitHub     |
| `internal_trace_id` | TEXT    | UUID v4 of the poll that found it  |
| `github_request_id` | TEXT    | `X-GitHub-Request-Id` header       |
| `recorded_at`       | TEXT    | when the row was written locally   |

## Error handling

| Condition                                        | Behaviour                                             |
|--------------------------------------------------|-------------------------------------------------------|
| HTTP 401                                         | Log `AUTH_ERROR`, exit process immediately            |
| HTTP 403 + `Retry-After` header                  | Wait the specified seconds, then retry                |
| HTTP 403 + `X-RateLimit-Remaining: 0`            | Wait until `X-RateLimit-Reset` timestamp              |
| HTTP 403 (no rate-limit headers)                 | Log `PERMISSION_ERROR`, disable that repo permanently |
| HTTP 502 / 503                                   | Exponential back-off: 2 s → 4 s → 8 s … max 300 s, up to 5 retries |
| Network error (DNS, TCP reset)                   | Same exponential back-off as 502/503                  |

## Log format

Every log line is a JSON object written to stdout (or stderr for errors):

```json
{
  "ts": "2024-01-15T10:23:45.123Z",
  "level": "info",
  "message": "PR_OPENED",
  "internal_trace_id": "4b9e1c2d-...",
  "github_request_id": "A1B2:C3D4:...",
  "repo": "facebook/react",
  "pr_number": 31337,
  "pr_title": "Fix concurrent rendering edge case",
  "pr_author": "gaearon",
  "event_at": "2024-01-15T10:20:00Z"
}
```

Pipe through [`jq`](https://jqlang.github.io/jq/) for readable output:

```bash
npm start | jq .
```

## Querying the database

```bash
# Open the database
sqlite3 tracker.db

# Recent PR events
SELECT repo, pr_number, pr_title, event_type, event_at
FROM pr_events
ORDER BY event_at DESC
LIMIT 20;

# Poll success rate per repo
SELECT repo,
       COUNT(*) AS total_polls,
       SUM(CASE WHEN http_status = 200 THEN 1 ELSE 0 END) AS successful,
       SUM(prs_found) AS total_prs_seen
FROM poll_logs
GROUP BY repo;
```
