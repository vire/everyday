#!/bin/sh
# Trigger ONE PR & CI digest run.
#
# Designed to be invoked by a Coolify "Scheduled Task" attached to the `agent`
# resource (replaces the old digest-cron sidecar container):
#
#   Name:           daily-digest
#   Command:        sh /app/scripts/trigger-digest.sh
#   Frequency:      0 7 * * *           (cron; evaluated in the Coolify server tz)
#   Timeout (s):    900                 (>= curl -m below, so it isn't killed early)
#   Container name: agent
#
# Coolify execs this inside the agent container, so it reaches the eve HTTP
# channel on localhost. POSTing to /eve/v1/session anchors a real session, which
# lets the tool-using agent run to completion (a channel-less native schedule
# cannot). Honors HTTP Basic when AGENT_BASIC_USER / AGENT_BASIC_PASS are set —
# these must match agent/channels/eve.ts; they're already in the container env.
set -eu

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/eve/v1/session"
MESSAGE="Run the daily PR & CI digest now per your instructions."

AUTH=""
if [ -n "${AGENT_BASIC_USER:-}" ] && [ -n "${AGENT_BASIC_PASS:-}" ]; then
  AUTH="-u ${AGENT_BASIC_USER}:${AGENT_BASIC_PASS}"
fi

echo "[trigger-digest] $(date -u) POST ${URL}"
# -f makes curl exit non-zero on an HTTP error so Coolify marks the task failed.
# shellcheck disable=SC2086  # $AUTH must word-split into separate curl args.
curl -fsS -m 900 $AUTH -X POST "${URL}" \
  -H 'content-type: application/json' \
  -d "{\"message\":\"${MESSAGE}\"}"
echo ""
echo "[trigger-digest] $(date -u) done"
