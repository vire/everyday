import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepos } from "../lib/gh.ts";
import { groupPullRequests, summarizeAttention, type RawPR } from "../lib/pull-requests.ts";

// We fetch open PRs via GraphQL rather than `gh pr list --json …` because the
// CLI's JSON projection expands `commits` (and its nested `authors`) into a
// 100-node connection PER PR. For ~100 open PRs that traverses up to
// 100 × 100 × 100 = 1,000,000 nodes and GitHub rejects it ("exceeds the maximum
// limit of 500,000"). Asking only for `commits { totalCount }` / `reviews
// { totalCount }` requests no child nodes, so the cost stays ~one node per PR
// and the query is cheap even for hundreds of open PRs.
const PR_QUERY = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        isDraft
        updatedAt
        additions
        deletions
        changedFiles
        author { login }
        reviewDecision
        commits { totalCount }
        reviews { totalCount }
      }
    }
  }
}`;

// Safety cap on pagination — 100 PRs/page × 10 pages = 1000 open PRs, far beyond
// any realistic repo, so we never loop unbounded on a pathological response.
const MAX_PAGES = 10;

interface ApiPR {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string } | null;
  reviewDecision: string | null;
  commits: { totalCount: number };
  reviews: { totalCount: number };
}

interface GraphQLPRResponse {
  data?: {
    repository?: {
      pullRequests?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ApiPR[];
      } | null;
    } | null;
  };
  errors?: { message: string }[];
}

async function fetchOpenPRs(repo: string): Promise<{ ok: true; prs: RawPR[] } | { ok: false; reason: string }> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) return { ok: false, reason: `invalid repo slug "${repo}" (expected owner/name)` };

  const prs: RawPR[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ["api", "graphql", "-f", `query=${PR_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
    if (cursor) args.push("-f", `cursor=${cursor}`);
    const res = await ghJson<GraphQLPRResponse>(args);
    if (!res.ok) return { ok: false, reason: res.reason };
    if (res.data.errors?.length) return { ok: false, reason: `GraphQL: ${res.data.errors.map((e) => e.message).join("; ")}` };
    const conn = res.data.data?.repository?.pullRequests;
    if (!conn) return { ok: false, reason: "GraphQL: repository or pullRequests not returned" };

    for (const p of conn.nodes) {
      prs.push({
        number: p.number,
        title: p.title,
        authorLogin: p.author?.login ?? "ghost",
        reviewDecision: p.reviewDecision,
        isDraft: p.isDraft,
        reviewCount: p.reviews.totalCount,
        updatedAt: p.updatedAt,
        url: p.url,
        additions: p.additions,
        deletions: p.deletions,
        commits: p.commits.totalCount,
        changedFiles: p.changedFiles,
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return { ok: true, prs };
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
        const res = await fetchOpenPRs(repo);
        if (!res.ok) return { repo, ok: false as const, reason: res.reason };
        return {
          repo,
          ok: true as const,
          groups: groupPullRequests(res.prs),
          attention: summarizeAttention(res.prs, now),
        };
      }),
    );
    return { ok: true as const, repos: results };
  },
});
