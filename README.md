# store-rag-assistant

A grounded shopping assistant for e-commerce catalogs (WooCommerce first). It answers customer
questions in Spanish, **cites the products it used**, **refuses to invent prices**, **hands off to a
human** when the catalog can't answer, and reports **cost and latency per query**. An eval suite turns
"seems to work" into a number.

> Status (2026-11-15): v1, catalog questions only. Retrieval layer measured; answer layer built and
> unit-tested but **not yet measured against the real model** (needs an API key, see [Cost](#cost)).

## How it works

```
question ──► LLM (Claude Haiku 5.5 · or Ollama) ──tool call──► search_products(query, max_price, category, in_stock)
                │                                                   │  local multilingual embeddings (e5-small, CPU, free)
                │                                                   │  + exact filters on price / category / stock
                │◄──────────── <catalog_data> top-5 products ───────┘  (wrapped as data, never instructions)
                │
                ├──tool call──► escalate_to_human(reason)
                ▼
answer + "CITED: ids" ──► deterministic guards ──► { answer, citations, escalated, flags, usage, costUsd, latencyMs }
                           · cited id not in this turn's results  → uncited_product:<id>
                           · price not in results / not a number the customer wrote → price_not_in_results:<n>
                           · searched but cited nothing           → missing_citations
                           · truncated (max_tokens) or refused turn → escalated, never executed
```

- **Platform-agnostic core.** `StoreAdapter` normalizes products into one `Product` type. WooCommerce
  (REST API shape) is the first adapter; Tiendanube/Shopify would be new adapters, nothing else changes.
- **Hybrid retrieval, not pure vector search.** "Under $60.000" or "in stock" are exact constraints, so
  the model passes them as filters; semantic search only ranks what passes.
- **Guards in code, not only in the prompt.** The prompt asks for grounding; the guards *check* it.
- **No framework.** The whole loop is ~150 lines in `src/assistant.ts`, on purpose.

Demo data: a fictional Argentine sports store, 59 products, ARS prices, WooCommerce REST shape
(`scripts/build-seed.ts`). One product description contains a prompt-injection attempt on purpose.

## Run it

```bash
pnpm install
pnpm test                       # 38 unit tests, no network
pnpm eval --retrieval-only      # retrieval evals, free (first run downloads the ~120 MB embedding model)
```

With a Claude API key (copy `.env.example` to `.env` and fill `ANTHROPIC_API_KEY`):

```bash
pnpm ask "¿tienen zapatillas para correr por menos de $80.000?"
pnpm eval                       # retrieval + full answers, prints cost of the run
pnpm start                      # POST /ask {"question": "..."} · GET /health
```

Free alternative: install [Ollama](https://ollama.com), `ollama pull qwen2.5:3b`, then `LLM_PROVIDER=ollama pnpm eval`.

## Evals

`evals/cases.jsonl` — 35 cases: catalog lookups, exact price/stock filters, out-of-stock, out-of-catalog
and service questions that must escalate, a prompt-injection product, and 5 deliberately vague "hard" queries.

| layer | what it measures | cost | result (2026-11-15) |
|---|---|---|---|
| 1 · retrieval | expected product in top-5 of semantic search (no LLM) | USD 0 | **93.1 %** (27/29) |
| 2 · answers | cites expected products, mentions required facts, no forbidden text, no guard flags, escalates iff it should — and an escalation must not also pitch products or prices | ~USD 0.02 / run (estimate) | **not measured yet** |

Runs are saved to `evals/results/` (git-ignored); the reference run is in `evals/baseline/`.

## Cost

Prices verified on platform.claude.com/pricing on 2026-11-15 (`src/cost.ts`):

| model | input / MTok | output / MTok |
|---|---|---|
| Claude Haiku 5.5 (default) | USD 0.10 | USD 0.50 |
| Claude Sonnet 5.5 | USD 2.00 | USD 10.00 |
| Ollama (local) | USD 0 | USD 0 |

**Estimate, not yet measured:** a question takes 2 model calls (search, then answer), ~3,000–3,500 input
and ~300 output tokens → **≈ USD 0.0005 per query** on Haiku 5.5, ≈ USD 0.02 for a full eval run.
Embeddings run locally, so retrieval adds no API cost. Every real answer returns its measured `costUsd`;
this table will be replaced with measured numbers after the first layer-2 run.

## Known failures (from real runs)

1. **Vague intent → wrong products.** "algo para acampar con frío" returns a stove, a windbreaker and a
   chair, but not the −5 °C sleeping bag. The embedding matches *camping* and *cold* separately instead of
   the need ("sleep warm"). Phrasing it as "algo para dormir en la carpa cuando hace frío" works.
2. **Multi-product needs.** "empiezo natación, ¿qué necesito?" needs goggles **and** cap; top-5 brings
   goggles but not the cap. One query = one ranking; a "kit" question needs query decomposition.
3. **Out-of-catalog is barely separable by score.** e5 similarity scores are compressed: the best
   out-of-catalog match ("raquetas de tenis") scores 0.811 vs a 0.834 minimum for in-catalog questions.
   A 0.02 margin is too thin for a hard threshold, so escalation relies on the model reading the
   results — to be verified in layer 2.
4. **Price guard needs a currency marker.** A bare "79990" without `$`/`ARS`/"pesos" is not checked, to avoid
   flagging specs like "2000 mm". A hallucinated unmarked price would slip through.
5. **Price guard checks the set, not the pairing.** Allowed prices are the union of all retrieved products,
   so stating product A's real price for product B passes the guard.
6. **Citations are self-reported.** The model writes its own `CITED:` line; the guard checks the ids exist
   and flags a missing line, but not whether every product *named* in the text was cited.
7. **Prompt-cache marker is likely a no-op.** System prompt + tools are probably below Haiku's minimum
   cacheable prefix, and cache writes are counted at 1× input instead of 1.25×. Negligible at this size.
8. **Eval bias.** Cases were written by the same person who wrote the catalog; the first run scored 100 %
   until vaguer real-customer phrasings were added. Needs questions from real users.

## Roadmap

- v1.1: first measured layer-2 run on Haiku 5.5 (and Ollama for comparison); replace estimates above.
- v2: order status with identity verification (order number + email) as a safeguard; WhatsApp channel.
- Tiendanube adapter; deploy (Render/Fly free tier); simple chat UI.
- Next portfolio project builds on this store: a back-office agent with human approval (refunds, reviews).

## Stack

TypeScript (strict, ESM) · Node 24 · pnpm · Hono · Vitest · `@anthropic-ai/sdk` · `@huggingface/transformers`.
