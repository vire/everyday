import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepo } from "../../lib/gh";
import { groupPullRequests, type RawPR } from "../../lib/pull-requests";

interface ApiPR {
  number: number;
  title: string;
  author: { login: string };
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
    const res = await ghJson<ApiPR[]>([
      "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
      "--json", "number,title,author,reviewDecision,isDraft,reviews,updatedAt,url",
    ]);
    if (!res.ok) return res;
    const prs: RawPR[] = res.data.map((p) => ({
      number: p.number,
      title: p.title,
      authorLogin: p.author.login,
      reviewDecision: p.reviewDecision,
      isDraft: p.isDraft,
      reviewCount: p.reviews.length,
      updatedAt: p.updatedAt,
      url: p.url,
    }));
    return { ok: true as const, groups: groupPullRequests(prs) };
  },
});
