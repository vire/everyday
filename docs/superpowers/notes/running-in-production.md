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
| `OPENROUTER_API_KEY` | OpenRouter API key (`sk-or-...`) |
| `OPENROUTER_MODEL` | Model slug (default: `openai/gpt-5-codex`) |
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

## Local testing

Use `eve dev` to run the agent locally. Schedules do **not** fire on their cron cadence in dev mode. To trigger the schedule manually during development:

```bash
curl -X POST http://localhost:3000/eve/v1/dev/schedules/daily-digest
```

This fires the schedule exactly once and returns the started session ID so you can watch the stream.
