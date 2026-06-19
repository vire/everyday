export interface RawPR {
  number: number;
  title: string;
  authorLogin: string;
  reviewDecision: string | null;
  isDraft: boolean;
  reviewCount: number;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  commits: number;
  changedFiles: number;
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

// --- "Needs attention" detection -------------------------------------------
// These are deterministic so the agent never has to do date or size math (LLMs
// are unreliable at both). The tool computes them server-side and hands the
// digest precomputed flags; the digest-format skill only renders them.

/** A PR idle for this many days is flagged 🟡 stale. */
export const STALE_DAYS = 3;
/** A PR idle for this many days is flagged 🔴 critical. */
export const CRITICAL_DAYS = 7;
/** A PR with at least this many changed lines (additions + deletions) is "big". */
export const BIG_PR_LINES = 1000;
/** A PR with more than this many commits is "big". */
export const BIG_PR_COMMITS = 20;

export type Staleness = "fresh" | "stale" | "critical";

/** Whole days since the PR was last updated, measured against `now`, floored at 0. */
export function idleDays(pr: RawPR, now: Date): number {
  const ms = now.getTime() - new Date(pr.updatedAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function stalenessOf(pr: RawPR, now: Date): Staleness {
  const days = idleDays(pr, now);
  if (days >= CRITICAL_DAYS) return "critical";
  if (days >= STALE_DAYS) return "stale";
  return "fresh";
}

/** Human-readable reasons a PR counts as "big" (empty array if it isn't). */
export function bigReasons(pr: RawPR): string[] {
  const reasons: string[] = [];
  const lines = pr.additions + pr.deletions;
  if (lines >= BIG_PR_LINES) reasons.push(`${lines} changed lines`);
  if (pr.commits > BIG_PR_COMMITS) reasons.push(`${pr.commits} commits`);
  return reasons;
}

export function isBig(pr: RawPR): boolean {
  return bigReasons(pr).length > 0;
}

/** A PR enriched with the precomputed flags the digest renders. */
export interface FlaggedPR {
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  isDraft: boolean;
  state: PRState;
  idleDays: number;
  staleness: Staleness;
  big: boolean;
  bigReasons: string[];
}

export function flagPR(pr: RawPR, now: Date): FlaggedPR {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    authorLogin: pr.authorLogin,
    isDraft: pr.isDraft,
    state: classifyPR(pr),
    idleDays: idleDays(pr, now),
    staleness: stalenessOf(pr, now),
    big: isBig(pr),
    bigReasons: bigReasons(pr),
  };
}

/**
 * Cross-cutting "needs attention" view over all open PRs: which are stale (idle
 * past the threshold) and which are big enough to suggest splitting. Lists are
 * sorted most-idle-first so the digest can render them directly. `staleCount`
 * (stale + critical) and `bigCount` feed the roll-up metric.
 */
export interface AttentionSummary {
  stale: FlaggedPR[];
  critical: FlaggedPR[];
  big: FlaggedPR[];
  staleCount: number;
  criticalCount: number;
  bigCount: number;
}

export function summarizeAttention(prs: RawPR[], now: Date): AttentionSummary {
  const flagged = prs.map((p) => flagPR(p, now));
  const byIdleDesc = (a: FlaggedPR, b: FlaggedPR) => b.idleDays - a.idleDays;
  const critical = flagged.filter((p) => p.staleness === "critical").sort(byIdleDesc);
  const stale = flagged.filter((p) => p.staleness === "stale").sort(byIdleDesc);
  const big = flagged.filter((p) => p.big).sort(byIdleDesc);
  return {
    stale,
    critical,
    big,
    staleCount: stale.length + critical.length,
    criticalCount: critical.length,
    bigCount: big.length,
  };
}
