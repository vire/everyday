# Eve PR & CI Digest Agent

An [Eve](https://vercel.com/docs/ai/eve) agent that posts a daily digest for one or more GitHub repositories to Slack. It classifies code contributions, summarises open pull requests by review state, reports CI workflow health, proposes repo-improvement suggestions, and accumulates baselines across runs in a local markdown file per repo (persisted on a Docker volume). Configure the repos as a comma-delimited list in `TARGET_REPO`.

---

## What it does

Each morning the agent:

1. **Reads memory** from a local file per repo — CI baselines and open improvement suggestions carried over from prior runs.
2. **Classifies commits** from the past 24 hours into four buckets: authored by you, AI-assisted by you, automated agents/bots, and other contributors.
3. **Groups open PRs** by review state: approved, changes requested, reviewed (commented), pending review, and draft.
4. **Reports CI health** per workflow: pass rate over the window, p50 and max durations, slowest job name, flaky-workflow flags, and regression flags when duration exceeds the stored baseline by more than 20%.
5. **Proposes up to 3 improvements** — specific, evidence-backed suggestions reconciled against the stored list so nothing repeats.
6. **Posts the digest to Slack** as a single message.
7. **Updates memory** in the file — refreshed CI baselines, updated suggestion statuses, and any new classification notes.

A "quiet day" (no commits, no PR movement, CI all-green) produces a short note instead of a full digest. If any data source is unavailable the agent continues and marks that section "data unavailable — `<reason>`".

---

## Architecture

```
eve-agent/
├── agent/
│   ├── agent.ts              # Eve agent definition; model via OpenRouter
│   ├── instructions.md       # Eight-step run protocol
│   ├── tools/                # Six tools (contributions, pull-requests,
│   │   │                     #   ci-health, read-memory, write-memory,
│   │   └── ...               #   post-to-slack); each shells out to `gh` or curl
│   ├── skills/               # digest-format, classifying-contributions,
│   │   └── ...               #   repo-improvement-playbook
│   ├── channels/             # eve.ts — HTTP trigger surface (optional Basic auth)
│   └── hooks/                # session-logger.ts — per-event session logging
├── scripts/
│   └── trigger-digest.sh     # one-shot trigger; run by a Coolify Scheduled Task
├── lib/                      # Pure logic — no I/O, fully unit-tested
│   ├── contributions.ts      # Commit classification
│   ├── pull-requests.ts      # PR grouping
│   ├── ci-health.ts          # Workflow aggregation
│   ├── memory.ts             # memory file path + initial-template helpers
│   └── gh.ts                 # `gh` CLI wrapper (ghJson / resolveMe)
├── evals/
│   ├── evals.config.ts       # Eval run configuration
│   └── digest.eval.ts        # Smoke-check eval: schedule dispatch + tool order
└── docs/superpowers/
    ├── specs/2026-06-17-eve-pr-digest-agent-design.md
    └── notes/running-in-production.md
```

**Key design choices:**

- `lib/` contains all pure logic with no side-effects — tested with Vitest, no network required.
- Eve tools in `agent/tools/` are thin wrappers that call `lib/` for computation and `gh`/`curl` for I/O.
- The model is loaded via `@ai-sdk/openai-compatible` pointed at `openrouter.ai`, bypassing the Vercel AI Gateway catalog. Any OpenRouter model slug works.
- Memory lives in a local markdown file per repo on a persistent Docker volume (not a database) — portable, auditable, and survives container restarts / redeploys.
- The daily trigger is a **Coolify Scheduled Task** that runs `scripts/trigger-digest.sh` inside the agent container on a cron cadence — no sidecar or external cron daemon, just the single `eve start` server container.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node 24 | `engines.node: "24.x"` in `package.json` |
| pnpm | `packageManager: "pnpm@10.33.0"` |
| `gh` CLI | Must be authenticated; used by every tool |
| GitHub PAT | `repo` scope (read commits, PRs, CI). Fine-grained: **Contents/Pull requests/Actions: Read** on the target repos. No `gist` scope needed — memory is a local file. |
| OpenRouter API key | Any plan; model catalog at [openrouter.ai/models](https://openrouter.ai/models) |
| Slack bot token | `chat:write` scope; create at [api.slack.com/apps](https://api.slack.com/apps) |

---

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `TARGET_REPO` | Yes | Comma-delimited `owner/name` list of repos to digest (e.g. `octocat/hello-world,acme/widgets`). A single value works unchanged; each repo gets its own digest section and memory file. |
| `GITHUB_LOGIN` | No | Your GitHub login for contribution attribution; defaults to `gh api user` |
| `GH_TOKEN` | Yes | Personal Access Token, `repo` scope (read-only on the target repos is enough; no `gist`) |
| `OPENAI_API_KEY` | Provider | Your OpenAI key (`sk-...`). Used **only when `OPENAI_MODEL` is also set** — then the agent talks to OpenAI directly. |
| `OPENAI_MODEL` | Provider | OpenAI model slug (e.g. `gpt-5-nano`). Required to select OpenAI; leave empty to stay on OpenRouter. **Avoid `*-codex` slugs.** |
| `OPENROUTER_API_KEY` | Provider | OpenRouter key (`sk-or-...`). Used unless **both** OpenAI vars above are set. |
| `OPENROUTER_MODEL` | No | OpenRouter model slug (default: `openai/gpt-5-nano`). **Avoid `*-codex` slugs** — they enforce strict function-call schemas and reject this agent's tool definitions. **Confirm the slug exists in your OpenRouter catalog.** Alternatives: `openai/gpt-5-mini`, `openai/gpt-5.2`. |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (`xoxb-...`) with `chat:write` scope |
| `SLACK_CHANNEL_ID` | Yes | Target Slack channel ID (`C0XXXXXXX`) |

> **Provider precedence:** OpenAI takes preference, but only when **both** `OPENAI_API_KEY` and `OPENAI_MODEL` are set. With either missing it falls back to OpenRouter — so set one provider's pair fully. The rule lives in `agent/lib/model.ts` (unit-tested in `agent/lib/model.test.ts`).
>
> **Context window:** `modelContextWindowTokens` is set to `128_000` in `agent/agent.ts`. Raise it to match your model's actual context window if needed.

---

## Running

### Install dependencies

```bash
pnpm install
```

### Local interactive testing

```bash
eve dev
```

Starts the agent server in development mode. To trigger a digest run manually, POST to the session endpoint (the same call the production Scheduled Task makes):

```bash
curl -X POST http://localhost:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Run the daily PR & CI digest now per your instructions."}'
# or, inside/against a running container:
sh scripts/trigger-digest.sh
```

### Production

`docker-compose.yml` / the Dockerfile run a single container that serves the agent:

```bash
eve start   # the container CMD; keeps the HTTP server up on :3000
```

**Scheduling is a Coolify "Scheduled Task" on the agent resource** — not code in this repo. After deploying, add a Scheduled Task that execs the trigger script in the agent container:

| Field | Value |
|---|---|
| Name | `daily-digest` |
| Command | `sh /app/scripts/trigger-digest.sh` |
| Frequency | `0 7 * * *` (cron) |
| Timeout (seconds) | `900` |
| Container name | `agent` |

The script POSTs to the agent's own `/eve/v1/session` endpoint (anchoring a session so the tool-using run completes) and forwards HTTP Basic auth when `AGENT_BASIC_USER` / `AGENT_BASIC_PASS` are set.

> **Timezone:** Coolify evaluates the Frequency cron in the **Coolify server's timezone** (configurable in Coolify settings), not necessarily UTC — pick the hour to match. e.g. for 07:00 CET on a UTC host use `0 6 * * *`.

For systemd or pm2 setup (running the server outside Coolify) see [`docs/superpowers/notes/running-in-production.md`](docs/superpowers/notes/running-in-production.md).

---

## Testing

### Unit tests (no credentials required)

```bash
pnpm test
```

Runs 23 Vitest tests covering `lib/` — contributions classification, PR grouping, CI aggregation, and memory parsing. No network calls.

### End-to-end eval (requires OpenRouter key)

```bash
eve eval
```

Runs `evals/digest.eval.ts`, which dispatches the daily-digest schedule and asserts the agent calls all six tools in order, produces a message containing the four contribution buckets, the five PR states, and at least one CI workflow line, and completes without a terminal failure.

> The eval calls the live agent (started by `eve eval` against a local dev server), which in turn calls real GitHub and Slack. Set all env vars before running it. To skip the live run and inspect the eval structure only, run `eve info`.

---

## Activation checklist

Before the digest will work end to end:

- [ ] Copy `.env.example` to `.env` and fill in the required values.
- [ ] Pick a provider: set **both** `OPENAI_API_KEY` and `OPENAI_MODEL` to use OpenAI, **or** set `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`) to use OpenRouter. Confirm the slug exists in that provider's catalog.
- [ ] Verify `gh auth status` shows the PAT with `repo` scope (read on the target repos).
- [ ] Run `eve dev`, then `sh scripts/trigger-digest.sh` (or the `curl` above) and watch the session stream — confirm the Slack post arrives and the memory file is created/updated.
- [ ] Start production with `eve start` (the container CMD), then add the Coolify **Scheduled Task** (`sh /app/scripts/trigger-digest.sh` on the `agent` container) with your cron hour.
- [ ] Optionally raise `modelContextWindowTokens` in `agent/agent.ts` to your model's real context window.

---

## Reference

- Design spec: [`docs/superpowers/specs/2026-06-17-eve-pr-digest-agent-design.md`](docs/superpowers/specs/2026-06-17-eve-pr-digest-agent-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-06-17-eve-pr-digest-agent.md`](docs/superpowers/plans/2026-06-17-eve-pr-digest-agent.md)
- Production setup: [`docs/superpowers/notes/running-in-production.md`](docs/superpowers/notes/running-in-production.md)
- Eve framework docs: [vercel.com/docs/ai/eve](https://vercel.com/docs/ai/eve)
