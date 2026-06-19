import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepos } from "../lib/gh.ts";
import { groupPullRequests, summarizeAttention, type RawPR } from "../lib/pull-requests.ts";

interface ApiPR {
  number: number;
  title: string;
  author: { login: string } | null;
  reviewDecision: string | null;
  isDraft: boolean;
  reviews: { id: string }[];
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: { oid: string }[];
}

export default defineTool({
  description:
    "List open PRs per repo, grouped by review state, plus an `attention` summary flagging stale PRs (idle 3d+ / critical 7d+) and big PRs (>=1000 changed lines or >20 commits). Covers every configured repo; results are returned in the `repos` array.",
  inputSchema: z.object({}),
  async execute() {
    const repos = targetRepos();
    if (repos.length === 0)
      return { ok: false as const, reason: "TARGET_REPO env is required (comma-delimited owner/name list)" };
    // Stale-PR ages are measured against a single "now" captured per run.
    const now = new Date();
    // Fan out across repos in parallel; a failure for one repo is isolated to its entry.
    const results = await Promise.all(
      repos.map(async (repo) => {
        const res = await ghJson<ApiPR[]>([
          "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
          "--json", "number,title,author,reviewDecision,isDraft,reviews,updatedAt,url,additions,deletions,changedFiles,commits",
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
          additions: p.additions ?? 0,
          deletions: p.deletions ?? 0,
          commits: p.commits?.length ?? 0,
          changedFiles: p.changedFiles ?? 0,
        }));
        return {
          repo,
          ok: true as const,
          groups: groupPullRequests(prs),
          attention: summarizeAttention(prs, now),
        };
      }),
    );
    return { ok: true as const, repos: results };
  },
});
