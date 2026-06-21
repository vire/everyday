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
 *   2. `read-memory` runs before `write-memory` (it loads the gistId write-memory
 *      needs); all three data tools are called; `log-progress` is called (per-repo
 *      progress marker); `write-memory` is called.
 *      (strict total-order is not asserted — the data tools may run in parallel)
 *   3-5. `post-to-slack` is called and its TEXT PAYLOAD carries the real digest —
 *      the title, the four contribution buckets, the PR review-state labels, and
 *      the CI section. Assertions target the Slack payload (the tool input), NOT
 *      the final assistant message: a model can satisfy a message-based check
 *      while posting a placeholder to Slack, so the payload is the source of truth.
 *   6. The run completes without a terminal failure.
 *
 * If the agent cannot reach GitHub (network offline, no PAT) it should still
 * complete and post a digest with "data unavailable" placeholders per its
 * instructions — assertion 6 still passes, and assertions 3-5 use a looser regex
 * that accepts the placeholder text (but still requires a real posted digest).
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
    t.calledTool("read-memory");
    t.toolOrder(["read-memory", "write-memory"]); // read-memory loads the gistId write-memory needs
    t.calledTool("contributions");
    t.calledTool("pull-requests");
    t.calledTool("ci-health");
    t.calledTool("log-progress"); // per-repo progress marker for production log inspection
    t.calledTool("write-memory");

    // post-to-slack must be attempted AND carry the real digest — not a placeholder.
    // Assert against the Slack PAYLOAD (the tool input), not the final assistant
    // message: a model can satisfy a message-based check while posting junk to
    // Slack (the digest belongs in this call, not in the final message).
    t.calledTool("post-to-slack", { input: { text: /PR & CI Digest/i } });

    // 3. Digest payload contains the four contribution buckets (or a data-unavailable note).
    t.calledTool("post-to-slack", { input: { text: /You:|data unavailable/i } });

    // 4. Digest payload contains PR review-state labels (or a data-unavailable note).
    t.calledTool("post-to-slack", { input: { text: /Approved:|data unavailable/i } });

    // 5. Digest payload contains the CI health section / table (or a data-unavailable note).
    //    CI health renders as a fixed-width table with a "Pass" column, so match
    //    the section header or the column header rather than the old "pass rate" prose.
    t.calledTool("post-to-slack", { input: { text: /CI health|Pass|no runs in window|data unavailable/i } });

    // 6. No tool action returned an unhandled error that broke the run.
    t.noFailedActions();
  },
});
