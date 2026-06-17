# Eve PR Digest Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted, externally-scheduled Eve agent that posts a daily GitHub PR/CI digest for one repo to Slack and maintains git-backed (gist) memory.

**Architecture:** A single Eve agent. Pure data logic lives in `lib/` (framework-agnostic, unit-tested with vitest); thin Eve `defineTool` wrappers in `tools/` shell out to `gh` and feed its `--json` output into the pure functions. The agent composes a digest and posts to Slack, then rewrites a private memory gist. Scheduling is the user's own system cron triggering one run/day.

**Tech Stack:** TypeScript, Eve framework, pnpm@10.33.0, Node 24, zod, vitest, the `gh` CLI, OpenRouter (codex model).

## Global Constraints

- Runtime: Node 24; package manager **pnpm** (`pnpm@10.33.0`) — never npm/yarn.
- Single repo only, from env `TARGET_REPO` (`owner/name`).
- GitHub access exclusively via the `gh` CLI, authed by a PAT in `GH_TOKEN` (scopes: `repo` + `gist`).
- "Me" is resolved at runtime via `gh api user --jq .login`, overridable by env `GITHUB_LOGIN`.
- Model: codex via OpenRouter, env `OPENROUTER_MODEL` (default a codex slug) + `OPENROUTER_API_KEY`. Fallback if Eve can't take an OpenRouter provider: codex via Vercel AI Gateway.
- Self-hosted: **no Vercel deploy, no Eve `schedules/` cron, no `connections/` dir.** Scheduling is the user's system cron.
- Memory = a single **private gist**, found-or-created by description marker `eve-pr-digest-memory:<repo>`, file `memory.md`.
- Delivery = Slack.
- Every tool returns either structured data or `{ ok: false, reason: string }`. **Tools never throw on `gh` failure.**
- Commits: this environment's GPG signing times out — use `git commit --no-gpg-sign`. Commit straight to `main` (no PRs, per user).

---

### Task 1: Scaffold the Eve agent, tooling, and confirm `gh`-in-tool execution (Spike 3)

**Files:**
- Create (via CLI): Eve agent skeleton at repo root (`instructions.md`, `agent.ts`, `tools/`, etc.)
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest`, `zod`; set `test` script)
- Create: `tools/_probe.ts` (temporary spike tool)
- Create: `docs/superpowers/notes/eve-api.md` (record real API shapes + spike outcomes)

**Interfaces:**
- Produces: confirmed signatures for `defineAgent`, `defineTool` (`eve/tools`), sandbox, and Slack channel, written to `docs/superpowers/notes/eve-api.md`; a working `eve dev`; vitest wired so `pnpm test` runs.

- [ ] **Step 1: Scaffold the agent**

Run: `npx eve@latest init .` (init into the current repo; if it refuses a non-empty dir, init into `./agent` and record that path in the notes file — every later path is then relative to it).
Expected: Eve directory layout created; `pnpm install` succeeds.

- [ ] **Step 2: Record the real Eve API**

Open the generated `agent.ts` and any example tool. In `docs/superpowers/notes/eve-api.md`, write down the *actual* import paths and signatures for `defineAgent`, `defineTool`, `defineSandbox`, and the Slack channel helper. Later tasks cite this file. (The doc-current shapes are: `import { defineAgent } from "eve"`, `import { defineTool } from "eve/tools"` with `{ description, inputSchema: z.object(...), execute(input) }`, `import { defineSandbox, vercelSandboxBackend } from "eve/sandbox"`, `import { slackChannel } from "eve/channels/slack"`.)

- [ ] **Step 3: Add test tooling**

Run: `pnpm add -D vitest && pnpm add zod`
Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
```

Set the `test` script in `package.json`:

```json
"scripts": { "test": "vitest run" }
```

- [ ] **Step 4: Confirm `gh` is reachable from tool execution (Spike 3)**

Create `tools/_probe.ts`:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export default defineTool({
  description: "probe: confirm gh CLI is callable from tool execution",
  inputSchema: z.object({}),
  async execute() {
    try {
      const { stdout } = await run("gh", ["--version"]);
      return { ok: true as const, version: stdout.trim() };
    } catch (e) {
      return { ok: false as const, reason: String(e) };
    }
  },
});
```

- [ ] **Step 5: Run the probe via `eve dev`**

Run: `eve dev`, then in the chat ask the agent to call the `_probe` tool (or invoke per the CLI's tool-run affordance discovered in Step 2).
Expected: returns `{ ok: true, version: "gh version ..." }`. If it fails because `gh` isn't on the execution PATH, record the resolution in the notes file: wrap `gh` calls in a sandbox step, or ensure `gh` is installed where tools execute. **This outcome is Spike 3's answer** and all later tool tasks follow it.

- [ ] **Step 6: Remove the probe and commit**

Delete `tools/_probe.ts`.

```bash
git add -A
git commit --no-gpg-sign -m "chore: scaffold Eve agent, vitest tooling, confirm gh-in-tool execution"
```

---

### Task 2: Contribution classification (`lib/contributions.ts`)

**Files:**
- Create: `lib/contributions.ts`
- Test: `lib/contributions.test.ts`

**Interfaces:**
- Produces:
  - `interface RawCommit { sha: string; authorLogin: string | null; committerLogin: string | null; message: string }`
  - `type Bucket = "human_me" | "me_ai_assist" | "agent" | "other"`
  - `interface AgentMarkers { botLoginPattern: RegExp; coAuthorIdentities: string[] }`
  - `const DEFAULT_AGENT_MARKERS: AgentMarkers`
  - `function parseCoAuthors(message: string): string[]`
  - `function classifyCommit(c: RawCommit, me: string, markers: AgentMarkers): Bucket`
  - `interface ContributionsSummary { total: number; humanMe: number; meAiAssist: number; agent: number; other: number }`
  - `function summarizeContributions(commits: RawCommit[], me: string, markers: AgentMarkers): ContributionsSummary`

- [ ] **Step 1: Write the failing tests**

`lib/contributions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseCoAuthors,
  classifyCommit,
  summarizeContributions,
  DEFAULT_AGENT_MARKERS,
  type RawCommit,
} from "./contributions";

