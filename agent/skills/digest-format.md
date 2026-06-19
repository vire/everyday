# Digest format

Post a **single** Slack message covering all configured repositories. It has a roll-up header, then one section per repo (iterate over the `repos` array each data tool returns, matching entries across tools by their `repo` field).

---

*PR & CI Digest — `<YYYY-MM-DD>`*
`<one-line roll-up across all repos — e.g. "3 repos · 5 commits by you · 8 open PRs · 1 CI regression">`

Then, **for each repo**:

*`<repo>`*
*Contributions (last 24h)*
- You: `<summary.humanMe>` · You + AI: `<summary.meAiAssist>` · Agents/bots: `<summary.agent>` · Others: `<summary.other>`

*Open PRs*
- ✅ Approved: `<n>` · ✋ Changes requested: `<n>` · 💬 Reviewed: `<n>` · ⏳ Pending review: `<n>` · 📝 Draft: `<n>`
- List each pending-review PR as: `#<num> <title> — <url>`

*CI health*
- For each workflow: pass rate, p50 / max duration, slowest job name.
- Flag 🔶 next to any workflow that is flaky (pass rate < 90% over the window).
- Flag 🔺 next to any workflow whose p50 duration is more than 20% slower than that repo's stored baseline.

*Suggestions*
- Up to 3 actionable bullets for this repo, each referencing specific evidence (workflow name, PR number, or metric).

---

**Resolving the per-repo data**
- Each data tool returns `{ repos: [{ repo, ok, ... }] }`. Match the `contributions`, `pull-requests`, and `ci-health` entries for the same repo by their `repo` string.
- `<repo>` is that entry's `repo` field (e.g. `octocat/hello-world`). Use the exact value; never emit the literal `<owner/repo>` or `<repo>`.
- The `contributions` entry's counts live under its nested `summary` object (`summary.humanMe`, etc.). The top-level `me` (returned once, alongside `repos`) is your GitHub login **string** (e.g. `"octocat"`) — it is NOT a count and must never be rendered as a number.

**Formatting rules**
- Keep it scannable. Use bold and emoji sparingly — only where they carry signal.
- Omit empty subsections within a repo (e.g. no "Open PRs" block if there are none). If a repo had no activity at all, collapse it to a single line: `*`<repo>`* — quiet day`.
- Always show the one-line roll-up at the very top, regardless of how much data is available.
- If a repo's `ci-health` entry has `failedJobFetches` > 0, append a per-repo footnote: "_Note: `<n>` CI job fetch(es) failed — job-level data may be incomplete._"
- If a repo entry is `{ ok: false }` for a tool (or its `memories` entry is missing/failed), show "data unavailable — `<reason>`" in place of that block and continue.
- If a slug can't be resolved for a repo at all (no `repo` returned anywhere), write `unknown repo` for that section instead of a placeholder.
