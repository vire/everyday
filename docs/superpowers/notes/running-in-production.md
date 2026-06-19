# Running in Production (Self-Hosted)

## How scheduling works

The daily digest fires from a **Coolify "Scheduled Task"** attached to the agent resource — not from code in this repo and not from a sidecar container. Coolify execs a command inside the running `agent` container on a cron cadence; that command runs `scripts/trigger-digest.sh`, which POSTs to the agent's own `/eve/v1/session` endpoint (anchoring a session so the tool-using run completes). The only long-running process is the `eve start` server container itself.

Configure the Scheduled Task (Resource → Scheduled Tasks → New) as:

| Field | Value |
|---|---|
| Name | `daily-digest` |
| Command | `sh /app/scripts/trigger-digest.sh` |
| Frequency | `0 7 * * *` (cron — see timezone note below) |
| Timeout (seconds) | `900` (≥ the script's `curl -m`, so it isn't killed mid-run) |
| Container name | `agent` |

`trigger-digest.sh` forwards HTTP Basic auth when `AGENT_BASIC_USER` / `AGENT_BASIC_PASS` are set (they're already in the container env), matching `agent/channels/eve.ts`.

## Running the agent server

### Option A — systemd

Create `/etc/systemd/system/eve-agent.service`:

```ini
[Unit]
Description=Eve PR Digest Agent
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/srv/eve-agent
EnvironmentFile=/srv/eve-agent/.env
ExecStart=/usr/local/bin/pnpm eve start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable eve-agent
sudo systemctl start eve-agent
```

### Option B — pm2

```bash
cd /srv/eve-agent
pm2 start "pnpm eve start" --name eve-agent
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

## Required environment variables

Set these in your `.env` file (or system environment):

| Variable | Description |
|---|---|
| `TARGET_REPO` | `owner/name` of the GitHub repository to digest |
| `GITHUB_LOGIN` | Optional — GitHub login for contribution attribution |
| `GH_TOKEN` | PAT with `repo` + `gist` scopes |
| `OPENAI_API_KEY` | Your own OpenAI key (`sk-...`). Used only **together with** `OPENAI_MODEL` — then the agent talks to OpenAI directly. |
| `OPENAI_MODEL` | OpenAI model slug (e.g. `gpt-5-nano`; avoid `*-codex` slugs). **Required** to select OpenAI; leave empty to stay on OpenRouter. |
| `OPENROUTER_API_KEY` | OpenRouter API key (`sk-or-...`) — used unless **both** OpenAI vars above are set |
| `OPENROUTER_MODEL` | OpenRouter model slug (default: `openai/gpt-5-nano`; avoid `*-codex` slugs) |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) with `chat:write` scope |
| `SLACK_CHANNEL_ID` | Target Slack channel ID (`C0XXXXXXX`) |

## Timezone note

Coolify evaluates the Scheduled Task's Frequency cron in the **Coolify server's timezone** (set under Settings → Instance timezone), which is often UTC. Pick the cron hour to match your desired local time. Assuming a UTC host:

| Desired local time | cron hour |
|---|---|
| 07:00 UTC | `0 7 * * *` |
| 07:00 CET (UTC+1) | `0 6 * * *` |
| 07:00 EST (UTC-5) | `0 12 * * *` |
| 07:00 PST (UTC-8) | `0 15 * * *` |

Adjust the **Frequency** field of the `daily-digest` Scheduled Task in the Coolify UI — there is no cron expression committed to the repo.

## Inspecting sessions (logs)

A logger hook (`agent/hooks/session-logger.ts`) subscribes to every runtime
stream event and persists it so you can watch live sessions and audit past ones
on the server — primarily to spot abnormalities (failures, rejected tool calls,
token spikes). Hooks are observe-only and fire *after* eve durably records each
event, so this cannot affect agent behavior.

### Where logs go

Written to `EVE_LOG_DIR` (default `/app/logs`, persisted on the `eve-logs`
volume in `docker-compose.yml`), date-stamped for natural daily rotation:

| File | Contents |
|---|---|
| `sessions-YYYY-MM-DD.log` | Human-readable, one line per event (grep-friendly) |
| `sessions-YYYY-MM-DD.ndjson` | Full events, `sessionId`-stamped; same shape `helpers.sh` parses |

Readable lines also mirror to the agent container's **stdout**, so they show up
in **Coolify's built-in log viewer** with no extra setup. A readable line looks
like:

```
07:08:09 [sess_012] 👤 Run the daily PR & CI digest now per your instructions.
07:08:11 [sess_012] 🔧 pull-requests({"state":"open"})
07:08:13 [sess_012] ✅ pull-requests completed ok=true
07:08:15 [sess_012] · step 0 (tool-calls) tok in=1200 out=80 cacheR=1000
07:08:20 [sess_012] 🤖 Posted the digest to #eng.
07:08:20 [sess_012] ✔ session.completed
```

### Inspecting on the Coolify instance

Easiest is Coolify's log viewer (the stdout mirror). For the files, either
`source scripts/helpers.sh` from a machine with Docker access to the host, or
exec into the container directly:

```bash
source scripts/helpers.sh
eve_logs            # tail today's readable trace
eve_logf            # follow it live
eve_errors          # only failures/rejections, across all days — abnormality scan
eve_logjson | eve_pretty   # today's structured events, pretty-printed

# …or without the helpers:
docker exec eve-agent-agent-1 tail -f /app/logs/sessions-$(date -u +%F).log
```

To browse the files straight from the host instead of via `docker exec`, swap
the named volume for a bind mount in `docker-compose.yml` (`./logs:/app/logs`),
or add `/app/logs` as a Persistent Storage mount in the Coolify UI.

### Tuning

| Env | Default | Effect |
|---|---|---|
| `EVE_LOG_DIR` | `/app/logs` (prod), `./logs` (dev) | Directory for log files |
| `EVE_LOG_STDOUT` | `1` | `0` silences the stdout mirror (files still written) |
| `EVE_LOG_JSON` | `1` | `0` skips the `.ndjson` sink (readable `.log` still written) |

## Local testing

Use `eve dev` to run the agent locally. To trigger a digest run manually during development — the same call the production Scheduled Task makes:

```bash
sh scripts/trigger-digest.sh
# …or directly:
curl -X POST http://localhost:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Run the daily PR & CI digest now per your instructions."}'
```

This starts one session and returns the session ID so you can watch the stream.