const me = "vire";
const M = DEFAULT_AGENT_MARKERS;

describe("parseCoAuthors", () => {
  it("extracts lowercased identities from Co-authored-by trailers", () => {
    const msg = "Fix bug\n\nCo-authored-by: Claude Opus <noreply@anthropic.com>";
    expect(parseCoAuthors(msg)).toEqual(["claude opus", "noreply@anthropic.com"]);
  });
  it("returns [] when there are no trailers", () => {
    expect(parseCoAuthors("plain message")).toEqual([]);
  });
});

describe("classifyCommit", () => {
  const base: RawCommit = { sha: "a", authorLogin: me, committerLogin: me, message: "x" };
  it("human_me: my commit, no AI", () => {
    expect(classifyCommit(base, me, M)).toBe("human_me");
  });
  it("me_ai_assist: my commit with AI co-author", () => {
    const c = { ...base, message: "x\n\nCo-authored-by: Claude <noreply@anthropic.com>" };
    expect(classifyCommit(c, me, M)).toBe("me_ai_assist");
  });
  it("agent: bot author", () => {
    const c = { ...base, authorLogin: "dependabot[bot]" };
    expect(classifyCommit(c, me, M)).toBe("agent");
  });
  it("other: someone else's human commit", () => {
    const c = { ...base, authorLogin: "alice", committerLogin: "alice" };
    expect(classifyCommit(c, me, M)).toBe("other");
  });
});

