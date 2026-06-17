# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A playground for experimenting with **Eve** — Vercel's open-source framework for building, deploying, and scaling AI agents (https://vercel.com/blog/introducing-eve). The goal here is trying out agent automation, not shipping a product.

**Current state: greenfield.** The repo contains only a default `package.json` (package manager pinned to `pnpm@10.33.0`, Node 24). There is no agent code, no `eve` dependency, and no scaffolding yet. The conventions below describe how an Eve project is *expected* to be laid out once scaffolded — treat them as the target structure, not as something already present. Verify the actual file layout before relying on it.

## Tooling

- Package manager is **pnpm** (`pnpm@10.33.0`), not npm or yarn. Use `pnpm install` / `pnpm add`.
- The `test` script is the `npm init` placeholder (`exit 1`) and is not a real test command. Eve uses `eve eval` for testing agents (see below).

## Bootstrapping an Eve agent

The repo has not been initialized as an Eve project. To scaffold it:

```bash
npx eve@latest init        # scaffold an agent
eve dev                     # run a local dev server for the agent
eve eval                    # run evals (Eve's test/evaluation harness)
vercel deploy               # deploy — Eve agents are standard Vercel projects
```

## Eve architecture (target conventions)

Eve is **filesystem-first**: an agent is a directory, and its behavior is defined by convention-named files rather than imperative wiring. Understanding the big picture means knowing what each file/dir is responsible for:

- `agent.ts` — the agent's configuration (model, settings, composition).
- `instructions.md` — the system prompt / behavioral instructions, authored as Markdown.
- `tools/` — TypeScript files exporting tools via `defineTool`. Tools are the agent's callable actions.
- `skills/` — Markdown documents that give the agent domain knowledge (reference material, not executable).
- `schedules/` — recurring/triggered runs defined via `defineSchedule`.
- `channels/` — deployment surfaces defined via `defineChannel` (Slack, Discord, Teams, GitHub, etc.).
- `connections/` — integrations with external systems.

Key framework concepts that shape how features are built:

- **Durable execution** — long-running tasks checkpoint and resume, so agent logic is written to survive interruption.
- **Sandboxed compute** — agent work runs in isolated environments.
- **Human-in-the-loop** — approval steps gate sensitive actions.
- **Subagents** — agents delegate to other agents (multi-agent composition).
- **Tracing & evals** — built in; prefer `eve eval` over ad-hoc scripts to validate agent behavior.

The defining pattern: prefer `defineTool` / `defineSchedule` / `defineChannel` SDK helpers and convention-named files over hand-wired plumbing. When adding a capability, ask which convention slot it belongs in (tool vs. skill vs. channel vs. schedule) before writing glue code.
