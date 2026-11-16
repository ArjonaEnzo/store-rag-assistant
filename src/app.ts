import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { ask } from "./assistant.ts";
import type { LlmProvider } from "./llm/provider.ts";
import type { ProductIndex } from "./retrieval/index.ts";

export type AppDeps = ({ provider: LlmProvider } | { error: string }) & { index: ProductIndex };

/** HTTP routes, separated from the server bootstrap so they can be tested with app.request(). */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  app.get("/", (c) => c.html(page));

  app.get("/health", (c) => c.json({ ok: true, products: deps.index.size, llm: "provider" in deps ? deps.provider.model : deps.error }));

  app.post("/ask", async (c) => {
    if ("error" in deps) return c.json({ error: deps.error }, 503);
    const body = await c.req.json<{ question?: unknown }>().catch(() => ({}) as { question?: unknown });
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question || question.length > 500) return c.json({ error: "question must be a non-empty string up to 500 chars" }, 400);
    return c.json(await ask(question, { provider: deps.provider, index: deps.index }));
  });

  return app;
}
