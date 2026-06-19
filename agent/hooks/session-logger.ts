import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineHook } from "eve/hooks";
import { formatLines, isNoiseEvent, toRecord } from "../lib/session-log";

// Session logger — observe-only.
//
// Subscribes to every runtime stream event (`"*"`) and persists it so a human
// (or jq) can inspect ongoing and past sessions on the production host and spot
// abnormalities (failures, token spikes, rejected tool calls). Hooks fire AFTER
// eve has durably recorded each event and CANNOT inject model context, so this
// never alters agent behavior.
//
// Three sinks, all driven from the same event:
//   sessions-YYYY-MM-DD.ndjson  full-fidelity events (sessionId-stamped), in the
//                               exact shape scripts/helpers.sh already parses.
//   sessions-YYYY-MM-DD.log     human-readable, greppable, one line per event.
//   stdout                      mirror of the readable line, so Coolify's built-in
//                               container-log viewer shows sessions live.
//
// Date-stamped filenames give natural daily rotation with no dependency.
//
// Config (env):
//   EVE_LOG_DIR     directory for log files. Default: /app/logs in production
//                   (a mounted volume in docker-compose), ./logs otherwise.
//   EVE_LOG_STDOUT  "0" to silence the stdout mirror (files still written).
//   EVE_LOG_JSON    "0" to skip the .ndjson sink (readable .log still written).

const LOG_DIR =
  process.env.EVE_LOG_DIR ?? (process.env.NODE_ENV === "production" ? "/app/logs" : "./logs");
const MIRROR_STDOUT = process.env.EVE_LOG_STDOUT !== "0";
const WRITE_JSON = process.env.EVE_LOG_JSON !== "0";

// Ensure the directory once; if it can't be created we degrade to stdout-only
// rather than throwing on every event (logging must never break a session).
let fileSinkOk = true;
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  fileSinkOk = false;
  console.error(`[session-logger] log dir ${LOG_DIR} unavailable, files disabled:`, err);
}

function dayStamp(at: string): string {
  // YYYY-MM-DD from an ISO timestamp; fall back to a fixed bucket if unparseable.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(at);
  return m ? m[1] : "unknown-date";
}

function appendSafely(file: string, contents: string): void {
  if (!fileSinkOk) return;
  try {
    appendFileSync(file, contents);
  } catch (err) {
    // Disable file writes after the first failure to avoid log spam, but keep
    // the stdout mirror alive.
    fileSinkOk = false;
    console.error(`[session-logger] write to ${file} failed, files disabled:`, err);
  }
}

export default defineHook({
  events: {
    // The typed event is the first arg; ctx (with session id) is last.
    "*": (event, ctx) => {
      try {
        if (isNoiseEvent(event.type)) return;

        const sessionId = ctx.session.id;
        const record = toRecord(event, sessionId);
        const at = (record.meta as { at: string }).at;
        const day = dayStamp(at);

        if (WRITE_JSON) {
          appendSafely(join(LOG_DIR, `sessions-${day}.ndjson`), `${JSON.stringify(record)}\n`);
        }

        const lines = formatLines(event, sessionId);
        if (lines.length > 0) {
          appendSafely(join(LOG_DIR, `sessions-${day}.log`), `${lines.join("\n")}\n`);
          if (MIRROR_STDOUT) for (const l of lines) console.log(l);
        }
      } catch (err) {
        // Last-resort guard: a logging bug must not surface to the agent.
        console.error("[session-logger] unexpected error:", err);
      }
    },
  },
});
