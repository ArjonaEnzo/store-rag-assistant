import Anthropic from "@anthropic-ai/sdk";
import type { Block, ChatRequest, ChatResponse, LlmProvider } from "./provider.ts";

export type ClaudeOptions = { model?: string; effort?: "low" | "medium" | "high"; maxTokens?: number; client?: Anthropic };

/** Claude via the official SDK. Default model: claude-haiku-5-5 (cheapest current Claude). */
export class ClaudeProvider implements LlmProvider {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: "low" | "medium" | "high";
  private readonly maxTokens: number;

  constructor(opts: ClaudeOptions = {}) {
    this.model = opts.model ?? "claude-haiku-5-5";
    this.client = opts.client ?? new Anthropic();
    // Haiku 5.5 thinks adaptively by default (effort "medium"); thinking is billed as output.
    // A catalog Q&A turn rarely needs deep reasoning, so default to "low" and let evals tell us if quality drops.
    this.effort = opts.effort ?? "low";
    this.maxTokens = opts.maxTokens ?? 4000;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => {
      if (m.role === "assistant") {
        return (m.raw as Anthropic.MessageParam | undefined) ?? { role: "assistant", content: m.content.map(toParam) };
      }
      if (typeof m.content === "string") return { role: "user", content: m.content };
      return {
        role: "user",
        content: m.content.map((r) => ({ type: "tool_result" as const, tool_use_id: r.toolUseId, content: r.content, is_error: r.isError })),
      };
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      // Stable system prompt + tools first so they can be prompt-cached once the prefix is long enough.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
      messages,
      output_config: { effort: this.effort },
    });

    const content: Block[] = [];
    for (const b of response.content) {
      if (b.type === "text") content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    }
    return {
      content,
      raw: { role: "assistant", content: response.content } satisfies Anthropic.MessageParam,
      usage: {
        inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
      stopReason: response.stop_reason ?? "end_turn",
    };
  }
}

function toParam(b: Block): Anthropic.ContentBlockParam {
  return b.type === "text" ? { type: "text", text: b.text } : { type: "tool_use", id: b.id, name: b.name, input: b.input };
}
