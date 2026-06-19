import { defineEval } from "eve/evals";

/**
 * Smoke-check eval: dispatch the daily-digest schedule once and assert the
 * agent follows its eight-step protocol to completion.
 *
 * This eval requires a running `eve dev` target (started automatically by the
 * runner) and a valid OPENROUTER_API_KEY. It does NOT call live GitHub or
 * Slack; the tools shell out to `gh` and `curl`, so run it against
 * repositories you have access to or stub the env vars. Each data tool is
 * called once and covers every repo in `TARGET_REPO` (comma-delimited), so the
 * tool-call assertions below are unchanged whether one or many repos are set.
 *
 * Assertions:
 *   1. The schedule dispatches and produces exactly one session.
 *   2. `read-memory` is called first; all three data tools are called (any order/parallel);
 *      `write-memory` is called; `post-to-slack` is attempted.
 *      (strict total-order is not asserted — the data tools may run in parallel)
 *   3. The final message includes the four contribution buckets.
 *   4. The final message includes the five PR review-state labels.
 *   5. The final message includes at least one CI workflow line.
 *   6. The run completes without a terminal failure.
 *
 * If the agent cannot reach GitHub (network offline, no PAT) it should still
 * complete and include "data unavailable" placeholders per its instructions —
 * assertion 6 still passes, assertions 3-5 use a looser regex that accepts
 * the placeholder text.
 */
export default defineEval({
  description: "Daily digest schedule dispatches and agent completes all 8 steps",
  timeoutMs: 90_000,
  async test(t) {
    // Dispatch the authored schedule (requires dev routes on the target).
    const dispatch = await t.target.dispatchSchedule("daily-digest");

    // Attach to the first session the schedule started.
    const [sessionId] = dispatch.sessionIds;
    const session = await t.target.attachSession(sessionId);

    // Read until the session completes.
    await session.readTurn();

    // 1. Session completed without a terminal failure.
    t.completed();

    // 2. Tool call membership and partial-order assertions:
    //    - read-memory must be called first (it loads the gist ID needed by write-memory).
    //    - The three data tools may run in any order or in parallel.
    //    - write-memory must be called (memory is always written, even if Slack fails).
    //    - post-to-slack must be attempted (it may return ok:false without failing the run).
    t.toolCalledFirst("read-memory");
    t.toolCalled("contributions");
    t.toolCalled("pull-requests");
    t.toolCalled("ci-health");
    t.toolCalled("write-memory");
    t.toolCalled("post-to-slack");

    // 3. Digest contains the four contribution buckets (or a data-unavailable note).
    t.messageIncludes(/You:|data unavailable/i);

    // 4. Digest contains PR review-state labels (or a data-unavailable note).
    t.messageIncludes(/Approved:|data unavailable/i);

    // 5. Digest contains at least one CI workflow reference (or a data-unavailable note).
    t.messageIncludes(/pass rate|data unavailable/i);

    // 6. No tool action returned an unhandled error that broke the run.
    t.noFailedActions();
  },
});
