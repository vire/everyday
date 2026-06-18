import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, resolveMe, targetRepo } from "../lib/gh.ts";
import { summarizeContributions, DEFAULT_AGENT_MARKERS, type RawCommit } from "../lib/contributions.ts";

interface ApiCommit {
  sha: string;
  commit: { message: string };
  author: { login: string } | null;
  committer: { login: string } | null;
}

export default defineTool({
  description: "Summarize commits in a recent window, classified into me / me+AI / agent / other.",
  inputSchema: z.object({ sinceISO: z.string().describe("ISO timestamp; commits after this") }),
  async execute({ sinceISO }) {
    const repo = targetRepo();
    if (!repo) return { ok: false as const, reason: "TARGET_REPO env is required (owner/name)" };
    const meRes = await resolveMe();
    if (!meRes.ok) return meRes;
    const me = meRes.data;
    const res = await ghJson<ApiCommit[]>([
      "api", "--paginate", `repos/${repo}/commits?since=${encodeURIComponent(sinceISO)}`,
    ]);
    if (!res.ok) return res;
    const commits: RawCommit[] = res.data.map((c) => ({
      sha: c.sha,
      authorLogin: c.author?.login ?? null,
      committerLogin: c.committer?.login ?? null,
      message: c.commit.message,
    }));
    return { ok: true as const, me, summary: summarizeContributions(commits, me, DEFAULT_AGENT_MARKERS) };
  },
});
