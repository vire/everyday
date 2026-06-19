#!/usr/bin/env bash
# Helpers for interacting with the running eve PR-digest agent container.
#
#   source scripts/helpers.sh
#
# Requires: docker, curl, jq.
# Override the container/port if your Compose project names them differently:
#   EVE_AGENT=<agent-container>  EVE_PORT=3000
#
# Quick start:
#   eve_digest                       # trigger the daily digest, show a readable trace
#   eve_ask "Summarize CI only."     # send any message, show a readable trace
#   eve_trace --run "..." > t.ndjson # capture raw trace NDJSON to a file
#   eve_trace <sessionId> | eve_pretty
#   eve_sessions                     # recent session ids from the agent's logs
#   eve_tokens t.ndjson              # token usage for a captured trace
#   eve_logs [N]                     # tail the readable session log (default 200 lines)
#   eve_logf                         # follow the readable session log live
#   eve_errors [N]                   # only failures/rejections across all session logs
#   eve_logjson | eve_pretty         # today's structured events, pretty-printed

EVE_AGENT="${EVE_AGENT:-eve-agent-agent-1}"
EVE_PORT="${EVE_PORT:-3000}"
# Where the session logger writes inside the agent container (matches EVE_LOG_DIR).
EVE_LOG_DIR="${EVE_LOG_DIR:-/app/logs}"

# Send a message to the agent; prints the sessionId.
#   sid=$(eve_send "Run the daily digest now.")
eve_send() {
  docker exec "$EVE_AGENT" curl -s -m 20 -X POST "http://localhost:$EVE_PORT/eve/v1/session" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg m "$1" '{message:$m}')" \
    | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4
}

# Stream a session's raw event NDJSON. Streaming replays from the start, so this
# works on finished runs too.
#   eve_trace <sessionId>        -> raw NDJSON
#   eve_trace --run "message"    -> fire a request, then stream it
eve_trace() {
  local sid
  if [ "$1" = "--run" ]; then sid="$(eve_send "$2")"; else sid="$1"; fi
  [ -n "$sid" ] || { echo "eve_trace: no session id" >&2; return 1; }
  echo "session: $sid" >&2
  docker exec "$EVE_AGENT" curl -s -N -m 180 "http://localhost:$EVE_PORT/eve/v1/session/$sid/stream"
}

# Pretty-print a trace NDJSON stream (reads a file arg or stdin).
#   eve_trace <sid> | eve_pretty      OR     eve_pretty trace.ndjson
eve_pretty() {
  { if [ -n "$1" ]; then cat "$1"; else cat; fi; } | grep '^{' | jq -rc '
    ((.meta.at // "")[11:19]) as $t |
    if   .type=="message.received"  then "\($t) 👤 \(.data.message)"
    elif .type=="actions.requested" then (.data.actions[] | "\($t) 🔧 \(.toolName)(\(.input|tojson))")
    elif .type=="action.result"     then "\($t) ✅ \(.data.result.toolName) ok=\(.data.result.output.ok // "n/a")"
    elif .type=="step.completed"    then "\($t)    step \(.data.stepIndex) (\(.data.finishReason)) tok in=\(.data.usage.inputTokens) out=\(.data.usage.outputTokens)"
    elif .type=="message.completed" then "\($t) 🤖 \(.data.message)"
    elif (.type=="turn.completed" or .type=="session.waiting" or .type=="session.failed") then "\($t) ── \(.type)"
    else empty end'
}

# Fire a message and show the readable trace live.
#   eve_ask "Summarize CI only."
eve_ask() { eve_trace --run "$1" | eve_pretty; }

# Trigger the daily digest and show the trace.
eve_digest() { eve_ask "Run the daily PR & CI digest now per your instructions."; }

# Recent distinct session ids from the agent's persisted logs (default 5).
# Reads the sessionId-stamped .ndjson sink (the Coolify Scheduled Task triggers
# runs in-container, so there's no separate cron container to read logs from).
#   eve_sessions [N]
eve_sessions() {
  docker exec "$EVE_AGENT" sh -c \
    "cat \"$EVE_LOG_DIR\"/sessions-*.ndjson 2>/dev/null" \
    | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4 | awk '!seen[$0]++' | tail -"${1:-5}"
}

# Token usage summary for a trace (file arg or stdin).
#   eve_tokens trace.ndjson
eve_tokens() {
  { if [ -n "$1" ]; then cat "$1"; else cat; fi; } | grep '^{' | jq -s '
    map(select(.type=="step.completed").data.usage) |
    {input_tokens:(map(.inputTokens)|add), output_tokens:(map(.outputTokens)|add), cache_read:(map(.cacheReadTokens)|add)}'
}

# ── Session log inspection (the persisted files written by the logger hook) ──
# These read the date-stamped files the agent writes to $EVE_LOG_DIR (default
# /app/logs, persisted on the eve-logs volume). They survive container restarts,
# unlike the live HTTP stream — use these to look back at past sessions.

# Tail the readable, one-line-per-event session log for today (default 200 lines).
#   eve_logs [N]
eve_logs() {
  docker exec "$EVE_AGENT" sh -c \
    "tail -n ${1:-200} \"$EVE_LOG_DIR\"/sessions-\$(date -u +%F).log 2>/dev/null" \
    || echo "eve_logs: no log for today yet (try eve_errors to scan all days)" >&2
}

# Follow the readable session log live (Ctrl-C to stop).
eve_logf() {
  docker exec "$EVE_AGENT" sh -c \
    "tail -n 50 -F \"$EVE_LOG_DIR\"/sessions-\$(date -u +%F).log 2>/dev/null"
}

# Surface only abnormalities — failed/rejected events — across ALL session logs.
#   eve_errors [N]   (default last 100 matches)
eve_errors() {
  docker exec "$EVE_AGENT" sh -c \
    "grep -hE '🛑|❌|🚫|session.failed|turn .* failed|step .* failed' \"$EVE_LOG_DIR\"/sessions-*.log 2>/dev/null | tail -n ${1:-100}" \
    || echo "eve_errors: no session logs found in $EVE_LOG_DIR" >&2
}

# Today's structured events on stdout — pipe to eve_pretty / eve_tokens.
#   eve_logjson | eve_pretty
#   eve_logjson | eve_tokens
eve_logjson() {
  docker exec "$EVE_AGENT" sh -c \
    "cat \"$EVE_LOG_DIR\"/sessions-\$(date -u +%F).ndjson 2>/dev/null"
}
