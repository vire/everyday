import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  // No judge model configured: the digest eval uses structural assertions only
  // (tool call ordering, message inclusion) so no LLM judge is required.
  // Set a judge here once you want to score prose quality, e.g.:
  //   judge: { model: openrouter("anthropic/claude-opus-4") }
  timeoutMs: 120_000,
});
