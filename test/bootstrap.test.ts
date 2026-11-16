import { describe, expect, it } from "vitest";
import { buildProvider, resolveProviderKind } from "../src/bootstrap.ts";

describe("provider selection", () => {
  it("auto-picks by available key: claude > groq > gemini", () => {
    expect(resolveProviderKind({ GROQ_API_KEY: "g", GEMINI_API_KEY: "x" })).toBe("groq");
    expect(resolveProviderKind({ ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "g" })).toBe("claude");
    expect(resolveProviderKind({ GEMINI_API_KEY: "x" })).toBe("gemini");
    expect(resolveProviderKind({})).toBeUndefined();
  });

  it("explicit LLM_PROVIDER wins", () => {
    expect(resolveProviderKind({ LLM_PROVIDER: "Ollama", GROQ_API_KEY: "g" })).toBe("ollama");
  });

  it("builds Groq with the default free model", () => {
    const r = buildProvider({ GROQ_API_KEY: "g" });
    expect("provider" in r && r.provider.model).toBe("openai/gpt-oss-120b");
  });

  it("explains what is missing instead of throwing", () => {
    expect(buildProvider({})).toHaveProperty("error");
    expect(buildProvider({ LLM_PROVIDER: "groq" })).toEqual({ error: expect.stringContaining("GROQ_API_KEY") });
  });
});
