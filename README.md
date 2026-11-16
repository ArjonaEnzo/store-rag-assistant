# store-rag-assistant

A grounded shopping assistant for e-commerce catalogs (WooCommerce first). It answers customer
questions in Spanish, **cites the products it used**, **refuses to invent prices**, **hands off to a
human** when the catalog can't answer, and reports **tokens, cost and latency per query**. An eval suite
turns "seems to work" into a number — and the number drove the fixes below.

> Status (2026-11-16): v1, catalog questions only. Measured end-to-end on a free model
> (Groq · `openai/gpt-oss-120b`): **97.1 % of 35 eval cases pass, in two consecutive runs**, up from
> 65.7 % on the first run. Not yet measured on Claude (needs paid API credits).

## Results

| run | change | answer pass rate | escalation accuracy |
|---|---|---|---|
| 1 | baseline | 65.7 % (23/35) | 80.0 % |
| 2 | removed `category` filter from the tool | 88.6 % (31/35)¹ | 97.0 % |
| 3 | removed `in_stock` filter; accept `null` optional args | **97.1 % (34/35)** | 100 % |
| 4 | same code as run 3 (variance check) | **97.1 % (34/35)** | 100 % |

¹ Run 2 also surfaced 2 hard errors (Groq rejected tool calls with `max_price: null`), fixed for run 3.
Reports: `evals/baseline/`.

**What the first run taught (from the traces, not guesses):**
- 7 of 12 failures: the model **guessed a category** ("soga" → Accesorios) and the hard filter excluded
  the right product. Product type is semantics — the embedding already handles it. Removed the filter.
- 3 failures: the model added **`in_stock: true` unasked**, hiding the out-of-stock product the customer
  asked about. Stock now travels with every result and the model states it.
- 1 guard bug: "$10 000" (space as thousands separator) was parsed as 10. Fixed + test.

Lesson: every filter the model chooses is a way to exclude the truth. Keep model-chosen filters to
exact constraints the customer actually stated (price).

## How it works

```
question ──► LLM (Groq/Gemini free · Claude · Ollama) ──tool call──► search_products(query, max_price, min_price)
                │                                                    │  local multilingual embeddings (e5-small, CPU, free)
                │                                                    │  + exact price filters
                │◄──────────── <catalog_data> top-5 products ────────┘  (escaped, wrapped as data, never instructions)
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
- **Provider-agnostic.** `LlmProvider` has three implementations: Claude (official SDK), any
  OpenAI-compatible API (Groq, Gemini, OpenRouter — plain `fetch`, retries on 429), and Ollama.
  Switching model is one env var; the same evals measure each.
- **Guards in code, not only in the prompt.** The prompt asks for grounding; the guards *check* it.
- **No framework.** The whole loop is ~170 lines in `src/assistant.ts`, on purpose.

Demo data: a fictional Argentine sports store, 59 products, ARS prices, WooCommerce REST shape
(`scripts/build-seed.ts`). One product description contains a prompt-injection attempt on purpose.

## Run it

```bash
pnpm install
pnpm test                       # 51 unit tests, no network
pnpm eval --retrieval-only      # retrieval evals, free (first run downloads the ~120 MB embedding model)
```

Then put **one** key in a local `.env` (see `.env.example`; the first key found wins: Claude > Groq > Gemini):

```bash
pnpm ask "¿tienen zapatillas para correr por menos de $80.000?"
pnpm eval                       # retrieval + full answers; --only id1,id2 to re-run some cases
pnpm start                      # POST /ask {"question": "..."} · GET /health
```

Free options: **Groq** (console.groq.com, no card), **Gemini** free tier (aistudio.google.com), or
**Ollama** locally (`LLM_PROVIDER=ollama`). Note: a Claude Pro/Max subscription does not include API credits.

## Evals

`evals/cases.jsonl` — 35 cases: catalog lookups, exact price filters, out-of-stock, out-of-catalog and
service questions that must escalate, a prompt-injection product, and 5 deliberately vague "hard" queries.

| layer | what it measures | cost | result |
|---|---|---|---|
| 1 · retrieval | expected product in top-5 of semantic search (no LLM) | USD 0 | **93.1 %** (27/29) |
| 2 · answers | cites expected products, mentions required facts, no forbidden text, no guard flags, escalates iff it should — and an escalation must not also pitch products or prices | USD 0 on Groq free tier | **97.1 %** (34/35), 2 runs |

## Cost and latency

Measured on Groq (runs 3–4): **~725–845 uncached input + ~290 output tokens per question** (2–3 model calls).

| model | price (input / output per MTok) | cost per question |
|---|---|---|
| Groq `openai/gpt-oss-120b`, free tier | — | **USD 0** (limits: 1,000 requests/day, 8,000 tokens/min on this account) |
| Claude Haiku 5.5 (same token counts) | USD 0.10 / 0.50 | **≈ USD 0.00023–0.00025** — approximation: tokenizers differ, not measured on Claude |

Claude prices verified on platform.claude.com/pricing on 2026-11-15. Retrieval adds no API cost (local embeddings).

**Latency on the free tier is dominated by rate limiting:** fastest answer 1.5 s, median 6.8 s, worst 543 s
(waiting for the 8K tokens/minute window). A full 35-case run takes 5–20 minutes. Paid tiers remove this.

## Known failures

1. **Vague intent → wrong products.** "algo para acampar con frío" never retrieves the −5 °C sleeping bag
   (stove, windbreaker, chair instead). This is the one remaining eval failure.
2. **Regional vocabulary.** The model rewrote "¿qué me pongo arriba si llueve?" as "*chaqueta* running
   lluvia"; the catalog says "*campera* rompeviento repelente al agua" and the search missed it once.
3. **Ungrounded side claims pass the guards.** A real answer added "disponibles para envío inmediato" —
   not in the data. Guards check products and prices, not every claim. Needs an LLM-judge or stricter prompt.
4. **Multi-product needs.** "empiezo natación, ¿qué necesito?" needs goggles **and** cap; one query = one
   ranking. A "kit" question needs query decomposition.
5. **Out-of-catalog is barely separable by score.** e5 scores are compressed: best out-of-catalog match
   0.811 vs 0.834 minimum in-catalog. Escalation relies on the model reading the results (100 % in runs 3–4).
6. **Run-to-run variance.** The same case flipped between runs with no code change; results are reported
   over two runs. 35 cases is a small sample: one case = 2.9 points.
7. **Price guard limits.** Needs a currency marker (`$`, `ARS`, "pesos") — a bare "79990" isn't checked; and it
   checks the set of retrieved prices, not the pairing, so product A's price stated for product B passes.
8. **Citations are self-reported.** The guard checks cited ids exist and flags a missing `CITED:` line, but
   not whether every product *named* in the text was cited.
9. **Eval bias.** Cases were written by the same person who wrote the catalog; the first retrieval run scored
   100 % until vaguer phrasings were added. Needs questions from real customers.

## Roadmap

- Measure on Claude Haiku 5.5 and Gemini with the same suite (provider is one env var).
- v2: order status with identity verification (order number + email) as a safeguard; WhatsApp channel.
- Tiendanube adapter; deploy (Render/Fly free tier); simple chat UI.
- Next portfolio project builds on this store: a back-office agent with human approval (refunds, reviews).

## Stack

TypeScript (strict, ESM) · Node 24 · pnpm · Hono · Vitest · `@anthropic-ai/sdk` · `@huggingface/transformers`.
