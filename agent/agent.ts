import { defineAgent } from "eve";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Provider is chosen by which key is present, so you can run against your own
// OpenAI account or via OpenRouter without code changes:
//   OPENAI_API_KEY set → OpenAI directly (api.openai.com); slug e.g. "gpt-5-nano"
//   otherwise          → OpenRouter (openrouter.ai);       slug e.g. "openai/gpt-5-nano"
// Built lazily (apiKey ?? "") so construction never throws when a key is absent
// at module-load time — providers throw at call time, not construction.
const useOpenAI = Boolean(process.env.OPENAI_API_KEY);
const provider = createOpenAICompatible({
  name: useOpenAI ? "openai" : "openrouter",
  baseURL: useOpenAI ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1",
  apiKey: (useOpenAI ? process.env.OPENAI_API_KEY : process.env.OPENROUTER_API_KEY) ?? "",
});
const modelSlug = useOpenAI
  ? process.env.OPENAI_MODEL ?? "gpt-5-nano"
  : process.env.OPENROUTER_MODEL ?? "openai/gpt-5-nano";

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