describe("summarizeContributions", () => {
  it("counts each bucket", () => {
    const commits: RawCommit[] = [
      { sha: "1", authorLogin: me, committerLogin: me, message: "a" },
      { sha: "2", authorLogin: me, committerLogin: me, message: "b\n\nCo-authored-by: Claude <noreply@anthropic.com>" },
      { sha: "3", authorLogin: "github-actions[bot]", committerLogin: "github-actions[bot]", message: "c" },
      { sha: "4", authorLogin: "bob", committerLogin: "bob", message: "d" },
    ];
    expect(summarizeContributions(commits, me, M)).toEqual({
      total: 4, humanMe: 1, meAiAssist: 1, agent: 1, other: 1,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/contributions.test.ts`
Expected: FAIL — module `./contributions` not found.

- [ ] **Step 3: Implement `lib/contributions.ts`**

```ts
export interface RawCommit {
  sha: string;
  authorLogin: string | null;
  committerLogin: string | null;
  message: string;
}

export type Bucket = "human_me" | "me_ai_assist" | "agent" | "other";

export interface AgentMarkers {
  botLoginPattern: RegExp;
  coAuthorIdentities: string[];
}

export const DEFAULT_AGENT_MARKERS: AgentMarkers = {
  botLoginPattern: /\[bot\]$/i,
  coAuthorIdentities: ["claude", "noreply@anthropic.com", "cursor", "copilot", "devin"],
};

export function parseCoAuthors(message: string): string[] {
  const out: string[] = [];
  for (const line of message.split("\n")) {
    const m = line.match(/^\s*Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i);
    if (m) {
      out.push(m[1].toLowerCase());
      out.push(m[2].toLowerCase());
    }
  }
  return out;
}

function isBot(login: string | null, markers: AgentMarkers): boolean {
  return !!login && markers.botLoginPattern.test(login);
}

function hasAiCoAuthor(message: string, markers: AgentMarkers): boolean {
  const ids = parseCoAuthors(message);
  return ids.some((id) =>
    markers.coAuthorIdentities.some((marker) => id.includes(marker.toLowerCase())),
  );
}

export function classifyCommit(c: RawCommit, me: string, markers: AgentMarkers): Bucket {
  if (isBot(c.authorLogin, markers) || isBot(c.committerLogin, markers)) return "agent";
  const mine = c.authorLogin === me;
  if (mine) return hasAiCoAuthor(c.message, markers) ? "me_ai_assist" : "human_me";
  return "other";
}

export interface ContributionsSummary {
  total: number;
  humanMe: number;
  meAiAssist: number;
  agent: number;
  other: number;
}

export function summarizeContributions(
  commits: RawCommit[],
  me: string,
  markers: AgentMarkers,
): ContributionsSummary {
  const s: ContributionsSummary = { total: commits.length, humanMe: 0, meAiAssist: 0, agent: 0, other: 0 };
  for (const c of commits) {
    const b = classifyCommit(c, me, markers);
    if (b === "human_me") s.humanMe++;
    else if (b === "me_ai_assist") s.meAiAssist++;
    else if (b === "agent") s.agent++;
    else s.other++;
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run lib/contributions.test.ts`
Expected: PASS (3 suites, 7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/contributions.ts lib/contributions.test.ts
git commit --no-gpg-sign -m "feat: contribution classification (me / me+AI / agent / other)"
```

---

### Task 3: Pull-request grouping (`lib/pull-requests.ts`)

**Files:**
- Create: `lib/pull-requests.ts`
- Test: `lib/pull-requests.test.ts`

**Interfaces:**
- Produces:
  - `interface RawPR { number: number; title: string; authorLogin: string; reviewDecision: string | null; isDraft: boolean; reviewCount: number; updatedAt: string; url: string }`
  - `type PRState = "approved" | "changes_requested" | "reviewed" | "pending_review" | "draft"`
  - `function classifyPR(pr: RawPR): PRState`
  - `interface PullRequestGroups { approved: RawPR[]; changesRequested: RawPR[]; reviewed: RawPR[]; pendingReview: RawPR[]; draft: RawPR[] }`
  - `function groupPullRequests(prs: RawPR[]): PullRequestGroups`

- [ ] **Step 1: Write the failing tests**

`lib/pull-requests.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyPR, groupPullRequests, type RawPR } from "./pull-requests";

function pr(p: Partial<RawPR>): RawPR {
  return { number: 1, title: "t", authorLogin: "vire", reviewDecision: null, isDraft: false, reviewCount: 0, updatedAt: "2026-06-16T00:00:00Z", url: "u", ...p };
}

describe("classifyPR", () => {
  it("draft wins over everything", () => {
    expect(classifyPR(pr({ isDraft: true, reviewDecision: "APPROVED" }))).toBe("draft");
  });
  it("APPROVED -> approved", () => {
    expect(classifyPR(pr({ reviewDecision: "APPROVED" }))).toBe("approved");
  });
  it("CHANGES_REQUESTED -> changes_requested", () => {
    expect(classifyPR(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe("changes_requested");
  });
  it("reviews present but no decision -> reviewed", () => {
    expect(classifyPR(pr({ reviewDecision: "REVIEW_REQUIRED", reviewCount: 2 }))).toBe("reviewed");
  });
  it("no reviews, no decision -> pending_review", () => {
    expect(classifyPR(pr({ reviewDecision: null, reviewCount: 0 }))).toBe("pending_review");
  });
});

describe("groupPullRequests", () => {
  it("buckets each PR once", () => {
    const groups = groupPullRequests([
      pr({ number: 1, reviewDecision: "APPROVED" }),
      pr({ number: 2, reviewDecision: "CHANGES_REQUESTED" }),
      pr({ number: 3, isDraft: true }),
      pr({ number: 4, reviewCount: 0 }),
    ]);
    expect(groups.approved.map((p) => p.number)).toEqual([1]);
    expect(groups.changesRequested.map((p) => p.number)).toEqual([2]);
    expect(groups.draft.map((p) => p.number)).toEqual([3]);
    expect(groups.pendingReview.map((p) => p.number)).toEqual([4]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/pull-requests.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/pull-requests.ts`**

```ts
export interface RawPR {
  number: number;
  title: string;
  authorLogin: string;
  reviewDecision: string | null;
  isDraft: boolean;
  reviewCount: number;
  updatedAt: string;
  url: string;
}

export type PRState = "approved" | "changes_requested" | "reviewed" | "pending_review" | "draft";

export function classifyPR(pr: RawPR): PRState {
  if (pr.isDraft) return "draft";
  if (pr.reviewDecision === "APPROVED") return "approved";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes_requested";
  return pr.reviewCount > 0 ? "reviewed" : "pending_review";
}

export interface PullRequestGroups {
  approved: RawPR[];
  changesRequested: RawPR[];
  reviewed: RawPR[];
  pendingReview: RawPR[];
  draft: RawPR[];
}

export function groupPullRequests(prs: RawPR[]): PullRequestGroups {
  const groups: PullRequestGroups = { approved: [], changesRequested: [], reviewed: [], pendingReview: [], draft: [] };
  for (const pr of prs) {
    const state = classifyPR(pr);
    if (state === "approved") groups.approved.push(pr);
    else if (state === "changes_requested") groups.changesRequested.push(pr);
    else if (state === "reviewed") groups.reviewed.push(pr);
    else if (state === "pending_review") groups.pendingReview.push(pr);
    else groups.draft.push(pr);
  }
  return groups;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run lib/pull-requests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pull-requests.ts lib/pull-requests.test.ts
git commit --no-gpg-sign -m "feat: group PRs by review state"
```

---

### Task 4: CI health aggregation (`lib/ci-health.ts`)

**Files:**
- Create: `lib/ci-health.ts`
- Test: `lib/ci-health.test.ts`

**Interfaces:**
- Produces:
  - `interface RawRun { id: number; workflowName: string; conclusion: string | null; createdAt: string; updatedAt: string; headSha: string }`
  - `interface RawJob { name: string; startedAt: string; completedAt: string | null }`
  - `function durationSec(startISO: string, endISO: string): number`
  - `function median(nums: number[]): number`
  - `interface WorkflowHealth { workflow: string; runCount: number; passCount: number; failCount: number; passRate: number; p50DurationSec: number; maxDurationSec: number; slowestJobs: { name: string; durationSec: number }[]; flaky: boolean }`
  - `interface CiHealthReport { workflows: WorkflowHealth[] }`
  - `function aggregateCiHealth(runs: RawRun[], jobsByRunId: Record<number, RawJob[]>): CiHealthReport`

- [ ] **Step 1: Write the failing tests**

`lib/ci-health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { durationSec, median, aggregateCiHealth, type RawRun, type RawJob } from "./ci-health";

describe("durationSec / median", () => {
  it("durationSec computes whole seconds", () => {
    expect(durationSec("2026-06-16T00:00:00Z", "2026-06-16T00:01:30Z")).toBe(90);
  });
  it("median of odd count", () => {
    expect(median([30, 10, 20])).toBe(20);
  });
  it("median of even count averages the middle two", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });
});

describe("aggregateCiHealth", () => {
  const runs: RawRun[] = [
    { id: 1, workflowName: "CI", conclusion: "success", createdAt: "2026-06-16T00:00:00Z", updatedAt: "2026-06-16T00:02:00Z", headSha: "aaa" },
    { id: 2, workflowName: "CI", conclusion: "failure", createdAt: "2026-06-16T01:00:00Z", updatedAt: "2026-06-16T01:01:00Z", headSha: "bbb" },
  ];
  const jobs: Record<number, RawJob[]> = {
    1: [{ name: "build", startedAt: "2026-06-16T00:00:00Z", completedAt: "2026-06-16T00:01:30Z" }],
    2: [{ name: "build", startedAt: "2026-06-16T01:00:00Z", completedAt: "2026-06-16T01:00:30Z" }],
  };
  it("aggregates per workflow with pass rate, durations, flaky flag", () => {
    const report = aggregateCiHealth(runs, jobs);
    expect(report.workflows).toHaveLength(1);
    const w = report.workflows[0];
    expect(w.workflow).toBe("CI");
    expect(w.runCount).toBe(2);
    expect(w.passCount).toBe(1);
    expect(w.failCount).toBe(1);
    expect(w.passRate).toBe(0.5);
    expect(w.p50DurationSec).toBe(90); // median of [120, 60]
    expect(w.maxDurationSec).toBe(120);
    expect(w.slowestJobs[0]).toEqual({ name: "build", durationSec: 90 });
    expect(w.flaky).toBe(true); // mixed pass+fail in window
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/ci-health.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ci-health.ts`**

```ts
export interface RawRun {
  id: number;
  workflowName: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  headSha: string;
}

export interface RawJob {
  name: string;
  startedAt: string;
  completedAt: string | null;
}

export function durationSec(startISO: string, endISO: string): number {
  return Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000);
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface WorkflowHealth {
  workflow: string;
  runCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  p50DurationSec: number;
  maxDurationSec: number;
  slowestJobs: { name: string; durationSec: number }[];
  flaky: boolean;
}

export interface CiHealthReport {
  workflows: WorkflowHealth[];
}

export function aggregateCiHealth(
  runs: RawRun[],
  jobsByRunId: Record<number, RawJob[]>,
): CiHealthReport {
  const byWorkflow = new Map<string, RawRun[]>();
  for (const run of runs) {
    const list = byWorkflow.get(run.workflowName) ?? [];
    list.push(run);
    byWorkflow.set(run.workflowName, list);
  }

  const workflows: WorkflowHealth[] = [];
  for (const [workflow, wfRuns] of byWorkflow) {
    const durations = wfRuns.map((r) => durationSec(r.createdAt, r.updatedAt));
    const passCount = wfRuns.filter((r) => r.conclusion === "success").length;
    const failCount = wfRuns.filter((r) => r.conclusion === "failure").length;

    const jobDurations = new Map<string, number[]>();
    for (const run of wfRuns) {
      for (const job of jobsByRunId[run.id] ?? []) {
        if (!job.completedAt) continue;
        const list = jobDurations.get(job.name) ?? [];
        list.push(durationSec(job.startedAt, job.completedAt));
        jobDurations.set(job.name, list);
      }
    }
    const slowestJobs = [...jobDurations.entries()]
      .map(([name, ds]) => ({ name, durationSec: median(ds) }))
      .sort((a, b) => b.durationSec - a.durationSec)
      .slice(0, 5);

    workflows.push({
      workflow,
      runCount: wfRuns.length,
      passCount,
      failCount,
      passRate: wfRuns.length ? passCount / wfRuns.length : 0,
      p50DurationSec: median(durations),
      maxDurationSec: durations.length ? Math.max(...durations) : 0,
      slowestJobs,
      flaky: passCount > 0 && failCount > 0,
    });
  }
  return { workflows };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run lib/ci-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ci-health.ts lib/ci-health.test.ts
git commit --no-gpg-sign -m "feat: aggregate CI run health per workflow"
```

---

### Task 5: Memory gist helpers (`lib/memory.ts`)

**Files:**
- Create: `lib/memory.ts`
- Test: `lib/memory.test.ts`

**Interfaces:**
- Produces:
  - `function memoryGistDescription(repo: string): string`
  - `interface GistListItem { id: string; description: string }`
  - `function findMemoryGist(list: GistListItem[], repo: string): string | null`
  - `const MEMORY_FILENAME = "memory.md"`
  - `function initialMemory(repo: string): string`

- [ ] **Step 1: Write the failing tests**

`lib/memory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { memoryGistDescription, findMemoryGist, MEMORY_FILENAME, initialMemory } from "./memory";

describe("memory gist helpers", () => {
  it("description marker is repo-scoped", () => {
    expect(memoryGistDescription("vire/eve-agent")).toBe("eve-pr-digest-memory:vire/eve-agent");
  });
  it("finds the matching gist id", () => {
    const list = [
      { id: "g1", description: "something else" },
      { id: "g2", description: "eve-pr-digest-memory:vire/eve-agent" },
    ];
    expect(findMemoryGist(list, "vire/eve-agent")).toBe("g2");
  });
  it("returns null when absent", () => {
    expect(findMemoryGist([{ id: "g1", description: "x" }], "vire/eve-agent")).toBeNull();
  });
  it("initial memory mentions the repo and filename constant is stable", () => {
    expect(MEMORY_FILENAME).toBe("memory.md");
    expect(initialMemory("vire/eve-agent")).toContain("vire/eve-agent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/memory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/memory.ts`**

```ts
export const MEMORY_FILENAME = "memory.md";

export function memoryGistDescription(repo: string): string {
  return `eve-pr-digest-memory:${repo}`;
}

export interface GistListItem {
  id: string;
  description: string;
}

export function findMemoryGist(list: GistListItem[], repo: string): string | null {
  const marker = memoryGistDescription(repo);
  return list.find((g) => g.description === marker)?.id ?? null;
}

export function initialMemory(repo: string): string {
  return [
    `# PR Digest Memory — ${repo}`,
    "",
    "## CI baselines",
    "_(p50 duration & pass rate per workflow, updated each run)_",
    "",
    "## Open improvement suggestions",
    "",
    "## Notes & recurring patterns",
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run lib/memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/memory.ts lib/memory.test.ts
git commit --no-gpg-sign -m "feat: memory gist locate/init helpers"
```

---

### Task 6: `gh` runner + data-collection tools

**Files:**
- Create: `lib/gh.ts` (shared `gh` invoker + "me" resolver)
- Create: `tools/contributions.ts`, `tools/pull-requests.ts`, `tools/ci-health.ts`
- Test: `lib/gh.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4, plus Spike 3's resolution from Task 1.
- Produces:
  - `async function gh(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }>`
  - `async function ghJson<T>(args: string[]): Promise<{ ok: true; data: T } | { ok: false; reason: string }>`
  - `async function resolveMe(): Promise<string>` (env `GITHUB_LOGIN` or `gh api user --jq .login`)
  - three `defineTool` default exports returning `{ ok: true, ... } | { ok: false, reason }`.

- [ ] **Step 1: Write the failing test for the gh runner's parsing**

`lib/gh.test.ts` (tests the pure JSON-parse seam, not the subprocess):

```ts
import { describe, it, expect } from "vitest";
import { parseJsonOutput } from "./gh";

describe("parseJsonOutput", () => {
  it("parses valid JSON", () => {
    expect(parseJsonOutput<{ a: number }>('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
  });
  it("returns structured error on invalid JSON", () => {
    const r = parseJsonOutput("not json");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/gh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/gh.ts`**

If Spike 3 (Task 1) determined `gh` must run inside a sandbox step, replace the `execFile("gh", ...)` calls here with that sandbox invocation — the function signatures stay identical.

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

export function parseJsonOutput<T>(stdout: string): Result<T> {
  try {
    return { ok: true, data: JSON.parse(stdout) as T };
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${String(e)}` };
  }
}

export async function gh(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 20 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, reason: `gh ${args.join(" ")} failed: ${String(e)}` };
  }
}

export async function ghJson<T>(args: string[]): Promise<Result<T>> {
  const r = await gh(args);
  if (!r.ok) return r;
  return parseJsonOutput<T>(r.stdout);
}

export async function resolveMe(): Promise<string> {
  if (process.env.GITHUB_LOGIN) return process.env.GITHUB_LOGIN;
  const r = await gh(["api", "user", "--jq", ".login"]);
  return r.ok ? r.stdout.trim() : "";
}

export function targetRepo(): string {
  const repo = process.env.TARGET_REPO;
  if (!repo) throw new Error("TARGET_REPO env is required (owner/name)");
  return repo;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/gh.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `tools/contributions.ts`**

Uses the `defineTool` shape confirmed in Task 1. Maps `gh` commit JSON into `RawCommit` and returns the summary.

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, resolveMe, targetRepo } from "../lib/gh";
import { summarizeContributions, DEFAULT_AGENT_MARKERS, type RawCommit } from "../lib/contributions";

interface ApiCommit {
  sha: string;
  commit: { message: string };
  author: { login: string } | null;
  committer: { login: string } | null;
}

export default defineTool({
  description: "Summarize commits in a recent window, classified into me / me+AI / agent / other.",
  inputSchema: z.object({ sinceISO: z.string().describe("ISO timestamp; commits after this") }),
  async execute({ sinceISO }) {
    const repo = targetRepo();
    const me = await resolveMe();
    const res = await ghJson<ApiCommit[]>([
      "api", "--paginate", `repos/${repo}/commits?since=${encodeURIComponent(sinceISO)}`,
    ]);
    if (!res.ok) return res;
    const commits: RawCommit[] = res.data.map((c) => ({
      sha: c.sha,
      authorLogin: c.author?.login ?? null,
      committerLogin: c.committer?.login ?? null,
      message: c.commit.message,
    }));
    return { ok: true as const, me, summary: summarizeContributions(commits, me, DEFAULT_AGENT_MARKERS) };
  },
});
```

- [ ] **Step 6: Implement `tools/pull-requests.ts`**

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepo } from "../lib/gh";
import { groupPullRequests, type RawPR } from "../lib/pull-requests";

interface ApiPR {
  number: number; title: string; author: { login: string };
  reviewDecision: string | null; isDraft: boolean;
  reviews: { id: number }[]; updatedAt: string; url: string;
}

export default defineTool({
  description: "List open PRs for the repo grouped by review state.",
  inputSchema: z.object({}),
  async execute() {
    const repo = targetRepo();
    const res = await ghJson<ApiPR[]>([
      "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
      "--json", "number,title,author,reviewDecision,isDraft,reviews,updatedAt,url",
    ]);
    if (!res.ok) return res;
    const prs: RawPR[] = res.data.map((p) => ({
      number: p.number, title: p.title, authorLogin: p.author.login,
      reviewDecision: p.reviewDecision, isDraft: p.isDraft,
      reviewCount: p.reviews.length, updatedAt: p.updatedAt, url: p.url,
    }));
    return { ok: true as const, groups: groupPullRequests(prs) };
  },
});
```

- [ ] **Step 7: Implement `tools/ci-health.ts`**

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepo } from "../lib/gh";
import { aggregateCiHealth, type RawRun, type RawJob } from "../lib/ci-health";

interface ApiRun { databaseId: number; workflowName: string; conclusion: string | null; createdAt: string; updatedAt: string; headSha: string; }
interface ApiJobsView { jobs: { name: string; startedAt: string; completedAt: string | null }[] }

export default defineTool({
  description: "Aggregate recent CI run health per workflow (pass rate, durations, slowest jobs, flaky).",
  inputSchema: z.object({ limit: z.number().default(30).describe("how many recent runs to inspect") }),
  async execute({ limit }) {
    const repo = targetRepo();
    const runsRes = await ghJson<ApiRun[]>([
      "run", "list", "--repo", repo, "--limit", String(limit),
      "--json", "databaseId,workflowName,conclusion,createdAt,updatedAt,headSha",
    ]);
    if (!runsRes.ok) return runsRes;
    const runs: RawRun[] = runsRes.data.map((r) => ({
      id: r.databaseId, workflowName: r.workflowName, conclusion: r.conclusion,
      createdAt: r.createdAt, updatedAt: r.updatedAt, headSha: r.headSha,
    }));

    const jobsByRunId: Record<number, RawJob[]> = {};
    for (const run of runs) {
      const jv = await ghJson<ApiJobsView>(["run", "view", String(run.id), "--repo", repo, "--json", "jobs"]);
      jobsByRunId[run.id] = jv.ok ? jv.data.jobs : [];
    }
    return { ok: true as const, report: aggregateCiHealth(runs, jobsByRunId) };
  },
});
```

- [ ] **Step 8: Smoke-test the tools against the real repo via `eve dev`**

Set `TARGET_REPO` + `GH_TOKEN` in the local env. Run `eve dev` and ask the agent to call each tool.
Expected: each returns `ok: true` with plausible data, or a clean `{ ok: false, reason }` (never an unhandled throw). Fix mapping mismatches against real `gh --json` output if any field name differs.

- [ ] **Step 9: Commit**

```bash
git add lib/gh.ts lib/gh.test.ts tools/contributions.ts tools/pull-requests.ts tools/ci-health.ts
git commit --no-gpg-sign -m "feat: gh runner + contributions/PR/CI data tools"
```

---

### Task 7: Memory tools (`tools/read-memory.ts`, `tools/write-memory.ts`)

**Files:**
- Create: `tools/read-memory.ts`, `tools/write-memory.ts`

**Interfaces:**
- Consumes: `lib/memory.ts` (Task 5), `lib/gh.ts` (Task 6).
- Produces: two `defineTool` exports — read returns `{ ok, gistId, content }`, write accepts `{ content }` and returns `{ ok, gistId }`.

- [ ] **Step 1: Implement `tools/read-memory.ts`**

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { gh, ghJson, targetRepo } from "../lib/gh";
import { findMemoryGist, initialMemory, memoryGistDescription, MEMORY_FILENAME } from "../lib/memory";

export default defineTool({
  description: "Read the agent's persistent memory (private gist); creates it if missing.",
  inputSchema: z.object({}),
  async execute() {
    const repo = targetRepo();
    const list = await ghJson<{ id: string; description: string }[]>(["gist", "list", "--json", "id,description"]);
    if (!list.ok) return list;
    let gistId = findMemoryGist(list.data, repo);

    if (!gistId) {
      // create via stdin so no temp file is needed
      const created = await gh([
        "gist", "create", "--desc", memoryGistDescription(repo), "--filename", MEMORY_FILENAME, "-",
      ]); // NOTE: gh reads gist body from stdin; if the runner can't pipe stdin, write a temp file instead.
      if (!created.ok) return created;
      const url = created.stdout.trim();
      gistId = url.split("/").pop() ?? null;
      return { ok: true as const, gistId, content: initialMemory(repo), created: true };
    }

    const view = await gh(["gist", "view", gistId, "--filename", MEMORY_FILENAME, "--raw"]);
    if (!view.ok) return view;
    return { ok: true as const, gistId, content: view.stdout, created: false };
  },
});
```

If Task 1 showed the runner can't pipe stdin to `gh gist create`, switch to writing `memory.md` to a temp dir and passing the path. Confirm the exact `gh gist create` output format (URL) and adjust the id parse if needed.

- [ ] **Step 2: Implement `tools/write-memory.ts`**

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { gh } from "../lib/gh";
import { MEMORY_FILENAME } from "../lib/memory";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineTool({
  description: "Overwrite the agent's persistent memory gist with new content.",
  inputSchema: z.object({ gistId: z.string(), content: z.string() }),
  async execute({ gistId, content }) {
    const dir = await mkdtemp(join(tmpdir(), "eve-mem-"));
    const path = join(dir, MEMORY_FILENAME);
    await writeFile(path, content, "utf8");
    const res = await gh(["gist", "edit", gistId, "--filename", MEMORY_FILENAME, path]);
    if (!res.ok) return res;
    return { ok: true as const, gistId };
  },
});
```

- [ ] **Step 3: Smoke-test memory round-trip via `eve dev`**

Ask the agent to read memory (creates the gist), then write updated content, then read again.
Expected: second read returns the written content; one private gist exists with description `eve-pr-digest-memory:<repo>`.

- [ ] **Step 4: Commit**

```bash
git add tools/read-memory.ts tools/write-memory.ts
git commit --no-gpg-sign -m "feat: read/write git-backed memory gist"
```

---

### Task 8: Agent config, model wiring (Spike 1), instructions, and skills

**Files:**
- Modify: `agent.ts`
- Modify: `sandbox/sandbox.ts` (per Spike 3 outcome)
- Create/Modify: `instructions.md`
- Create: `skills/digest-format.md`, `skills/classifying-contributions.md`, `skills/repo-improvement-playbook.md`
- Create: `.env.example`

**Interfaces:**
- Consumes: all tools (Tasks 6–7), Task 1's recorded API.
- Produces: a runnable agent whose daily pass is fully specified by `instructions.md` + skills.

- [ ] **Step 1: Wire the model (Spike 1)**

Edit `agent.ts` using the signature recorded in Task 1. Primary path — OpenRouter:

```ts
import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.OPENROUTER_MODEL ?? "openrouter/openai/codex",
});
```

Confirm whether Eve resolves an `openrouter/...` model string via the AI Gateway, or needs an explicit provider object (`@openrouter/ai-sdk-provider`). Record which works in `docs/superpowers/notes/eve-api.md`. **Fallback** (Spike 1): if neither works, set the model to a codex slug the Vercel AI Gateway serves directly and note that composer is unavailable on this path.

- [ ] **Step 2: Configure the sandbox per Spike 3**

If Task 1 showed `gh` is reachable from tool execution as-is, set the minimal/local sandbox the scaffold provides and ensure `GH_TOKEN` passes through. If `gh` needs a sandbox, ensure the sandbox image has `gh` installed and `GH_TOKEN` in its env. Use the exact `defineSandbox` shape from Task 1.

- [ ] **Step 3: Write `instructions.md`**

```markdown
# Role: Daily PR & CI Digest Agent

You produce one daily digest about the repository in `TARGET_REPO` and post it to Slack.

## Each run, in order
1. Call `read-memory` to load prior baselines and open suggestions. Keep the `gistId`.
2. Call `contributions` with `sinceISO` = 24h before now.
3. Call `pull-requests`.
4. Call `ci-health`.
5. Compose the digest using the `digest-format` skill. Compare CI numbers against the
   "CI baselines" in memory and call out regressions or newly-flaky workflows.
6. Apply the `repo-improvement-playbook` skill to propose at most 3 concrete improvements,
   reconciled against the "Open improvement suggestions" already in memory (don't repeat
   resolved ones; update status of recurring ones).
7. Post the digest to Slack.
8. Call `write-memory` with the same `gistId` and an updated memory doc: refreshed CI
   baselines (p50 + pass rate per workflow) and the current suggestion list.

## Rules
- If a tool returns `{ ok: false }`, include that section as "data unavailable (<reason>)"
  and continue — never abort the whole digest.
- If there was no activity in the window, post a short "quiet day" note.
```

- [ ] **Step 4: Write the three skills**

`skills/digest-format.md`:

```markdown
# Digest format

Post a single Slack message:

*PR & CI Digest — <repo> — <date>*

*Contributions (last 24h)*
- You: <humanMe>, You + AI: <meAiAssist>, Agents/bots: <agent>, Others: <other>

*Open PRs*
- ✅ Approved: <n> · ✋ Changes requested: <n> · 💬 Reviewed: <n> · ⏳ Pending review: <n> · 📝 Draft: <n>
- List pending-review PRs as "#<num> <title> — <url>".

*CI health*
- Per workflow: pass rate, p50 / max duration, slowest job. Flag 🔶 flaky and 🔺 slower-than-baseline.

*Suggestions*
- Up to 3 bullets, each actionable.

Keep it scannable. Omit empty sections except always show a one-line summary.
```

`skills/classifying-contributions.md`:

```markdown
# Classifying contributions

The `contributions` tool already classifies commits:
- **You** — authored by the gh-authenticated user, no AI co-author.
- **You + AI** — your commit with a `Co-authored-by:` AI trailer (Claude, Cursor, Copilot, Devin, anthropic).
- **Agents/bots** — author login ends with `[bot]` (dependabot, github-actions, …).
- **Others** — everyone else.

If you notice a new agent/bot identity in commit data that isn't being caught, record it in
memory under "Notes & recurring patterns" so it can be added to the marker list later.
```

`skills/repo-improvement-playbook.md`:

```markdown
# Repo improvement playbook

When proposing improvements, look for (in priority order):
1. CI: consistently slow or newly-flaky workflows; long-pole jobs worth caching/splitting.
2. Review flow: PRs pending review > 2 days; PRs with changes-requested gone stale.
3. Contribution patterns: large unreviewed agent/bot commit volume; missing co-author trailers.

Rules: max 3 suggestions/run. Each must be specific and reference the evidence (workflow
name, PR number, metric). Reconcile against memory — don't repeat a suggestion already
marked resolved; bump a recurring one instead of duplicating.
```

- [ ] **Step 5: Write `.env.example`**

```bash
TARGET_REPO=owner/name
GH_TOKEN=ghp_xxx              # scopes: repo, gist
GITHUB_LOGIN=                 # optional; defaults to `gh api user`
OPENROUTER_API_KEY=sk-or-xxx
OPENROUTER_MODEL=openrouter/openai/codex
# Slack: filled in Task 9 per the chosen auth path
```

- [ ] **Step 6: Run the full pass via `eve dev`**

Trigger the daily pass once interactively. Expected: agent calls all tools in order, composes a digest, and (with Slack not yet wired) prints the digest it would post.

- [ ] **Step 7: Commit**

```bash
git add agent.ts sandbox/ instructions.md skills/ .env.example docs/superpowers/notes/eve-api.md
git commit --no-gpg-sign -m "feat: agent config, model wiring, instructions, and skills"
```

---

### Task 9: Slack delivery (Spike 4) and external scheduling (Spike 2)

**Files:**
- Create: `channels/slack.ts` (or `tools/post-to-slack.ts`, per Spike 4)
- Create: `scripts/run-digest.sh`
- Create: `docs/superpowers/notes/cron-setup.md`

**Interfaces:**
- Consumes: the runnable agent (Task 8).
- Produces: a working Slack post on each run; a documented crontab line.

- [ ] **Step 1: Resolve Slack auth (Spike 4) and wire delivery**

Try Eve's `slackChannel` from Task 1 first:

```ts
import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  credentials: connectSlackCredentials("slack/pr-digest"),
});
```

If Vercel Connect can't be used off-platform (self-hosted), implement `tools/post-to-slack.ts` with a bot token instead, and have `instructions.md` step 7 call it:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Post a message to the configured Slack channel.",
  inputSchema: z.object({ text: z.string() }),
  async execute({ text }) {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: process.env.SLACK_CHANNEL_ID, text }),
    });
    const body = await res.json();
    return body.ok ? { ok: true as const, ts: body.ts } : { ok: false as const, reason: body.error };
  },
});
```

Record the chosen path in the notes file; add `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` to `.env.example` if the token path is used.

- [ ] **Step 2: Verify a real Slack post via `eve dev`**

Trigger the pass; confirm the digest lands in the Slack channel.

- [ ] **Step 3: Resolve the external trigger (Spike 2) and write the run script**

Determine from Task 1 how to trigger one run headlessly (a one-shot `eve` CLI command, or an HTTP POST to the agent's API endpoint). Capture it in `scripts/run-digest.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
# Replace with the trigger confirmed in Task 1, e.g. a one-shot CLI run or:
# curl -fsS -X POST "$EVE_AGENT_URL/run" -H 'content-type: application/json' \
#   -d '{"message":"run the daily digest"}'
exec eve run "run the daily digest"   # <- adjust to the confirmed Eve trigger surface
```

Make it executable: `chmod +x scripts/run-digest.sh`.

- [ ] **Step 4: Document the crontab entry**

`docs/superpowers/notes/cron-setup.md`:

```markdown
# Daily schedule (self-hosted)

Add to the user's crontab (`crontab -e`). 07:00 local daily:

    0 7 * * * /absolute/path/to/eve-agent/scripts/run-digest.sh >> /absolute/path/to/eve-agent/digest.log 2>&1

Notes:
- The process must have `gh` authed (GH_TOKEN) and the .env present.
- Verify the timezone of the cron daemon; adjust the hour if it runs in UTC.
```

- [ ] **Step 5: End-to-end dry run**

Run `./scripts/run-digest.sh` manually.
Expected: one digest posted to Slack; memory gist updated; exit 0.

- [ ] **Step 6: Commit**

```bash
git add channels/ tools/ scripts/run-digest.sh docs/superpowers/notes/cron-setup.md .env.example
git commit --no-gpg-sign -m "feat: Slack delivery + external cron trigger"
```

---

### Task 10: End-to-end eval and README

**Files:**
- Create: `evals/digest.eval.ts` (per the `eve eval` format confirmed in Task 1)
- Create: `README.md`

**Interfaces:**
- Consumes: the whole agent.
- Produces: a repeatable eval over fixture data; setup docs.

- [ ] **Step 1: Write an eval over fixture data**

Using the `eve eval` authoring format recorded in Task 1, write `evals/digest.eval.ts` that feeds fixture tool outputs (no live GitHub) and asserts the composed digest: contains the four contribution buckets, the five PR states, at least one CI workflow line, and ≤3 suggestions. If `eve eval` can't stub tools, assert instead on the pure summaries from `lib/` (already covered) and keep this eval as a smoke check that the agent runs to completion.

- [ ] **Step 2: Run the eval**

Run: `eve eval`
Expected: PASS / the digest meets the assertions.

- [ ] **Step 3: Write `README.md`**

Document: what the agent does, required env (`.env.example`), PAT scopes (`repo`+`gist`), how to run (`eve dev`, `scripts/run-digest.sh`), and how to schedule (link `cron-setup.md`). Note the Vercel-deploy + Eve-native-cron alternative as future option.

- [ ] **Step 4: Full test sweep**

Run: `pnpm test`
Expected: all `lib/**` unit suites PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/ README.md
git commit --no-gpg-sign -m "test: end-to-end digest eval + README"
```

---

## Self-Review

**Spec coverage:**
- Code contributions (me + agentic) → Tasks 2, 6. ✓
- PR reviewed/approved/pending → Tasks 3, 6. ✓
- CI performance (actions, durations) → Tasks 4, 6. ✓
- Analyze repo + suggest improvements → Task 8 (playbook skill + instructions). ✓
- Builds own memory → Tasks 5, 7, 8 (read/write gist + reconcile in instructions). ✓
- Schedule/cron trigger → Task 9 (Spike 2 + run script + crontab). ✓
- Slack delivery → Task 9 (Spike 4). ✓
- Model codex via OpenRouter → Task 8 (Spike 1 + fallback). ✓
- Single repo, gh, self-hosted, no Vercel/Eve-cron → Global Constraints + Tasks 6, 9. ✓
- Four spikes with fallbacks → Tasks 1 (Spike 3), 8 (Spike 1), 9 (Spikes 2 & 4). ✓

**Placeholder scan:** Eve-API-dependent steps carry concrete doc-current code plus an explicit "confirm in Task 1 / fallback" — decisions with fallbacks, not TBDs. Pure-logic tasks have full code and tests.

**Type consistency:** `RawCommit`, `RawPR`, `RawRun`/`RawJob`, `AgentMarkers`, `Result<T>`, `memoryGistDescription`/`findMemoryGist`/`MEMORY_FILENAME`/`initialMemory` are defined once (Tasks 2–6) and imported unchanged by the tools (Tasks 6–7). Tool return contract `{ ok: true, ... } | { ok: false, reason }` is uniform.
