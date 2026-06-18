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
  inputSchema: z.object({ limit: z.number().default(10).describe("how many recent runs to inspect (clamped to 1..20)") }),
  async execute({ limit }) {
    const repo = targetRepo();
    if (!repo) return { ok: false as const, reason: "TARGET_REPO env is required (owner/name)" };
    // Clamp in code (rather than via the schema) so the tool's JSON Schema stays
    // minimal and the per-run job fetches below stay bounded.
    const runCount = Math.max(1, Math.min(20, Math.floor(limit) || 10));
    const runsRes = await ghJson<ApiRun[]>([
      "run", "list", "--repo", repo, "--limit", String(runCount), "--status", "completed",
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

    // Fetch per-run job details in PARALLEL — sequential `gh run view` calls were
    // the dominant cost (one subprocess per run) and made long runs blow Eve's
    // dev workflow-replay budget.
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
    return { ok: true as const, report: aggregateCiHealth(runs, jobsByRunId), failedJobFetches };
  },
});
