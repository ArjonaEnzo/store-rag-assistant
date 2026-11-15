import type { Usage } from "../cost.ts";

/** Provider-neutral shapes so the assistant loop does not depend on one vendor SDK. */
export type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type Block = TextBlock | ToolUseBlock;

export type ToolResult = { toolUseId: string; content: string; isError?: boolean };

export type ChatMsg =
  | { role: "user"; content: string | ToolResult[] }
  /** `raw` is the provider's own assistant message, replayed verbatim (e.g. Claude thinking blocks must be passed back unchanged). */
  | { role: "assistant"; content: Block[]; raw?: unknown };

export type ChatRequest = { system: string; messages: ChatMsg[]; tools: ToolDef[] };

export type ChatResponse = {
  content: Block[];
  raw: unknown;
  usage: Usage;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | (string & {});
};

export interface LlmProvider {
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
