import { describe, it, expect } from "vitest";
import {
  classifyPR,
  groupPullRequests,
  idleDays,
  stalenessOf,
  bigReasons,
  isBig,
  summarizeAttention,
  STALE_DAYS,
  CRITICAL_DAYS,
  type RawPR,
} from "./pull-requests";

function pr(p: Partial<RawPR>): RawPR {
  return {
    number: 1,
    title: "t",
    authorLogin: "vire",
    reviewDecision: null,
    isDraft: false,
    reviewCount: 0,
    updatedAt: "2026-06-16T00:00:00Z",
    url: "u",
    additions: 0,
    deletions: 0,
    commits: 1,
    changedFiles: 1,
    ...p,
  };
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

const NOW = new Date("2026-06-19T00:00:00Z");

describe("idleDays", () => {
  it("floors whole days since updatedAt", () => {
    expect(idleDays(pr({ updatedAt: "2026-06-15T00:00:00Z" }), NOW)).toBe(4);
  });
  it("never returns negative for a freshly-updated PR", () => {
    expect(idleDays(pr({ updatedAt: "2026-06-20T00:00:00Z" }), NOW)).toBe(0);
  });
});

describe("stalenessOf", () => {
  it("fresh below the stale threshold", () => {
    expect(stalenessOf(pr({ updatedAt: "2026-06-18T00:00:00Z" }), NOW)).toBe("fresh"); // 1d
  });
  it("stale at exactly STALE_DAYS, below CRITICAL_DAYS", () => {
    const at = new Date(NOW.getTime() - STALE_DAYS * 86_400_000).toISOString();
    expect(stalenessOf(pr({ updatedAt: at }), NOW)).toBe("stale");
  });
  it("critical at CRITICAL_DAYS and beyond", () => {
    const at = new Date(NOW.getTime() - CRITICAL_DAYS * 86_400_000).toISOString();
    expect(stalenessOf(pr({ updatedAt: at }), NOW)).toBe("critical");
  });
});

describe("bigReasons / isBig", () => {
  it("flags large diffs by changed lines", () => {
    expect(bigReasons(pr({ additions: 600, deletions: 600 }))).toEqual(["1200 changed lines"]);
  });
  it("flags high commit count above the threshold", () => {
    expect(bigReasons(pr({ commits: 25 }))).toEqual(["25 commits"]);
  });
  it("combines both reasons when both trip", () => {
    expect(bigReasons(pr({ additions: 1500, deletions: 0, commits: 30 }))).toEqual([
      "1500 changed lines",
      "30 commits",
    ]);
  });
  it("is not big at exactly 20 commits and under 1000 lines", () => {
    expect(isBig(pr({ additions: 999, deletions: 0, commits: 20 }))).toBe(false);
  });
});

describe("summarizeAttention", () => {
  it("partitions stale/critical/big and counts for the roll-up, most-idle first", () => {
    const prs = [
      pr({ number: 1, updatedAt: "2026-06-18T00:00:00Z" }), // 1d → fresh
      pr({ number: 2, updatedAt: "2026-06-15T00:00:00Z" }), // 4d → stale
      pr({ number: 3, updatedAt: "2026-06-09T00:00:00Z" }), // 10d → critical
      pr({ number: 4, updatedAt: "2026-06-01T00:00:00Z" }), // 18d → critical
      pr({ number: 5, updatedAt: "2026-06-18T00:00:00Z", additions: 1200, deletions: 0 }), // fresh but big
    ];
    const a = summarizeAttention(prs, NOW);
    expect(a.stale.map((p) => p.number)).toEqual([2]);
    expect(a.critical.map((p) => p.number)).toEqual([4, 3]); // most idle first
    expect(a.big.map((p) => p.number)).toEqual([5]);
    expect(a.staleCount).toBe(3); // stale + critical
    expect(a.criticalCount).toBe(2);
    expect(a.bigCount).toBe(1);
  });
});
