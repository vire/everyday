import { defineTool } from "eve/tools";
import { z } from "zod";

// Progress marker for production inspection. The agent calls this as it starts
// each repo's digest section; it does nothing but return its input, so the
// session-logger hook records a `🔧 log-progress({"repo":...})` line in the
// `.log` / `.ndjson` / stdout sinks. That gives a timestamped trail of which
// repo is being processed without the tool needing its own filesystem path.
//
// Observe-only: it never affects the digest. Keep it cheap and infallible so it
// can be called freely without risk to a run.
export default defineTool({
  description:
    "Record a short progress marker to the session log. Call it with the repo slug as you begin working on each repo's digest section so production logs show which repo is being processed. Observe-only — it has no effect on the digest output.",
  inputSchema: z.object({
    repo: z.string().describe("the owner/name slug of the repo currently being processed (e.g. octocat/hello-world)"),
    note: z.string().optional().describe("optional short note, e.g. 'composing CI table' or 'data unavailable'"),
  }),
  async execute({ repo, note }) {
    return { ok: true as const, repo, note: note ?? null };
  },
});
