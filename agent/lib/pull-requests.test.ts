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
