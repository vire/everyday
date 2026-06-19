# Running in Production (Self-Hosted)

## How scheduling works

The daily digest fires via a **native Eve schedule** defined in `agent/schedules/daily-digest.md`. There is no external cron script. Eve reads the `cron` frontmatter and manages the schedule itself. To have the schedule fire, you must keep `eve start` running on the server.

```
cron: "0 7 * * *"   # 07:00 UTC daily (see timezone note below)
```

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
| `OPENAI_API_KEY` | Your own OpenAI key (`sk-...`). When set, the agent talks to OpenAI directly instead of OpenRouter. |
| `OPENAI_MODEL` | OpenAI model slug (default: `gpt-5-nano`; avoid `*-codex` slugs) |
| `OPENROUTER_API_KEY` | OpenRouter API key (`sk-or-...`) — used only when `OPENAI_API_KEY` is unset |
| `OPENROUTER_MODEL` | OpenRouter model slug (default: `openai/gpt-5-nano`; avoid `*-codex` slugs) |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) with `chat:write` scope |
| `SLACK_CHANNEL_ID` | Target Slack channel ID (`C0XXXXXXX`) |

## Timezone note

Eve evaluates cron expressions in **UTC** (confirmed by Eve docs: "Vercel evaluates the expression in UTC"). The schedule `"0 7 * * *"` fires at **07:00 UTC**. If your team is in a different timezone, adjust the hour:

| Desired local time | UTC cron hour |
|---|---|
| 07:00 UTC | `0 7 * * *` |
| 07:00 CET (UTC+1) | `0 6 * * *` |
| 07:00 EST (UTC-5) | `0 12 * * *` |
| 07:00 PST (UTC-8) | `0 15 * * *` |

`defineSchedule` has **no `timezone` field** — the cron is always UTC. Adjust the hour in `agent/schedules/daily-digest.md` to match your desired local time.

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

Use `eve dev` to run the agent locally. Schedules do **not** fire on their cron cadence in dev mode. To trigger the schedule manually during development:

```bash
curl -X POST http://localhost:3000/eve/v1/dev/schedules/daily-digest
```

This fires the schedule exactly once and returns the started session ID so you can watch the stream.
