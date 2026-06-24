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
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Main React component
│   │   ├── App.module.css
│   │   └── main.jsx
│   ├── Dockerfile
│   └── vite.config.js
└── docker-compose.yml
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

## Running with Docker

```bash
docker compose up --build
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

## Tech stack

- **Runtime:** Node.js 24
- **Database:** SQLite via `node:sqlite` (built-in)
- **API:** Express 5
- **Frontend:** React 19 + Vite
- **Styles:** CSS Modules
- **Containers:** Docker + Compose
