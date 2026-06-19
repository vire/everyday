import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepos } from "../lib/gh.ts";
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
  description: "List open PRs grouped by review state, per repo. Covers every configured repo; results are returned in the `repos` array.",
  inputSchema: z.object({}),
  async execute() {
    const repos = targetRepos();
    if (repos.length === 0)
      return { ok: false as const, reason: "TARGET_REPO env is required (comma-delimited owner/name list)" };
    // Fan out across repos in parallel; a failure for one repo is isolated to its entry.
    const results = await Promise.all(
      repos.map(async (repo) => {
        const res = await ghJson<ApiPR[]>([
          "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
          "--json", "number,title,author,reviewDecision,isDraft,reviews,updatedAt,url",
        ]);
        if (!res.ok) return { repo, ok: false as const, reason: res.reason };
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
        return { repo, ok: true as const, groups: groupPullRequests(prs) };
      }),
    );
    return { ok: true as const, repos: results };
  },
});
