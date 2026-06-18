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
