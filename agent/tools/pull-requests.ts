import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepo } from "../lib/gh.ts";
import { groupPullRequests, type RawPR } from "../lib/pull-requests.ts";

interface ApiPR {
  number: number;
  title: string;
  author: { login: string } | null;
  reviewDecision: string | null;
  isDraft: boolean;
  reviews: { id: string }[];
  updatedAt: string;
  url: string;
}

export default defineTool({
  description: "List open PRs for the repo grouped by review state.",
  inputSchema: z.object({}),
  async execute() {
    const repo = targetRepo();
    if (!repo) return { ok: false as const, reason: "TARGET_REPO env is required (owner/name)" };
    const res = await ghJson<ApiPR[]>([
      "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
      "--json", "number,title,author,reviewDecision,isDraft,reviews,updatedAt,url",
    ]);
    if (!res.ok) return res;
    const prs: RawPR[] = res.data.map((p) => ({
      number: p.number,
      title: p.title,
      authorLogin: p.author?.login ?? "ghost",
      reviewDecision: p.reviewDecision,
      isDraft: p.isDraft,
      reviewCount: p.reviews.length,
      updatedAt: p.updatedAt,
      url: p.url,
    }));
    return { ok: true as const, repo, groups: groupPullRequests(prs) };
  },
});
