import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ask } from "./assistant.ts";
import { buildIndex, buildProvider } from "./bootstrap.ts";

const built = buildProvider();
const index = await buildIndex();
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, products: index.size, llm: "provider" in built ? built.provider.model : built.error }));

app.post("/ask", async (c) => {
  if ("error" in built) return c.json({ error: built.error }, 503);
  const body = await c.req.json<{ question?: unknown }>().catch(() => ({}) as { question?: unknown });
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) return c.json({ error: "question must be a non-empty string up to 500 chars" }, 400);
  return c.json(await ask(question, { provider: built.provider, index }));
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`store-rag-assistant listening on http://localhost:${port}`));
