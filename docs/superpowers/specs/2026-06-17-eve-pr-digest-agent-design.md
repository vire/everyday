# Eve PR Digest Agent — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming) → ready for implementation plan
**Framework:** [Eve](https://vercel.com/eve) — Vercel's open-source agent framework

## Overview

A single Eve agent that produces a **daily digest** about one GitHub repository and
posts it to Slack. Each run it gathers code contributions, pull-request status, and CI
performance via the `gh` CLI, composes a digest, posts to Slack, and maintains a
**git-backed memory** (a private gist) so it can spot trends and accumulate
repo-improvement suggestions over time.

The agent is **self-hosted** (run on the user's machine/server) and **externally
scheduled** (the user's own system cron triggers the daily run). It is not deployed to
Vercel and does not use Eve's native cron schedules.

## Goals

1. **Code contributions** — commits in the window, split into: human-authored by me,
   agent-authored (bots/AI), and my commits made with AI assistance.
2. **PR status** — open PRs grouped by review state: reviewed / approved / changes
   requested / pending review.
3. **CI performance** — per workflow: recent run count, pass/fail rate, p50 & max
   duration, slowest jobs, and newly-flaky workflows vs. what memory last saw.
4. **Repo improvement suggestions** — inline analysis each run, guided by a playbook
   skill; suggestions accumulate in memory.
5. **Memory** — the agent builds its own durable memory across runs to inform trends
   and improvements.
6. **Scheduled trigger** — runs daily, triggered by the user's own cron.

## Non-goals (v1)

- Multiple repositories, org-wide or multi-repo scope (single repo only).
- Vercel deployment and Eve native cron (`schedules/`).
- Multi-agent / subagent delegation (pure single-agent, single daily run — "Approach A").
- A weekly deep-dive cadence (analysis runs inline in the daily pass).
- Channels other than Slack.

## Locked decisions

| Decision | Choice |
|---|---|
| Structure | Single agent, single daily run (Approach A) |
| Delivery | Slack |
| Repo scope | One specific repo (`owner/name`) |
| GitHub access | `gh` CLI, authed via a PAT |
| Memory | Git-backed private gist, maintained via `gh gist` |
| Model | codex via OpenRouter (default); composer as alternative |
| Hosting | Self-hosted on user's machine/server |
| Scheduling | User's own system cron (not Eve native cron) |

## Architecture

```
                    ┌──────────────────────────────┐
   system cron ───▶ │  trigger (curl API / eve CLI) │
   (user's box)     └───────────────┬──────────────┘
                                     ▼
                        ┌─────────────────────────┐
                        │     Eve agent (daily)    │
                        │  model: codex/openrouter │
                        └───┬──────────────────┬───┘
            read memory ◀───┤                  ├───▶ post digest ──▶ Slack
                            │   gh CLI tools   │
                            │ (in runtime env) │
       contributions ◀──────┤                  ├──────▶ write memory (gist)
       pull-requests ◀──────┤                  │
       ci-health     ◀──────┘                  │
                            └──────────────────┘
                                     │
                                     ▼
                            GitHub (via gh + PAT)
```

The agent runs locally/on a server. Tools shell out to `gh` (returning structured JSON
rather than letting the model freeform-shell), so contribution classification and CI
math are deterministic. The model only composes and reasons over already-structured data.

## Directory layout

```
instructions.md              # agent role + how to run the daily pass
agent.ts                     # defineAgent({ model: <openrouter codex> })
sandbox/sandbox.ts           # minimal/local runtime; ensures gh + PAT available
channels/slack.ts            # Slack delivery (Connect or bot token — see Spike 4)
tools/
  contributions.ts           # gh: commits in window, classify me vs. agentic
  pull-requests.ts           # gh: open PRs + review/approval/pending state
  ci-health.ts               # gh run list/view: per-workflow runs, durations, pass rate
  read-memory.ts             # read the memory gist
  write-memory.ts            # update the memory gist
skills/
  digest-format.md           # the digest's shape & tone
  classifying-contributions.md  # me vs. agentic heuristics (config-refinable)
  repo-improvement-playbook.md  # what improvements to look for
docs/superpowers/specs/      # this spec
```

Note: no `schedules/` directory (external cron) and no `connections/` for GitHub (gh
handles auth via PAT).

## Data flow — one daily run

1. Trigger fires (system cron → API/CLI).
2. `read-memory` loads the prior memory gist (or creates a fresh one if absent).
3. In parallel: `contributions`, `pull-requests`, `ci-health` collect data for the window.
4. Agent composes the digest using `digest-format` + `repo-improvement-playbook` skills,
   comparing against memory for trends and previously-noted issues.
5. Post digest to Slack.
6. `write-memory` appends new learnings/suggestions and updated baselines (e.g. CI
   durations) back to the gist.

**Window:** default last 24h for contributions/PRs/CI activity, with rolling baselines
(e.g. CI durations) stored in memory for trend comparison.

## Tools

Each tool shells out to `gh`, parses `--json` output, and returns a structured object or
a structured error `{ ok: false, reason }`. None throw on `gh` failure.

- **contributions.ts** — `gh api` / `gh search commits` (or `gh api repos/{repo}/commits`)
  for the window. Returns commits with author, committer, co-author trailers, classified
  bucket (see below), additions/deletions, and per-bucket totals.
- **pull-requests.ts** — `gh pr list --repo <repo> --json number,title,author,reviewDecision,reviewRequests,reviews,isDraft,updatedAt,url`.
  Groups into: approved, changes-requested, reviewed (commented), pending-review, draft.
- **ci-health.ts** — `gh run list --repo <repo> --json ...` for recent runs, then
  `gh run view <id> --json jobs` for per-job durations on a sample of recent runs.
  Returns per-workflow: run count, pass/fail counts & rate, p50 & max duration, slowest
  jobs, and a flakiness signal (mixed pass/fail on the same SHA / recent flip vs. memory).
- **read-memory.ts / write-memory.ts** — locate the memory gist by a known description
  marker (e.g. `eve-pr-digest-memory:<repo>`); read its markdown, or create/update it.

## Contribution classification

"Me" = the authenticated `gh` user (`gh api user --jq .login`), so no manual username
config is required (overridable via `GITHUB_LOGIN`).

A commit is **agentic** if either:
- author/committer login matches a bot pattern (`*[bot]`, e.g. `github-actions[bot]`,
  `dependabot[bot]`), or
- it carries an AI co-author trailer — `Co-authored-by:` naming a known agent
  (e.g. `Claude`, `noreply@anthropic.com`, Cursor, Copilot, Devin).

Buckets reported separately:
- **Human (me)** — authored by me, no AI co-author.
- **Me + AI assist** — authored by me, with an AI co-author trailer.
- **Agent** — bot-authored or fully agent-authored.

The marker list (bot patterns, co-author identities) lives in config so the agent can
refine it via memory over time.

## Memory design

- A single **private gist** holding a markdown memory file, found-or-created by a
  description marker scoped to the repo.
- Contents: rolling CI duration/pass-rate baselines, previously-surfaced improvement
  suggestions (with status), recurring patterns, and refinements to the agentic-marker
  list.
- Read at the start of each run, rewritten at the end. A failed write logs but never
  blocks the digest. PAT needs `gist` scope.

## Scheduling (external)

- A system `crontab` entry on the user's machine/server triggers one daily run.
- Trigger mechanism is confirmed in **Spike 2** — either `curl` to the agent's API
  endpoint or a one-shot `eve` CLI invocation. The spec documents the exact crontab line
  once confirmed.
- Default time 07:00 local (user-adjustable). No Vercel cron / Eve `schedules/`.

## Model / provider

- Default: **codex via OpenRouter**, configured as `OPENROUTER_MODEL` (exact slug pinned
  at setup). **composer via OpenRouter** is the documented alternative — same wiring,
  different slug.
- Wiring confirmed in **Spike 1**. Fallback if Eve cannot accept an OpenRouter provider:
  route codex through the Vercel AI Gateway directly (composer would then be unavailable).

## Slack delivery

- Posts the composed digest to a configured Slack channel/DM.
- Auth path confirmed in **Spike 4**: Eve's `slackChannel` (Vercel Connect) vs. a Slack
  bot token / incoming webhook in env via a small post-to-Slack tool. Self-hosting favors
  the bot-token path; final choice depends on whether Connect works off-platform.

## Configuration

Required at setup (env / agent config):

| Key | Purpose | Default / source |
|---|---|---|
| `TARGET_REPO` | the one repo, `owner/name` | provided at setup |
| `GH_TOKEN` | PAT for `gh` | scopes: `repo` + `gist` (authorize for org SSO if needed) |
| `GITHUB_LOGIN` | who "me" is | derived from `gh api user` if unset |
| `OPENROUTER_API_KEY` | model access | provided at setup |
| `OPENROUTER_MODEL` | codex/composer slug | codex default |
| Slack target | channel/DM + token/creds | per Spike 4 |
| Digest time | crontab schedule | 07:00 local |

## Error handling

- Each tool returns structured data or a structured error; one failing section (rate
  limit, auth, network) degrades to "data unavailable" rather than killing the run.
- No activity in the window → a short "quiet day" note (still posts).
- Memory gist missing → create fresh; failed memory write logs but never blocks the digest.
- Eve Workflows checkpointing covers crashes/resumes for the run itself.

## Testing

- **Unit (pure functions):** contribution classification and CI aggregation, fed sample
  `gh` JSON fixtures — the only parts with real logic.
- **`eve eval`:** agent end-to-end against fixture data — asserts digest structure and
  correct classification.
- **Manual:** `eve dev` to trigger the pass on demand and eyeball the Slack output before
  enabling the cron entry.

## Verification spikes (do first, each has a fallback)

1. **OpenRouter provider** — can `defineAgent` use an OpenRouter model/provider?
   Fallback: codex via Vercel AI Gateway.
2. **External trigger** — how to trigger a one-shot run from system cron (API endpoint vs.
   `eve` CLI). Fallback: keep `eve dev` running and curl a local endpoint.
3. **Tool execution vs. sandbox** — confirm `gh` is reachable from `defineTool.execute`
   in the self-hosted runtime. Fallback: run `gh` calls inside a sandbox step.
4. **Slack auth off-platform** — `slackChannel`/Connect vs. bot-token/webhook tool when
   self-hosted. Fallback: small post-to-Slack tool using a bot token.

A short spike resolving all four is the first implementation task; the design holds under
either branch of each.

## Out of scope / future

- Multiple repos, org scope, weekly deep-dive cadence, subagents.
- Vercel deployment + Eve native cron (a documented alternative if hosting changes).
- Channels beyond Slack; the agent proposing skill-edit PRs as a memory mechanism.
