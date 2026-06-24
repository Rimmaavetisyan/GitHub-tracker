import { useState, useEffect, useCallback } from "react";
import styles from "./App.module.css";

function formatDate(iso) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

function StatCard({ number, label, color }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statNumber} style={{ color }}>{number ?? "—"}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function Badge({ type }) {
  return (
    <span className={type === "opened" ? styles.badgeOpen : styles.badgeMerged}>
      {type.toUpperCase()}
    </span>
  );
}

function EventRow({ event }) {
  const { repo, pr_number, pr_title, pr_author, event_type, event_at } = event;
  const url = `https://github.com/${repo}/pull/${pr_number}`;

  return (
    <tr className={styles.row}>
      <td><Badge type={event_type} /></td>
      <td>
        <a href={url} target="_blank" rel="noopener" className={styles.prLink}>
          {repo}#{pr_number}
          <svg className={styles.extIcon} viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10L10 2M5 2h5v5" />
          </svg>
        </a>
      </td>
      <td className={styles.prTitle} title={pr_title}>{pr_title}</td>
      <td className={styles.author}>@{pr_author}</td>
      <td className={styles.date}>{formatDate(event_at)}</td>
    </tr>
  );
}

export default function App() {
  const [events,  setEvents]  = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    try {
      const [evRes, stRes] = await Promise.all([
        fetch("/api/events"),
        fetch("/api/stats"),
      ]);
      if (!evRes.ok || !stRes.ok) throw new Error("API error");
      const [evData, stData] = await Promise.all([evRes.json(), stRes.json()]);
      setEvents(evData);
      setStats(stData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const opened   = stats?.counts.find(c => c.event_type === "opened")?.cnt ?? null;
  const merged   = stats?.counts.find(c => c.event_type === "merged")?.cnt  ?? null;
  const lastPoll = stats?.lastPoll;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.logo}>
          <svg width="26" height="26" viewBox="0 0 98 96" fill="#f0f6fc">
            <path fillRule="evenodd" clipRule="evenodd"
              d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69
                 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127
                 -13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17
                 -4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052
                 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6
                 -10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2
                 -.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052
                 a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63
                 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038
                 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283
                 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526
                 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691
                 C97.707 22 75.788 0 48.854 0z" />
          </svg>
          GitHub PR Tracker
        </div>
        <div className={styles.headerRight}>
          <span className={styles.refreshNote}>Auto-refreshes every 30s</span>
          <button className={styles.refreshBtn} onClick={load}>Refresh now</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.stats}>
          <StatCard number={opened}            label="PRs Opened"       color="#3fb950" />
          <StatCard number={merged}            label="PRs Merged"       color="#a371f7" />
          <StatCard number={stats?.totalPolls} label="Successful Polls" color="#58a6ff" />
        </div>

        <div className={styles.tableCard}>
          <div className={styles.tableHeader}>
            <h2>PR Events</h2>
            {lastPoll && (
              <span className={styles.lastPoll}>
                Last poll: {formatDate(lastPoll.polled_at)} — {lastPoll.prs_found} PRs found
              </span>
            )}
          </div>

          {loading && <div className={styles.empty}>Loading…</div>}
          {error   && <div className={styles.empty} style={{ color: "#f85149" }}>Error: {error}</div>}
          {!loading && !error && events.length === 0 && (
            <div className={styles.empty}>No events yet — run the poller first.</div>
          )}
          {!loading && !error && events.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>PR</th>
                  <th>Title</th>
                  <th>Author</th>
                  <th>Date &amp; Time</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => <EventRow key={i} event={e} />)}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
