import { defineAgent } from "eve";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Build the provider lazily so construction never throws even if the API key
// is absent at module-load time (providers throw at call time, not construction).
const openrouter = createOpenAICompatible({
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

export default defineAgent({
  // Pass the LanguageModel directly so Eve uses it as an external model,
  // bypassing the Vercel AI Gateway catalog lookup.
  model: openrouter(process.env.OPENROUTER_MODEL ?? "openai/gpt-5-codex"),
  // Gateway catalog lookup is skipped for external models; set context window manually.
  modelContextWindowTokens: 128000,
  // Task-mode (schedule) completion contract: a structured final output tells
  // the runtime the unattended run is done, so the channel-less scheduled
  // session terminates cleanly instead of parking ("Cannot park").
  outputSchema: {
    type: "object",
    properties: {
      delivered: {
        type: "boolean",
        description: "true if the digest was successfully posted to Slack",
      },
      summary: {
        type: "string",
        description: "one-line summary of what the digest reported this run",
      },
    },
    required: ["delivered", "summary"],
    additionalProperties: false,
  },
});
