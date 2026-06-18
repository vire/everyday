import { defineTool } from "eve/tools";
import { z } from "zod";
import { ghJson, targetRepo } from "../../lib/gh";
import { aggregateCiHealth, type RawRun, type RawJob } from "../../lib/ci-health";

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
    const runsRes = await ghJson<ApiRun[]>([
      "run", "list", "--repo", repo, "--limit", String(limit),
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
    for (const run of runs) {
      const jv = await ghJson<ApiJobsView>(["run", "view", String(run.id), "--repo", repo, "--json", "jobs"]);
      jobsByRunId[run.id] = jv.ok ? jv.data.jobs : [];
    }
    return { ok: true as const, report: aggregateCiHealth(runs, jobsByRunId) };
  },
});
