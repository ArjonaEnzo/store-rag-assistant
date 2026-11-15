# store-rag-assistant — design (v1)

Date: 2026-11-15 · Status: approved by Enzo in chat (S1 of the Carril 3 tier list)

## Intent / why
Portfolio project #1 for the "applied AI engineer" track (target roles USD 4–5k/month). It must
(a) hold up in a technical interview — measured with evals, cost per query visible, failures documented — and
(b) be sellable later to real store owners (freelance). Market signal used: AI engineer postings ask for
agents/tools, evals and RAG; "generic chatbot / notebook without deploy" does not differentiate.

A customer-facing shop assistant: answers catalog questions in Spanish ("¿tienen zapatillas de running
talle 42 por menos de $80.000?"), cites the products it used, shows cost per query, and escalates to a
human instead of inventing.

## Goals (v1, this session)
- Answers catalog questions from a demo store, grounded in retrieved products, with product-ID citations.
- Eval suite that outputs a number: retrieval hit rate, answer pass rate, escalation accuracy, avg cost and latency per query.
- README with cost table and a "known failures" section written from real eval runs.

## Non-goals (v1)
- Orders lookup (v2 — needs identity verification as a safeguard).
- WhatsApp channel (v2 — architecture keeps the channel separate from the core).
- UI, auth, deploy (v1.x).
- Agent actions (refunds etc.) — that is portfolio project #2, built on this same store.

## Anti-goals
- A framework that hides the RAG loop (LangChain/LlamaIndex): the point is to be able to explain every step.
- Answers that state prices/products not in the retrieved data. A wrong price is worse than "no sé".
- Real customer data in the repo. Everything is fictional and public.

## Approaches considered
1. Pure semantic search over everything — simple, fails on exact constraints (price < X, in stock). Rejected.
2. **Hybrid: LLM + tool `search_products(query, filters)` that does semantic search plus exact filters, and tool `escalate_to_human`.** Chosen: matches what postings ask (RAG + tools), handles exact constraints, explainable.
3. Framework (LangChain etc.) — faster start, hides the mechanics. Rejected (anti-goal).

## Decisions
- **Platform-agnostic core + adapters.** `StoreAdapter` normalizes products into a common `Product` type.
  v1 adapter: WooCommerce REST shape (`/wp-json/wc/v3/products`) read from a JSON seed. Tiendanube/Shopify later = new adapter only.
- **Data:** fictional Argentine sports store, ~60 products, ARS prices, Spanish, WooCommerce REST field shape.
- **Stack:** TypeScript, Node 24, pnpm, Hono (HTTP), Vitest. (Builder's call, close to Enzo's profile.)
- **Embeddings:** local and free — `@huggingface/transformers` with a small multilingual model (e5-small family). Vectors in memory (60 docs, no DB). Index cached to disk.
- **LLM provider interface:** `ClaudeProvider` (default, `claude-haiku-5-5`, USD 0.10 / 0.50 per MTok verified 2026-11-15 on platform.claude.com/pricing) and `OllamaProvider` (free fallback; not installed yet on Enzo's machine, no NVIDIA GPU → expected slow + weaker).
- **Safeguards (deterministic, in code, not only in the prompt):**
  - Cited product IDs must exist in this turn's search results, else flagged.
  - Every price mentioned in the answer must match a retrieved product price, else flagged.
  - Low retrieval score / no results → instructed to escalate; eval checks it did.
  - Product text is wrapped as data (prompt-injection hygiene); system prompt says catalog text is not instructions.
- **Cost:** computed from `usage` tokens × price table in code; returned per answer and aggregated in eval reports.
- **Evals:** `evals/cases.jsonl` (~30 cases: catalog lookups, exact-filter questions, out-of-catalog → escalate, injection attempt). Three layers:
  1. retrieval hit@5 — no LLM, free, deterministic;
  2. answer checks — expected product IDs cited, required facts present, safeguard flags absent;
  3. escalation correctness.
  Reports saved to `evals/results/<timestamp>.json` + markdown summary.
- **Interfaces:** CLI (`pnpm ask "..."`) and `POST /ask` → `{answer, citations, escalated, flags, usage, costUsd, latencyMs}`.

## Left to the builder
Exact model for embeddings within the e5-small family, prompt wording, eval case wording, folder layout.

## Done (this session)
Design approved · v1 running · evals produce a number (at least retrieval layer without API key; full layer once
`ANTHROPIC_API_KEY` is set) · README with cost and failures.
