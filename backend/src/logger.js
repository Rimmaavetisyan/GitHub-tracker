const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, minLevel, message, fields = {}) {
  if (LEVELS[level] < minLevel) return;
  const entry = { ts: new Date().toISOString(), level, message, ...fields };
  const out = level === "error" ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + "\n");
}

export function createLogger({ level = "info" } = {}) {
  const minLevel = LEVELS[level?.toLowerCase()] ?? LEVELS.info;
  return {
    debug: (msg, fields) => log("debug", minLevel, msg, fields),
    info:  (msg, fields) => log("info",  minLevel, msg, fields),
    warn:  (msg, fields) => log("warn",  minLevel, msg, fields),
    error: (msg, fields) => log("error", minLevel, msg, fields),
  };
}
