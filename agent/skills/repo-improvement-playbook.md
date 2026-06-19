# Repo improvement playbook

When proposing improvements, scan the data in priority order:

1. **Stale & big PRs (`pull-requests.attention`)** — this is precomputed; prefer it over eyeballing dates or diff sizes:
   - **Critical** PRs (`attention.critical`, idle ≥ 7d) are the highest-priority suggestions — they're blocking and forgotten. Propose the state-appropriate action: ping a reviewer, ping `@author`, merge, or close.
   - **Stale** PRs (`attention.stale`, idle ≥ 3d) come next.
   - **Big** PRs (`attention.big`, ≥ 1000 changed lines or > 20 commits) — suggest splitting into smaller, reviewable PRs; cite the `bigReasons`.
   - A single PR that is both stale and big is the strongest signal of all.

2. **CI health** — Look for:
   - Consistently slow workflows (p50 > 10 min, or > 20% slower than the stored baseline).
   - Newly flaky workflows (pass rate dropped since last run, or below 90% this window).
   - Long-pole jobs within a workflow that are good candidates for caching or parallelisation.

3. **Contribution patterns** — Look for:
   - High bot/agent commit volume without corresponding human review (bots may be drifting unnoticed).
   - Commits that appear AI-assisted but are missing a `Co-authored-by:` trailer.
   - Contributors who have been waiting a long time for PR merges.

## Rules

- Propose **at most 3 suggestions** per run.
- Each suggestion must be **specific**: reference the workflow name, PR number, author, or metric that triggered it.
- Each suggestion must carry a **clickable link** to its evidence: a PR as a Slack link `<url|#num>`, or a workflow named in plain text for CI items (with a run/PR link where one applies). A suggestion the reader can't click through to act on is not actionable.
- Emit suggestions as **plain text + links**, with no inline `` `code` `` formatting (it renders as a noisy code pill in Slack). Name workflows, jobs, and files in plain text.
- **Reconcile with memory before proposing**: if a suggestion appears in the "Open improvement suggestions" list as resolved or recently acted on, do not repeat it. If it is recurring (same issue for 2+ runs), say "recurring" and reference the prior run date.
- Phrase suggestions as concrete next actions, not observations:
  - Bad: "CI is slow." Good: "Cache the node_modules restore step in the pr workflow — p50 is 14 min, up from 9 min baseline."
  - Bad: "#319 is old." Good: "Ping a reviewer on <https://github.com/acme/widgets/pull/319|#319> — idle 9d in pending review."
  - Bad: "#340 is large." Good: "Ask the author to split <https://github.com/acme/widgets/pull/340|#340> (1,240 changed lines) into smaller PRs."
