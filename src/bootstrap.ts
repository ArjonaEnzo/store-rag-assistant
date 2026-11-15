import { WooCommerceJsonAdapter } from "./adapters/woocommerce.ts";
import { ClaudeProvider } from "./llm/claude.ts";
import { OllamaProvider } from "./llm/ollama.ts";
import type { LlmProvider } from "./llm/provider.ts";
import { LocalEmbedder } from "./retrieval/embedder.ts";
import { ProductIndex } from "./retrieval/index.ts";

try {
  process.loadEnvFile(); // optional local env file; real env vars win
} catch {
  /* no env file */
}

export const DATA_PATH = process.env.CATALOG_PATH ?? "data/woocommerce-products.json";

export async function buildIndex(): Promise<ProductIndex> {
  const products = await new WooCommerceJsonAdapter(DATA_PATH).listProducts();
  return ProductIndex.build(products, new LocalEmbedder(), ".cache/index.json");
}

/** Returns the configured provider, or an explanation of why none is available (so callers can degrade instead of crash). */
export function buildProvider(): { provider: LlmProvider } | { error: string } {
  const kind = (process.env.LLM_PROVIDER ?? "claude").toLowerCase();
  if (kind === "ollama") return { provider: new OllamaProvider() };
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { error: "No ANTHROPIC_API_KEY set. Add it (see .env.example) or run with LLM_PROVIDER=ollama." };
  }
  return { provider: new ClaudeProvider({ model: process.env.CLAUDE_MODEL ?? "claude-haiku-5-5" }) };
}
