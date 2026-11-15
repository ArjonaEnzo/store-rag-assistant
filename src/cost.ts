export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number };

/**
 * USD per million tokens. Source: platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-15.
 * Haiku 5.5 prices apply to prompts up to 100K tokens (this app stays far below that).
 */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

/** Cost in USD. Local models (Ollama) and unknown ids cost 0 in API money. */
export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output + (usage.cacheReadTokens ?? 0) * p.cacheRead) / 1_000_000;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
  };
}
