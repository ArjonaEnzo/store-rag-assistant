# store-rag-assistant v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog Q&A assistant for a demo WooCommerce store with deterministic safeguards, cost per query and an eval suite that outputs a number.

**Architecture:** `StoreAdapter` normalizes WooCommerce REST JSON into `Product`. A local embedding index + exact filters back a `search_products` tool. An `LlmProvider` (Claude Haiku 5.5 default, Ollama fallback) runs a small tool-use loop; guards validate the answer against the turn's search results. Evals run in two layers (retrieval without LLM, full answer with LLM).

**Tech Stack:** TypeScript (ESM, strict), Node 24, pnpm, tsx, Vitest, Hono, `@anthropic-ai/sdk`, `@huggingface/transformers`.

**Spec:** `docs/superpowers/specs/2026-11-15-store-rag-assistant-design.md`

## Global Constraints
- Default model id `claude-haiku-5-5`; prices USD 0.10 input / 0.50 output per MTok (≤100K-token prompts), 0.01 cache read.
- All data fictional; prices ARS integers; text in Spanish. Code/commits in English.
- No LangChain/LlamaIndex. No real customer data.
- Core never imports WooCommerce-specific types outside `src/adapters/woocommerce.ts`.

## Review Focus
1. Price formats in answers ("$79.990", "79990", "$ 79.990,00") — guard must parse all to the same integer. Test in Task 3.
2. Question with no matching product → must escalate, not list near misses as if they matched. Eval case in Task 6.
3. Out-of-stock product requested → answer must say it is out of stock. Eval case + `inStock` filter test in Task 2.
4. Catalog text containing instructions ("ignore previous instructions…") → treated as data. Eval case in Task 6.
5. Missing `ANTHROPIC_API_KEY` → eval runner still runs retrieval layer and says the answer layer was skipped (no crash). Task 6.

---

