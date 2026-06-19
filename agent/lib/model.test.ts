import { describe, expect, it } from "vitest";
import { selectModelConfig } from "./model";

describe("selectModelConfig — provider precedence", () => {
  it("uses OpenAI only when BOTH OPENAI_API_KEY and OPENAI_MODEL are set", () => {
    expect(selectModelConfig({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "gpt-5-mini" })).toEqual({
      provider: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-x",
      modelSlug: "gpt-5-mini",
    });
  });

  it("falls back to OpenRouter when OPENAI_API_KEY is set but OPENAI_MODEL is missing", () => {
    const cfg = selectModelConfig({ OPENAI_API_KEY: "sk-x", OPENROUTER_API_KEY: "sk-or-y" });
    expect(cfg.provider).toBe("openrouter");
    expect(cfg.apiKey).toBe("sk-or-y");
  });

  it("falls back to OpenRouter when OPENAI_MODEL is set but OPENAI_API_KEY is missing", () => {
    const cfg = selectModelConfig({ OPENAI_MODEL: "gpt-5-mini", OPENROUTER_API_KEY: "sk-or-y" });
    expect(cfg.provider).toBe("openrouter");
  });

  it("treats empty-string env vars (compose's ${VAR:-}) as unset", () => {
    const cfg = selectModelConfig({
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      OPENROUTER_API_KEY: "sk-or-y",
      OPENROUTER_MODEL: "anthropic/claude-sonnet-4.6",
    });
    expect(cfg.provider).toBe("openrouter");
    expect(cfg.modelSlug).toBe("anthropic/claude-sonnet-4.6");
  });

  it("uses the OpenRouter default slug when OPENROUTER_MODEL is unset", () => {
    expect(selectModelConfig({ OPENROUTER_API_KEY: "sk-or-y" }).modelSlug).toBe("openai/gpt-5-nano");
  });

  it("passes the OpenAI slug through verbatim (no default substitution)", () => {
    expect(
      selectModelConfig({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "gpt-5.2" }).modelSlug,
    ).toBe("gpt-5.2");
  });
});
