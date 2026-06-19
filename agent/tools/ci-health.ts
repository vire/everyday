import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepos } from "../lib/gh.ts";
import { aggregateCiHealth, type RawRun, type RawJob } from "../lib/ci-health.ts";

interface ApiRun {
  databaseId: number;
  workflowName: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  headSha: string;
}

interface ApiJobsView {
  jobs: { name: string; startedAt: string; completedAt: string | null }[];
}

export default defineTool({
  description: "Aggregate recent CI run health per workflow (pass rate, durations, slowest jobs, flaky), per repo. Covers every configured repo; results are returned in the `repos` array.",
  inputSchema: z.object({ limit: z.number().default(10).describe("how many recent runs to inspect per repo (clamped to 1..20)") }),
  async execute({ limit }) {
    const repos = targetRepos();
    if (repos.length === 0)
      return { ok: false as const, reason: "TARGET_REPO env is required (comma-delimited owner/name list)" };
    // Clamp in code (rather than via the schema) so the tool's JSON Schema stays
    // minimal and the per-run job fetches below stay bounded.
    const runCount = Math.max(1, Math.min(20, Math.floor(limit) || 10));

    // Fan out across repos in parallel; within each repo, job fetches are also
    // parallel. A failure for one repo is isolated to its entry.
    const results = await Promise.all(
      repos.map(async (repo) => {
        const runsRes = await ghJson<ApiRun[]>([
          "run", "list", "--repo", repo, "--limit", String(runCount), "--status", "completed",
          "--json", "databaseId,workflowName,conclusion,createdAt,updatedAt,headSha",
        ]);
        if (!runsRes.ok) return { repo, ok: false as const, reason: runsRes.reason };
        const runs: RawRun[] = runsRes.data.map((r) => ({
          id: r.databaseId,
          workflowName: r.workflowName,
          conclusion: r.conclusion,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          headSha: r.headSha,
        }));

        // Fetch per-run job details in PARALLEL — sequential `gh run view` calls
        // were the dominant cost (one subprocess per run) and made long runs blow
        // Eve's dev workflow-replay budget.
        const jobResults = await Promise.all(
          runs.map((run) =>
            ghJson<ApiJobsView>(["run", "view", String(run.id), "--repo", repo, "--json", "jobs"]),
          ),
        );
        const jobsByRunId: Record<number, RawJob[]> = {};
        let failedJobFetches = 0;
        runs.forEach((run, i) => {
          const jv = jobResults[i];
          if (jv.ok) {
            jobsByRunId[run.id] = jv.data.jobs;
          } else {
            failedJobFetches += 1;
            jobsByRunId[run.id] = [];
          }
        });
        return { repo, ok: true as const, report: aggregateCiHealth(runs, jobsByRunId), failedJobFetches };
      }),
    );
    return { ok: true as const, repos: results };
  },
});
