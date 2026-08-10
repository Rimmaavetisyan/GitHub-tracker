# GitHub PR Tracker

A service that monitors a GitHub repository and stores PR activity in a private SQLite analytics database. Detects when pull requests are **opened** or **merged** and displays them in a React dashboard.

## Architecture

```
GitHub API → Poller (every 60s) → SQLite DB → Express API → React UI
```

Three independent services:

| Service | What it does |
|---------|-------------|
| **Poller** | Polls GitHub REST API, writes events to SQLite |
| **API server** | Reads from SQLite, serves JSON to frontend |
| **Frontend** | React dashboard showing PR events with clickable GitHub links |

## Engineering highlights

- Raw `fetch` with manual `Authorization: Bearer` header — no Octokit/axios
- Exponential backoff for `502`/`503` (2s → 4s → 8s → … → 5min)
- `403` rate-limit detection via `Retry-After` and `x-ratelimit-*` headers, distinguished from `401` auth errors
- Dual trace IDs on every log line and DB row: internal UUID + GitHub's `X-GitHub-Request-Id`
- Idempotent inserts (`INSERT OR IGNORE`) — safe to restart anytime
- SQLite WAL mode — concurrent reads and writes without blocking

## Project structure

```
github-tracker/
├── backend/
│   ├── src/
│   │   ├── index.js      # Entry point — composition root
│   │   ├── config.js     # Loads and validates env vars
│   │   ├── logger.js     # Structured JSON logger
│   │   ├── github.js     # GitHub HTTP client with backoff
│   │   ├── database.js   # SQLite factory (createDatabase)
│   │   ├── poller.js     # Polling logic (createPoller)
│   │   ├── notifier.js   # Console notifications
│   │   └── server.js     # Express API server
│   ├── test/             # node:test suites for each module
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Main React component
│   │   ├── App.module.css
│   │   └── main.jsx
│   ├── Dockerfile
│   └── vite.config.js
├── .github/workflows/
│   ├── ci.yml            # Tests + build on every push/PR
│   └── release.yml       # Publishes images to GHCR on a v* tag
├── docker-compose.yml       # Runs the published GHCR images
└── docker-compose.build.yml # Overlay to build from source instead
```

## Running locally

**1. Configure environment**

```bash
cp backend/.env.example backend/.env
# Fill in GITHUB_TOKEN and REPOS
```

**2. Start all three services in separate terminals**

```bash
# Terminal 1 — poller
cd backend && npm install && npm start

# Terminal 2 — API server
cd backend && npm run serve

# Terminal 3 — React frontend
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173**

## Tests

The backend is covered by the built-in Node test runner — no test framework dependency.

```bash
cd backend && npm test
```

## Running with Docker

`docker-compose.yml` pulls the published images from GHCR, pinned to a version tag:

```bash
docker compose up                       # uses the pinned default (v1.0.0)
TRACKER_VERSION=v1.1.0 docker compose up # or pick another published tag
```

To build from source instead of pulling (local development):

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

Open **http://localhost:80**

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | required | GitHub personal access token |
| `REPOS` | required | Comma-separated list e.g. `microsoft/vscode` |
| `POLL_INTERVAL_MS` | `60000` | How often to poll GitHub (ms) |
| `PORT` | `4000` | API server port |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `DB_PATH` | `backend/tracker.db` | SQLite file path |

## CI/CD

**CI** (`.github/workflows/ci.yml`) runs on every push and pull request: backend tests, frontend build, and a
no-push Docker build of both images. npm downloads are cached by `actions/setup-node`, Docker layers by the
GitHub Actions cache backend.

**Release** (`.github/workflows/release.yml`) runs only on a version tag — not on merges to master:

```bash
git tag v1.0.0
git push origin v1.0.0
```

It builds both images and pushes them to GHCR, tagged to match the git tag:

| Git tag | Image tags |
|---------|-----------|
| `v1.0.0` | `v1.0.0`, `1.0`, `1` |

Images: `ghcr.io/rimmaavetisyan/github-tracker-backend` and `…-frontend`.

### Package visibility and auth

The workflow authenticates with the automatic `GITHUB_TOKEN` (`packages: write` permission) — no PAT needed
for publishing. Packages are **private by default**; make them public under
*Package settings → Change visibility* if you want `docker compose up` to work without a login. To pull a
private package:

```bash
echo $CR_PAT | docker login ghcr.io -u rimmaavetisyan --password-stdin   # PAT needs read:packages
```

### Branch protection

Set on GitHub under *Settings → Branches → Add branch ruleset* for `master`:
require a pull request, and under *Require status checks to pass* select **Backend tests**, **Frontend build**
and the **Docker build** checks. The checks only appear in that list after the workflow has run at least once,
so push this branch first.

## Tech stack

- **Runtime:** Node.js 24
- **Database:** SQLite via `node:sqlite` (built-in)
- **API:** Express 5
- **Frontend:** React 19 + Vite
- **Styles:** CSS Modules
- **Containers:** Docker + Compose
