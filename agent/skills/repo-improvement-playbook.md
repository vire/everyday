# Repo improvement playbook

When proposing improvements, scan the data in priority order:

1. **CI health** — Look for:
   - Consistently slow workflows (p50 > 10 min, or > 20% slower than the stored baseline).
   - Newly flaky workflows (pass rate dropped since last run, or below 90% this window).
   - Long-pole jobs within a workflow that are good candidates for caching or parallelisation.

2. **Review flow** — Look for:
   - PRs in `pendingReview` that have been open for more than 2 days without a review.
   - PRs in `changesRequested` that appear stale (no new commits in the last 48h).
   - PRs with a large diff size that may be blocking other work.

3. **Contribution patterns** — Look for:
   - High bot/agent commit volume without corresponding human review (bots may be drifting unnoticed).
   - Commits that appear AI-assisted but are missing a `Co-authored-by:` trailer.
   - Contributors who have been waiting a long time for PR merges.

## Rules

- Propose **at most 3 suggestions** per run.
- Each suggestion must be **specific**: reference the workflow name, PR number, author, or metric that triggered it.
- **Reconcile with memory before proposing**: if a suggestion appears in the "Open improvement suggestions" list as resolved or recently acted on, do not repeat it. If it is recurring (same issue for 2+ runs), say "recurring" and reference the prior run date.
- Phrase suggestions as concrete next actions, not observations. Bad: "CI is slow." Good: "Cache the `node_modules` restore step in `ci.yml` — p50 is 14 min, up from 9 min baseline."
