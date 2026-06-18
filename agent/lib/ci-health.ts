export interface RawRun {
  id: number;
  workflowName: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  headSha: string;
}

export interface RawJob {
  name: string;
  startedAt: string;
  completedAt: string | null;
}

export function durationSec(startISO: string, endISO: string): number {
  return Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000);
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface WorkflowHealth {
  workflow: string;
  runCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  p50DurationSec: number;
  maxDurationSec: number;
  slowestJobs: { name: string; durationSec: number }[];
  flaky: boolean;
}

export interface CiHealthReport {
  workflows: WorkflowHealth[];
}

export function aggregateCiHealth(
  runs: RawRun[],
  jobsByRunId: Record<number, RawJob[]>,
): CiHealthReport {
  const byWorkflow = new Map<string, RawRun[]>();
  for (const run of runs) {
    const list = byWorkflow.get(run.workflowName) ?? [];
    list.push(run);
    byWorkflow.set(run.workflowName, list);
  }

  const workflows: WorkflowHealth[] = [];
  for (const [workflow, wfRuns] of byWorkflow) {
    const durations = wfRuns.map((r) => durationSec(r.createdAt, r.updatedAt));
    const passCount = wfRuns.filter((r) => r.conclusion === "success").length;
    const failCount = wfRuns.filter((r) => r.conclusion === "failure").length;

    const jobDurations = new Map<string, number[]>();
    for (const run of wfRuns) {
      for (const job of jobsByRunId[run.id] ?? []) {
        if (!job.completedAt) continue;
        const list = jobDurations.get(job.name) ?? [];
        list.push(durationSec(job.startedAt, job.completedAt));
        jobDurations.set(job.name, list);
      }
    }
    const slowestJobs = [...jobDurations.entries()]
      .map(([name, ds]) => ({ name, durationSec: Math.max(...ds) }))
      .sort((a, b) => b.durationSec - a.durationSec)
      .slice(0, 5);

    workflows.push({
      workflow,
      runCount: wfRuns.length,
      passCount,
      failCount,
      passRate: wfRuns.length ? passCount / wfRuns.length : 0,
      p50DurationSec: median(durations),
      maxDurationSec: durations.length ? Math.max(...durations) : 0,
      slowestJobs,
      flaky: passCount > 0 && failCount > 0,
    });
  }
  return { workflows };
}
