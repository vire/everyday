import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepo } from "../lib/gh.ts";
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
  description: "Aggregate recent CI run health per workflow (pass rate, durations, slowest jobs, flaky).",
  inputSchema: z.object({ limit: z.number().default(30).describe("how many recent runs to inspect") }),
  async execute({ limit }) {
    const repo = targetRepo();
    if (!repo) return { ok: false as const, reason: "TARGET_REPO env is required (owner/name)" };
    const runsRes = await ghJson<ApiRun[]>([
      "run", "list", "--repo", repo, "--limit", String(limit), "--status", "completed",
      "--json", "databaseId,workflowName,conclusion,createdAt,updatedAt,headSha",
    ]);
    if (!runsRes.ok) return runsRes;
    const runs: RawRun[] = runsRes.data.map((r) => ({
      id: r.databaseId,
      workflowName: r.workflowName,
      conclusion: r.conclusion,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      headSha: r.headSha,
    }));

    const jobsByRunId: Record<number, RawJob[]> = {};
    let failedJobFetches = 0;
    for (const run of runs) {
      const jv = await ghJson<ApiJobsView>(["run", "view", String(run.id), "--repo", repo, "--json", "jobs"]);
      if (jv.ok) {
        jobsByRunId[run.id] = jv.data.jobs;
      } else {
        failedJobFetches += 1;
        jobsByRunId[run.id] = [];
      }
    }
    return { ok: true as const, report: aggregateCiHealth(runs, jobsByRunId), failedJobFetches };
  },
});
