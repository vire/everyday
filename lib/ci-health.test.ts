import { describe, it, expect } from "vitest";
import { durationSec, median, aggregateCiHealth, type RawRun, type RawJob } from "./ci-health";

describe("durationSec / median", () => {
  it("durationSec computes whole seconds", () => {
    expect(durationSec("2026-06-16T00:00:00Z", "2026-06-16T00:01:30Z")).toBe(90);
  });
  it("median of odd count", () => {
    expect(median([30, 10, 20])).toBe(20);
  });
  it("median of even count averages the middle two", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });
});

describe("aggregateCiHealth", () => {
  const runs: RawRun[] = [
    { id: 1, workflowName: "CI", conclusion: "success", createdAt: "2026-06-16T00:00:00Z", updatedAt: "2026-06-16T00:02:00Z", headSha: "aaa" },
    { id: 2, workflowName: "CI", conclusion: "failure", createdAt: "2026-06-16T01:00:00Z", updatedAt: "2026-06-16T01:01:00Z", headSha: "bbb" },
  ];
  const jobs: Record<number, RawJob[]> = {
    1: [{ name: "build", startedAt: "2026-06-16T00:00:00Z", completedAt: "2026-06-16T00:01:30Z" }],
    2: [{ name: "build", startedAt: "2026-06-16T01:00:00Z", completedAt: "2026-06-16T01:00:30Z" }],
  };
  it("aggregates per workflow with pass rate, durations, flaky flag", () => {
    const report = aggregateCiHealth(runs, jobs);
    expect(report.workflows).toHaveLength(1);
    const w = report.workflows[0];
    expect(w.workflow).toBe("CI");
    expect(w.runCount).toBe(2);
    expect(w.passCount).toBe(1);
    expect(w.failCount).toBe(1);
    expect(w.passRate).toBe(0.5);
    expect(w.p50DurationSec).toBe(90); // median of [120, 60]
    expect(w.maxDurationSec).toBe(120);
    expect(w.slowestJobs[0]).toEqual({ name: "build", durationSec: 90 });
    expect(w.flaky).toBe(true); // mixed pass+fail in window
  });
});
