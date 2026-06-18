# Digest format

Post a single Slack message with this structure:

---

*PR & CI Digest — `<owner/repo>` — `<YYYY-MM-DD>`*

*Contributions (last 24h)*
- You: `<me>` · You + AI: `<meAiAssist>` · Agents/bots: `<agent>` · Others: `<other>`

*Open PRs*
- ✅ Approved: `<n>` · ✋ Changes requested: `<n>` · 💬 Reviewed: `<n>` · ⏳ Pending review: `<n>` · 📝 Draft: `<n>`
- List each pending-review PR as: `#<num> <title> — <url>`

*CI health*
- For each workflow: pass rate, p50 / max duration, slowest job name.
- Flag 🔶 next to any workflow that is flaky (pass rate < 90% over the window).
- Flag 🔺 next to any workflow whose p50 duration is more than 20% slower than the stored baseline.

*Suggestions*
- Up to 3 actionable bullets, each referencing specific evidence (workflow name, PR number, or metric).

---

**Formatting rules**
- Keep it scannable. Use bold and emoji sparingly — only where they carry signal.
- Omit empty subsections (e.g. no "Open PRs" block if there are none), except always show the one-line summary at the top.
- If `failedJobFetches` > 0, append a footnote: "_Note: `<n>` CI job fetch(es) failed — job-level data may be incomplete._"
- If the `contributions` tool returned `{ ok: false }`, show "data unavailable — `<reason>`" in place of the contributions block.
- Same pattern for `pull-requests` and `ci-health` failures.
