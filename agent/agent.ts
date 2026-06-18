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
  model: openrouter(process.env.OPENROUTER_MODEL ?? "openai/gpt-4o"),
  // Gateway catalog lookup is skipped for external models; set context window manually.
  modelContextWindowTokens: 128000,
});
