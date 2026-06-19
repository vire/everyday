# Digest format

Post a **single** Slack message covering all configured repositories. It has a roll-up header, then one section per repo (iterate over the `repos` array each data tool returns, matching entries across tools by their `repo` field).

**Notation:** the templates below use `<slot>` to mark a value to substitute. Replace each slot with its value and emit **plain text** — never output the angle brackets, and never wrap a value in backticks. Slack renders this message as `mrkdwn`: use `*bold*` for the header and section labels, `<url|label>` for links, and a single triple-backtick code block **only** for the CI table. Do not use inline `` `code` `` anywhere in the posted message — it renders as a heavy code pill and reads as noise. (Backticks in *this* doc that wrap field names like `summary.humanMe` are for you, not for the output.)

`<me>` below is the GitHub login returned once at the top level of the `contributions` result (e.g. `octocat`). Use the handle as the author label so the digest reads neutrally in a shared channel — never write "You".

---

*PR & CI Digest — <YYYY-MM-DD>*
<one-line roll-up across all repos — plain text, e.g. "3 repos · 5 commits by octocat · 8 open PRs · 2 stale (1 critical) · 1 big · 1 CI regression">

Then, **for each repo**:

*<repo>*
*Contributions (last 24h)*
- <me>: <summary.humanMe> · <me> + AI: <summary.meAiAssist> · Agents/bots: <summary.agent> · Others: <summary.other>

*Open PRs*
- ✅ Approved: <n> · ✋ Changes requested: <n> · 💬 Reviewed: <n> · ⏳ Pending review: <n> · 📝 Draft: <n>
- List each pending-review PR as: <url|#num> <title>

*⚠️ Needs attention* — render this block **only if** the repo's `attention` has any stale, critical, or big PRs. Drive it entirely from the precomputed `attention` object (`critical`, `stale`, `big`); never recompute ages or sizes yourself. Order: critical first, then stale, then big. Each PR carries `idleDays`, `state`, `isDraft`, and (for big) `bigReasons`.

Use plain bullets — **no colored status dots** (🔴/🟡/🟠); a column of dots reads as alarm fatigue. The single ⚠️ in the section header is the only warning marker. Severity is conveyed by ordering (most-idle first) and the `idle <idleDays>d` text, not by an icon. One bullet per PR, link as `<url|#num>` (not inline code):
- <url|#num> <title> — idle <idleDays>d, <state> — *<action>*   (stale and critical PRs, critical listed first)
- 📦 <url|#num> <title> — <bigReasons joined with " · "> — *suggest splitting into smaller PRs*   (big PRs; the 📦 distinguishes a size flag from staleness)

Pick `<action>` for stale/critical PRs from the PR's `state` (and `isDraft`):
| state | proposed action |
|---|---|
| `pending_review` / `reviewed` | ping a reviewer to take it |
| `changes_requested` | ping @<authorLogin> to address feedback, or close if abandoned |
| `approved` | merge it or close — it's approved and idle |
| `draft` (`isDraft: true`) | ping @<authorLogin> to revive, or close the draft |

If a PR is both stale **and** big, list it once under its staleness bullet and fold the split suggestion into the action (e.g. "ping a reviewer; also large — suggest splitting").

*CI health* — render as a fixed-width table inside a triple-backtick code block so columns align in Slack. One row per workflow from the repo's `ci-health` report. Show durations in seconds (the data is `p50DurationSec` / `maxDurationSec`). The `Flags` column carries: 🔶 flaky (pass rate < 90% over the window), 🔺 p50 more than 20% slower than that repo's stored baseline. Keep `Flags` before the (variable-width) slowest-job column so the metric columns stay aligned.

```
Workflow              Pass   p50    Max    Flags   Slowest job (max dur)
pr                     50%   413s   720s   🔶      Tests python (Docker) 689s
pr-review             100%   656s   794s           review 790s
main                  100%   809s   809s           Tests python (Docker) 558s
```

- Keep the fixed columns aligned (pad with spaces). It's fine to abbreviate a long workflow or job name to keep the table readable.
- If a repo has no completed runs in the window, write "CI: no runs in window" instead of an empty table.

*Suggestions*
- Up to 3 actionable bullets for this repo (per the `repo-improvement-playbook` skill).
- Every suggestion must be a concrete next action **with a clickable link** to the evidence: a PR as `<url|#num>`. For CI items, name the workflow in plain text (no inline code) and link a relevant run/PR when one applies. No bare observations, no link-less bullets.

---

**Resolving the per-repo data**
- Each data tool returns `{ repos: [{ repo, ok, ... }] }`. Match the `contributions`, `pull-requests`, and `ci-health` entries for the same repo by their `repo` string.
- `<repo>` is that entry's `repo` field (e.g. `octocat/hello-world`). Use the exact value; never emit the literal `<owner/repo>` or `<repo>`.
- The `contributions` entry's counts live under its nested `summary` object (`summary.humanMe`, etc.). The top-level `me` (returned once, alongside `repos`) is the GitHub login **string** — render it verbatim as the `<me>` author label; it is NOT a count and must never be rendered as a number.
- The `pull-requests` entry carries both `groups` (review-state buckets) and `attention` (precomputed `stale` / `critical` / `big` PR lists with `idleDays`, `bigReasons`, `state`). Use `attention` verbatim for the Needs-attention block and the roll-up's stale/big metrics — it already encodes the thresholds (stale ≥ 3d, critical ≥ 7d, big ≥ 1000 changed lines or > 20 commits).

**Formatting rules**
- Keep it scannable. Use bold and emoji sparingly — only where they carry signal. Plain text by default; backticks only for the CI table fence; links via `<url|label>`.
- Omit empty subsections within a repo (e.g. no "Open PRs" block if there are none; no "Needs attention" block if `attention` is all empty). If a repo had no activity at all, collapse it to a single line: *<repo>* — quiet day.
- Always show the one-line roll-up at the very top, regardless of how much data is available. Include the stale and big PR counts (summed across repos from each `attention`) in the roll-up so the metric is visible even when nothing else is.
- If a repo's `ci-health` entry has `failedJobFetches` > 0, append a per-repo footnote: "Note: <n> CI job fetch(es) failed — job-level data may be incomplete."
- If a repo entry is `{ ok: false }` for a tool (or its `memories` entry is missing/failed), show "data unavailable — <reason>" in place of that block and continue.
- If a slug can't be resolved for a repo at all (no `repo` returned anywhere), write "unknown repo" for that section instead of a placeholder.
