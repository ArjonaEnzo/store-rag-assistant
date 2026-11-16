import type { Block, ChatRequest, ChatResponse, LlmProvider, ToolResult } from "./provider.ts";

/**
 * Any OpenAI-compatible /chat/completions endpoint: Groq, Gemini (AI Studio), Ollama (/v1), OpenRouter...
 * Uses plain fetch on purpose — no vendor SDK needed for the free providers.
 */
export type OpenAICompatOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
};

type OaiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OaiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OaiResponse = {
  choices: { finish_reason: string; message: { content: string | null; tool_calls?: OaiToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpenAICompatProvider implements LlmProvider {
  readonly model: string;
  /** Last rate-limit headers seen (x-ratelimit-*), useful to learn the real free-tier limits. */
  lastRateLimit: Record<string, string> = {};

  constructor(private readonly opts: OpenAICompatOptions) {
    this.model = opts.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages: OaiMessage[] = [{ role: "system", content: req.system }];
    for (const m of req.messages) {
      if (m.role === "user" && typeof m.content === "string") messages.push({ role: "user", content: m.content });
      else if (m.role === "user") for (const r of m.content as ToolResult[]) messages.push({ role: "tool", tool_call_id: r.toolUseId, content: r.content });
      else {
        const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const calls = m.content
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input) } }));
        messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      }
    }

    const body = JSON.stringify({
      model: this.model,
      messages,
      tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      tool_choice: "auto",
      max_tokens: this.opts.maxTokens ?? 2000,
    });

    const data = await this.post(body);
    const choice = data.choices[0];
    if (!choice) throw new Error("No choices in response");

    const content: Block[] = [];
    if (choice.message.content) content.push({ type: "text", text: choice.message.content });
    for (const c of choice.message.tool_calls ?? []) {
      let input: unknown = c.function.arguments;
      try {
        input = JSON.parse(c.function.arguments);
      } catch {
        /* leave as string: the assistant loop rejects it as invalid input */
      }
      content.push({ type: "tool_use", id: c.id, name: c.function.name, input });
    }

    const stopReason =
      choice.finish_reason === "length" ? "max_tokens" : content.some((b) => b.type === "tool_use") ? "tool_use" : choice.finish_reason === "content_filter" ? "refusal" : "end_turn";
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      content,
      raw: undefined,
      usage: { inputTokens: (data.usage?.prompt_tokens ?? 0) - cached, outputTokens: data.usage?.completion_tokens ?? 0, cacheReadTokens: cached },
      stopReason,
    };
  }

  private async post(body: string): Promise<OaiResponse> {
    const doFetch = this.opts.fetch ?? fetch;
    const maxRetries = this.opts.maxRetries ?? 6;
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body,
      });
      this.lastRateLimit = Object.fromEntries([...res.headers].filter(([k]) => k.startsWith("x-ratelimit")));
      if (res.ok) return (await res.json()) as OaiResponse;

      const text = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        let msg = text;
        try {
          msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
        } catch {
          /* not JSON */
        }
        throw new Error(`${this.model} HTTP ${res.status}: ${msg}`);
      }
      const retryAfter = Number.parseFloat(res.headers.get("retry-after") ?? "");
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(60_000, 2_000 * 2 ** attempt));
    }
  }
}
