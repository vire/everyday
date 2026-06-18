#!/usr/bin/env bash
# Helpers for interacting with the running eve PR-digest agent container.
#
#   source scripts/helpers.sh
#
# Requires: docker, curl, jq.
# Override the container/port if your Compose project names them differently:
#   EVE_AGENT=<agent-container>  EVE_CRON=<cron-container>  EVE_PORT=3000
#
# Quick start:
#   eve_digest                       # trigger the daily digest, show a readable trace
#   eve_ask "Summarize CI only."     # send any message, show a readable trace
#   eve_trace --run "..." > t.ndjson # capture raw trace NDJSON to a file
#   eve_trace <sessionId> | eve_pretty
#   eve_sessions                     # recent session ids the cron started
#   eve_tokens t.ndjson              # token usage for a captured trace

EVE_AGENT="${EVE_AGENT:-eve-agent-agent-1}"
EVE_CRON="${EVE_CRON:-eve-agent-digest-cron-1}"
EVE_PORT="${EVE_PORT:-3000}"

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

# Recent session ids the cron started (default 5).
#   eve_sessions [N]
eve_sessions() {
  docker logs "$EVE_CRON" 2>/dev/null | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4 | tail -"${1:-5}"
}

# Token usage summary for a trace (file arg or stdin).
#   eve_tokens trace.ndjson
eve_tokens() {
  { if [ -n "$1" ]; then cat "$1"; else cat; fi; } | grep '^{' | jq -s '
    map(select(.type=="step.completed").data.usage) |
    {input_tokens:(map(.inputTokens)|add), output_tokens:(map(.outputTokens)|add), cache_read:(map(.cacheReadTokens)|add)}'
}
