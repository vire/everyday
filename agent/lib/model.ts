// Pure model-provider selection — no SDK construction, no I/O, fully unit-tested
// (agent/lib/model.test.ts). agent.ts feeds the result into
// `createOpenAICompatible`. Kept side-effect-free so the precedence rule is
// verifiable without touching the network or process env.

export interface ModelEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

export interface ModelConfig {
  /** Provider name passed to createOpenAICompatible (also used for logging). */
  provider: "openai" | "openrouter";
  baseURL: string;
  apiKey: string;
  modelSlug: string;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5-nano";

/**
 * Choose the model provider from env.
 *
 * Precedence: OpenAI takes preference, but ONLY when BOTH `OPENAI_API_KEY` and
 * `OPENAI_MODEL` are set (non-empty). A key without a model — or a model without
 * a key — falls through to OpenRouter, so OpenAI is always an explicit, complete
 * opt-in rather than a half-configured default. OpenRouter is the fallback and
 * supplies its own default slug so it works with just `OPENROUTER_API_KEY`.
 *
 * Empty strings count as unset: docker-compose passes `${OPENAI_MODEL:-}` which
 * arrives as "" when the var is absent, and `Boolean("" && x)` is false.
 *
 * Avoid `*-codex` slugs for either provider — they enforce strict function-call
 * schemas and reject this agent's tool definitions.
 */
export function selectModelConfig(env: ModelEnv): ModelConfig {
  const useOpenAI = Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL);

  if (useOpenAI) {
    return {
      provider: "openai",
      baseURL: OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY as string,
      modelSlug: env.OPENAI_MODEL as string,
    };
  }

  return {
    provider: "openrouter",
    baseURL: OPENROUTER_BASE_URL,
    // Built lazily downstream (apiKey ?? "") so a missing key never throws at
    // construction — the provider surfaces the error at call time instead.
    apiKey: env.OPENROUTER_API_KEY ?? "",
    modelSlug: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  };
}
