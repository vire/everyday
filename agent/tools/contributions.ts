import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, resolveMe, targetRepos } from "../lib/gh.ts";
import { summarizeContributions, DEFAULT_AGENT_MARKERS, type RawCommit } from "../lib/contributions.ts";

interface ApiCommit {
  sha: string;
  commit: { message: string };
  author: { login: string } | null;
  committer: { login: string } | null;
}

export default defineTool({
  description: "Summarize commits in a recent window per repo, classified into me / me+AI / agent / other. Covers every configured repo; results are returned in the `repos` array.",
  inputSchema: z.object({ sinceISO: z.string().describe("ISO timestamp; commits after this") }),
  async execute({ sinceISO }) {
    const repos = targetRepos();
    if (repos.length === 0)
      return { ok: false as const, reason: "TARGET_REPO env is required (comma-delimited owner/name list)" };
    const meRes = await resolveMe();
    if (!meRes.ok) return meRes;
    const me = meRes.data;
    // Fan out across repos in parallel; a failure for one repo is isolated to its entry.
    const results = await Promise.all(
      repos.map(async (repo) => {
        const res = await ghJson<ApiCommit[]>([
          "api", "--paginate", `repos/${repo}/commits?since=${encodeURIComponent(sinceISO)}`,
        ]);
        if (!res.ok) return { repo, ok: false as const, reason: res.reason };
        const commits: RawCommit[] = res.data.map((c) => ({
          sha: c.sha,
          authorLogin: c.author?.login ?? null,
          committerLogin: c.committer?.login ?? null,
          message: c.commit.message,
        }));
        return { repo, ok: true as const, summary: summarizeContributions(commits, me, DEFAULT_AGENT_MARKERS) };
      }),
    );
    return { ok: true as const, me, repos: results };
  },
});
