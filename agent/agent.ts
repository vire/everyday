import { defineAgent } from "eve";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { selectModelConfig } from "./lib/model";

// Provider precedence lives in the pure, unit-tested selectModelConfig (see
// agent/lib/model.ts): OpenAI is used only when BOTH OPENAI_API_KEY and
// OPENAI_MODEL are set; otherwise it falls back to OpenRouter. Construction is
// lazy (apiKey may be "") so a missing key never throws at module load — the
// provider surfaces the error at call time instead.
const { provider: providerName, baseURL, apiKey, modelSlug } = selectModelConfig(process.env);
const provider = createOpenAICompatible({ name: providerName, baseURL, apiKey });

export default defineAgent({
  // Pass the LanguageModel directly so Eve uses it as an external model,
  // bypassing the Vercel AI Gateway catalog lookup.
  // Avoid *-codex slugs: they enforce strict tool schemas and reject our tools.
  model: provider(modelSlug),
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
