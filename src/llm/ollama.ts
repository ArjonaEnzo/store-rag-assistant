import type { Block, ChatRequest, ChatResponse, LlmProvider } from "./provider.ts";

type OllamaMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
};

/** Free local fallback via Ollama's /api/chat (tool calling supported on models like qwen2.5). Costs USD 0. */
export class OllamaProvider implements LlmProvider {
  constructor(
    readonly model = process.env.OLLAMA_MODEL ?? "qwen2.5:3b",
    private readonly baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434",
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages: OllamaMsg[] = [{ role: "system", content: req.system }];
    for (const m of req.messages) {
      if (m.role === "user" && typeof m.content === "string") messages.push({ role: "user", content: m.content });
      else if (m.role === "user") for (const r of m.content as { content: string }[]) messages.push({ role: "tool", content: r.content });
      else {
        const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const calls = m.content.filter((b) => b.type === "tool_use").map((b) => ({ function: { name: b.name, arguments: b.input } }));
        messages.push({ role: "assistant", content: text, ...(calls.length ? { tool_calls: calls } : {}) });
      }
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages,
        tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { message: OllamaMsg; prompt_eval_count?: number; eval_count?: number };

    const content: Block[] = [];
    if (data.message.content) content.push({ type: "text", text: data.message.content });
    (data.message.tool_calls ?? []).forEach((c, i) =>
      content.push({ type: "tool_use", id: `call_${Date.now()}_${i}`, name: c.function.name, input: c.function.arguments }),
    );
    return {
      content,
      raw: undefined,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    };
  }
}
