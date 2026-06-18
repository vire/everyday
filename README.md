# Eve PR & CI Digest Agent

An [Eve](https://vercel.com/docs/ai/eve) agent that posts a daily GitHub repository digest to Slack. It classifies code contributions, summarises open pull requests by review state, reports CI workflow health, proposes repo-improvement suggestions, and accumulates baselines across runs in a private GitHub Gist.

---

## What it does

Each morning the agent:

1. **Reads memory** from a private Gist — CI baselines and open improvement suggestions carried over from prior runs.
2. **Classifies commits** from the past 24 hours into four buckets: authored by you, AI-assisted by you, automated agents/bots, and other contributors.
3. **Groups open PRs** by review state: approved, changes requested, reviewed (commented), pending review, and draft.
4. **Reports CI health** per workflow: pass rate over the window, p50 and max durations, slowest job name, flaky-workflow flags, and regression flags when duration exceeds the stored baseline by more than 20%.
5. **Proposes up to 3 improvements** — specific, evidence-backed suggestions reconciled against the stored list so nothing repeats.
6. **Posts the digest to Slack** as a single message.
7. **Updates memory** in the Gist — refreshed CI baselines, updated suggestion statuses, and any new classification notes.

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
│   └── schedules/
│       └── daily-digest.md   # cron: "0 7 * * *" (UTC)
├── lib/                      # Pure logic — no I/O, fully unit-tested
│   ├── contributions.ts      # Commit classification
│   ├── pull-requests.ts      # PR grouping
│   ├── ci-health.ts          # Workflow aggregation
│   ├── memory.ts             # Gist helpers (find / parse / serialise)
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
- Memory lives in a private Gist (not a database) — portable and auditable.
- The daily trigger is a native Eve schedule (`cron` frontmatter) — no external cron daemon needed when `eve start` is running.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node 24 | `engines.node: "24.x"` in `package.json` |
| pnpm | `packageManager: "pnpm@10.33.0"` |
| `gh` CLI | Must be authenticated; used by every tool |
| GitHub PAT | Scopes: `repo` (read commits, PRs, CI) + `gist` (read/write memory gist) |
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
| `TARGET_REPO` | Yes | `owner/name` of the GitHub repository to digest |
| `GITHUB_LOGIN` | No | Your GitHub login for contribution attribution; defaults to `gh api user` |
| `GH_TOKEN` | Yes | Personal Access Token with `repo` + `gist` scopes |
| `OPENROUTER_API_KEY` | Yes | OpenRouter key (`sk-or-...`) |
| `OPENROUTER_MODEL` | Yes | Any valid OpenRouter model slug (default: `openai/gpt-5-nano`). **Avoid `*-codex` slugs** — they enforce strict function-call schemas and reject this agent's tool definitions. **Confirm the slug exists in your OpenRouter catalog.** Alternatives: `openai/gpt-5-mini`, `openai/gpt-5.2`. |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (`xoxb-...`) with `chat:write` scope |
| `SLACK_CHANNEL_ID` | Yes | Target Slack channel ID (`C0XXXXXXX`) |

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

Starts the agent server in development mode. Schedules do **not** fire automatically in dev. To trigger the digest manually:

```bash
curl -X POST http://localhost:3000/eve/v1/dev/schedules/daily-digest
```

### Production

```bash
eve start
```

Keeps the agent server running and fires the native schedule (`0 7 * * *` UTC) each day.

> **Timezone:** Eve evaluates cron expressions in UTC — there is no `timezone` field. The default `"0 7 * * *"` fires at 07:00 UTC. Adjust the hour in `agent/schedules/daily-digest.md` for your local time:
>
> | Desired local time | UTC cron hour |
> |---|---|
> | 07:00 UTC | `0 7 * * *` |
> | 07:00 CET (UTC+1) | `0 6 * * *` |
> | 07:00 EST (UTC-5) | `0 12 * * *` |
> | 07:00 PST (UTC-8) | `0 15 * * *` |

For systemd or pm2 setup see [`docs/superpowers/notes/running-in-production.md`](docs/superpowers/notes/running-in-production.md).

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

- [ ] Copy `.env.example` to `.env` and fill in all five required values.
- [ ] Confirm your `OPENROUTER_MODEL` slug exists in your OpenRouter catalog at [openrouter.ai/models](https://openrouter.ai/models).
- [ ] Verify `gh auth status` shows the PAT with `repo` and `gist` scopes.
- [ ] Run `eve dev`, then `curl -X POST http://localhost:3000/eve/v1/dev/schedules/daily-digest` and watch the session stream — confirm the Slack post arrives and the Gist is created/updated.
- [ ] Adjust the cron hour in `agent/schedules/daily-digest.md` for your timezone.
- [ ] Start production with `eve start` (or configure systemd/pm2 — see `running-in-production.md`).
- [ ] Optionally raise `modelContextWindowTokens` in `agent/agent.ts` to your model's real context window.

---

## Reference

- Design spec: [`docs/superpowers/specs/2026-06-17-eve-pr-digest-agent-design.md`](docs/superpowers/specs/2026-06-17-eve-pr-digest-agent-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-06-17-eve-pr-digest-agent.md`](docs/superpowers/plans/2026-06-17-eve-pr-digest-agent.md)
- Production setup: [`docs/superpowers/notes/running-in-production.md`](docs/superpowers/notes/running-in-production.md)
- Eve framework docs: [vercel.com/docs/ai/eve](https://vercel.com/docs/ai/eve)
