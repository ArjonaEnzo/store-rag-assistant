import { WooCommerceJsonAdapter } from "./adapters/woocommerce.ts";
import { ClaudeProvider } from "./llm/claude.ts";
import { OllamaProvider } from "./llm/ollama.ts";
import { OpenAICompatProvider } from "./llm/openai-compat.ts";
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

const env = process.env;

/** Picks LLM_PROVIDER if set, otherwise the first provider whose key is present: claude → groq → gemini. */
export function resolveProviderKind(e: NodeJS.ProcessEnv = env): string | undefined {
  if (e.LLM_PROVIDER) return e.LLM_PROVIDER.toLowerCase();
  if (e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN) return "claude";
  if (e.GROQ_API_KEY) return "groq";
  if (e.GEMINI_API_KEY) return "gemini";
  return undefined;
}

/** Returns the configured provider, or an explanation of why none is available (so callers can degrade instead of crash). */
export function buildProvider(e: NodeJS.ProcessEnv = env): { provider: LlmProvider } | { error: string } {
  const kind = resolveProviderKind(e);
  const missing = (v: string) => ({ error: `${v} is not set. Add it to your env file (see .env.example).` });
  switch (kind) {
    case "claude":
      if (!e.ANTHROPIC_API_KEY && !e.ANTHROPIC_AUTH_TOKEN) return missing("ANTHROPIC_API_KEY");
      return { provider: new ClaudeProvider({ model: e.CLAUDE_MODEL ?? "claude-haiku-5-5" }) };
    case "groq":
      if (!e.GROQ_API_KEY) return missing("GROQ_API_KEY");
      return {
        provider: new OpenAICompatProvider({ baseUrl: "https://api.groq.com/openai/v1", apiKey: e.GROQ_API_KEY, model: e.GROQ_MODEL ?? "openai/gpt-oss-120b" }),
      };
    case "gemini":
      if (!e.GEMINI_API_KEY) return missing("GEMINI_API_KEY");
      return {
        provider: new OpenAICompatProvider({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          apiKey: e.GEMINI_API_KEY,
          model: e.GEMINI_MODEL ?? "gemini-2.5-flash",
        }),
      };
    case "ollama":
      return { provider: new OllamaProvider() };
    case undefined:
      return { error: "No LLM configured. Set one of GROQ_API_KEY (free), GEMINI_API_KEY (free tier), ANTHROPIC_API_KEY, or LLM_PROVIDER=ollama. See .env.example." };
    default:
      return { error: `Unknown LLM_PROVIDER "${kind}". Use claude | groq | gemini | ollama.` };
  }
}