### Task 1: Scaffold, types, WooCommerce adapter, seed data
**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/types.ts`, `src/adapters/woocommerce.ts`, `data/woocommerce-products.json`, `test/adapter.test.ts`
**Produces:**
- `type Product = { id: string; name: string; price: number; regularPrice: number; onSale: boolean; inStock: boolean; stockQty: number | null; categories: string[]; attributes: Record<string, string[]>; description: string; url: string }`
- `interface StoreAdapter { listProducts(): Promise<Product[]> }`
- `class WooCommerceJsonAdapter implements StoreAdapter` (ctor: file path); `normalizeWooProduct(raw: WooProduct): Product` (strips HTML, `price` string → int, `stock_status === "instock"`).
- [ ] Test: `normalizeWooProduct` maps a fixture (price "79990" → 79990, HTML stripped, sale detected, attributes map).
- [ ] Implement; seed ~60 products across running, fútbol, training, outdoor, natación, accesorios; include ≥5 out of stock, ≥5 on sale, 1 product whose description contains an injection string.
- [ ] `pnpm test` passes; commit.

### Task 2: Embeddings + search with filters
**Files:** `src/retrieval/embedder.ts`, `src/retrieval/index.ts`, `test/search.test.ts`
**Consumes:** `Product`. **Produces:**
- `interface Embedder { embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> }`; `class LocalEmbedder` (model `Xenova/multilingual-e5-small`, prefixes `query: ` / `passage: `, mean pooling + normalize).
- `type SearchFilters = { maxPrice?: number; minPrice?: number; category?: string; inStock?: boolean }`
- `type SearchHit = { product: Product; score: number }`
- `class ProductIndex { static build(products, embedder, cachePath?): Promise<ProductIndex>; search(query: string, filters?: SearchFilters, k = 5): Promise<SearchHit[]> }` — filters applied before ranking; cosine similarity; cache vectors in `.cache/index.json` keyed by product id + text hash.
- [ ] Tests with a fake keyword embedder: filters exclude by price/category/stock; ranking order; k respected.
- [ ] Implement; tests pass; commit.

### Task 3: Cost + guards
**Files:** `src/cost.ts`, `src/guards.ts`, `test/cost.test.ts`, `test/guards.test.ts`
**Produces:**
- `PRICES: Record<string, { input: number; output: number; cacheRead: number }>` (USD per MTok); `costUsd(model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }): number` (0 for unknown/ollama).
- `extractPrices(text: string): number[]` (handles `$79.990`, `79990`, `$ 79.990,00`; ignores numbers < 1000 like talles).
- `checkAnswer(answer: { text: string; citedIds: string[] }, hits: SearchHit[]): string[]` → flags `"uncited_product:<id>"`, `"price_not_in_results:<n>"`.
- [ ] Tests: `costUsd("claude-haiku-5-5", {inputTokens: 3000, outputTokens: 300}) ≈ 0.00045`; the three price formats → 79990; flags for unknown id and wrong price; no flags on clean answer.
- [ ] Implement; pass; commit.

### Task 4: Providers + assistant loop
**Files:** `src/llm/provider.ts`, `src/llm/claude.ts`, `src/llm/ollama.ts`, `src/assistant.ts`, `src/prompt.ts`, `test/assistant.test.ts`
**Produces:**
- Provider-neutral `LlmProvider { model: string; chat(req: { system: string; messages: ChatMsg[]; tools: ToolDef[] }): Promise<{ content: Block[]; usage: Usage; stopReason: string }> }` with own minimal block types (text / tool_use / tool_result) — Claude provider maps to SDK types.
- Tools: `search_products({query, max_price?, min_price?, category?, in_stock?})`, `escalate_to_human({reason})`.
- Final answer contract: model ends with a line `CITED: id1,id2` (or `CITED: none`); assistant strips it.
- `ask(question: string, deps: { provider; index }): Promise<AskResult>` where `AskResult = { answer: string; citations: string[]; escalated: boolean; escalationReason?: string; flags: string[]; usage: Usage; costUsd: number; latencyMs: number; searches: { query: string; filters: SearchFilters; hitIds: string[] }[] }`. Max 4 loop turns; product data in tool results wrapped in `<catalog_data>`.
- [ ] Test with scripted fake provider: tool call → search → final text with CITED; usage summed across turns; escalation captured; flags from `checkAnswer`.
- [ ] Implement; pass; commit.

### Task 5: CLI + HTTP
**Files:** `src/bootstrap.ts`, `src/cli.ts`, `src/server.ts`
- `bootstrap(): Promise<{ provider; index }>` — picks provider by `LLM_PROVIDER` env (`claude` default, `ollama`).
- `pnpm ask "<q>"` prints answer + citations + cost; `pnpm dev` → Hono `POST /ask {question}` → `AskResult`, `GET /health`.
- [ ] Manual check: `pnpm ask` without key prints a clear error; commit.

### Task 6: Evals
**Files:** `evals/cases.jsonl`, `evals/run.ts`, `evals/results/` (gitkept)
- Case: `{ id, question, expectIds?: string[], mustMention?: string[], shouldEscalate: boolean, tags: string[] }`; ~30 cases incl. Review Focus 2–4.
- Layer 1 (always): retrieval hit@5 using a heuristic query = question, no filters → % cases whose `expectIds` ⊂ top-5.
- Layer 2 (if provider available): pass = cited ⊇ expectIds, mustMention all present (case-insensitive), no flags, escalated === shouldEscalate.
- Output: console table + `evals/results/<ISO>.json` + `.md` summary (hit@5, pass rate, escalation accuracy, avg/p50 cost, p50 latency, failures list).
- [ ] `pnpm eval` without key → layer 1 number + "layer 2 skipped". Commit.

### Task 7: README
- What it is, architecture diagram (text), how to run, eval numbers from real runs, cost table, **Known failures** from eval output, roadmap (orders v2, WhatsApp, Tiendanube adapter, deploy). Commit.
