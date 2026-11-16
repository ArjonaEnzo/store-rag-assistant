/**
 * Eval runner. Layer 1 (retrieval hit@5) always runs and costs nothing.
 * Layer 2 (full answers) runs when an LLM provider is configured; it spends API money with Claude.
 *   pnpm eval            → both layers if a provider is available
 *   pnpm eval --retrieval-only
 *   pnpm eval --only esc-raqueta,lookup-carpa
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ask, type AskResult } from "../src/assistant.ts";
import { buildIndex, buildProvider } from "../src/bootstrap.ts";
import { costUsd } from "../src/cost.ts";
import type { ProductIndex } from "../src/retrieval/index.ts";
import { gradeAnswer, type Case } from "./grade.ts";

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

async function retrievalLayer(cases: Case[], index: ProductIndex) {
  const rows = [];
  for (const c of cases) {
    const hits = await index.search(c.question, {}, 5);
    const ids = hits.map((h) => h.product.id);
    rows.push({
      id: c.id,
      shouldEscalate: c.shouldEscalate,
      topScore: hits[0]?.score ?? 0,
      top5: ids,
      hit: c.expectIds ? c.expectIds.every((id) => ids.includes(id)) : null,
    });
  }
  return rows;
}

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only"))?.split("=")[1] ?? (args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined);
const retrievalOnly = args.includes("--retrieval-only");

const all = (await readFile("evals/cases.jsonl", "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Case);
const cases = only ? all.filter((c) => only.split(",").includes(c.id)) : all;
const index = await buildIndex();

// ---- Layer 1: retrieval
const retrieval = await retrievalLayer(cases, index);
const scored = retrieval.filter((r) => r.hit !== null);
const hits = scored.filter((r) => r.hit).length;
const inScores = retrieval.filter((r) => !r.shouldEscalate).map((r) => r.topScore);
const outScores = retrieval.filter((r) => r.shouldEscalate && cases.find((c) => c.id === r.id)?.tags.includes("out-of-catalog")).map((r) => r.topScore);

console.log(`\n== Layer 1 · retrieval (local embeddings, no LLM, USD 0) ==`);
console.log(`hit@5: ${hits}/${scored.length} = ${pct(hits, scored.length)}`);
for (const r of scored.filter((r) => !r.hit)) console.log(`  miss ${r.id}: top5=${r.top5.join(",")}`);
if (outScores.length)
  console.log(
    `top score · in-catalog min ${Math.min(...inScores).toFixed(3)} / median ${median(inScores).toFixed(3)} · out-of-catalog max ${Math.max(...outScores).toFixed(3)}`,
  );

// ---- Layer 2: answers
type Row = { id: string; pass: boolean; reasons: string[]; result: AskResult };
const answers: Row[] = [];
const built = buildProvider();
let skipped: string | undefined;
if (retrievalOnly) skipped = "--retrieval-only";
else if ("error" in built) skipped = built.error;
else {
  console.log(`\n== Layer 2 · answers (${built.provider.model}) ==`);
  for (const c of cases) {
    try {
      const result = await ask(c.question, { provider: built.provider, index });
      const reasons = gradeAnswer(c, result);
      answers.push({ id: c.id, pass: reasons.length === 0, reasons, result });
      console.log(`${reasons.length ? "FAIL" : "pass"}  ${c.id.padEnd(22)} ${reasons.join(" ")}`);
    } catch (err) {
      console.log(`ERR   ${c.id.padEnd(22)} ${(err as Error).message}`);
      answers.push({ id: c.id, pass: false, reasons: [`error:${(err as Error).message}`], result: undefined as never });
    }
  }
}

const ok = answers.filter((a) => a.result);
const passN = answers.filter((a) => a.pass).length;
const escCases = ok.filter((a) => cases.find((c) => c.id === a.id)!.shouldEscalate);
const escOk = ok.filter((a) => a.result.escalated === cases.find((c) => c.id === a.id)!.shouldEscalate).length;
const costs = ok.map((a) => a.result.costUsd);
const lat = ok.map((a) => a.result.latencyMs);
const totalCost = costs.reduce((s, x) => s + x, 0);
// Same token counts priced as Claude Haiku 5.5 — an approximation (tokenizers differ), shown so free runs still
// answer "what would this cost on a paid model?".
const haikuEquiv = ok.reduce((s, a) => s + costUsd("claude-haiku-5-5", a.result.usage), 0);
const avgTokens = ok.length
  ? { in: Math.round(ok.reduce((s, a) => s + a.result.usage.inputTokens, 0) / ok.length), out: Math.round(ok.reduce((s, a) => s + a.result.usage.outputTokens, 0) / ok.length) }
  : { in: 0, out: 0 };

const summary = {
  date: new Date().toISOString(),
  cases: cases.length,
  retrieval: { hitAt5: hits, scored: scored.length, rate: scored.length ? hits / scored.length : null },
  answers: skipped
    ? { skipped }
    : {
        model: "provider" in built ? built.provider.model : null,
        pass: passN,
        total: answers.length,
        rate: answers.length ? passN / answers.length : null,
        escalationAccuracy: ok.length ? escOk / ok.length : null,
        escalationCases: escCases.length,
        totalCostUsd: totalCost,
        avgCostUsd: ok.length ? totalCost / ok.length : null,
        avgTokensPerQuery: avgTokens,
        haikuEquivalentAvgCostUsd: ok.length ? haikuEquiv / ok.length : null,
        p50LatencyMs: median(lat),
        flagged: ok.filter((a) => a.result.flags.length).map((a) => ({ id: a.id, flags: a.result.flags })),
      },
};

console.log(`\n== Summary ==`);
console.log(`retrieval hit@5      ${pct(hits, scored.length)} (${hits}/${scored.length})`);
if (skipped) console.log(`answers              skipped: ${skipped}`);
else {
  console.log(`answer pass rate     ${pct(passN, answers.length)} (${passN}/${answers.length})`);
  console.log(`escalation accuracy  ${pct(escOk, ok.length)}`);
  console.log(`cost                 total USD ${totalCost.toFixed(4)} · avg USD ${(ok.length ? totalCost / ok.length : 0).toFixed(6)}/query`);
  console.log(`tokens / query       in ${avgTokens.in} · out ${avgTokens.out} (≈ USD ${(ok.length ? haikuEquiv / ok.length : 0).toFixed(6)}/query if priced as Haiku 5.5)`);
  console.log(`latency              p50 ${median(lat)} ms`);
  const rl = "provider" in built ? (built.provider as { lastRateLimit?: Record<string, string> }).lastRateLimit : undefined;
  if (rl && Object.keys(rl).length) console.log(`rate limits (last)   ${Object.entries(rl).map(([k, v]) => `${k.replace("x-ratelimit-", "")}=${v}`).join(" ")}`);
}

await mkdir("evals/results", { recursive: true });
const stamp = summary.date.replace(/[:.]/g, "-");
await writeFile(`evals/results/${stamp}.json`, JSON.stringify({ summary, retrieval, answers }, null, 2));
const md = [
  `# Eval run ${summary.date}`,
  ``,
  `| metric | value |`,
  `|---|---|`,
  `| retrieval hit@5 | ${pct(hits, scored.length)} (${hits}/${scored.length}) |`,
  ...(skipped
    ? [`| answers | skipped: ${skipped} |`]
    : [
        `| model | ${summary.answers && "model" in summary.answers ? summary.answers.model : ""} |`,
        `| answer pass rate | ${pct(passN, answers.length)} (${passN}/${answers.length}) |`,
        `| escalation accuracy | ${pct(escOk, ok.length)} |`,
        `| avg cost / query | USD ${(ok.length ? totalCost / ok.length : 0).toFixed(6)} |`,
        `| total cost (run) | USD ${totalCost.toFixed(4)} |`,
        `| avg tokens / query | in ${avgTokens.in} · out ${avgTokens.out} |`,
        `| ≈ cost / query if priced as Haiku 5.5 | USD ${(ok.length ? haikuEquiv / ok.length : 0).toFixed(6)} |`,
        `| p50 latency | ${median(lat)} ms |`,
      ]),
  ``,
  `## Failures`,
  ...scored.filter((r) => !r.hit).map((r) => `- retrieval miss \`${r.id}\` (top5: ${r.top5.join(", ")})`),
  ...answers.filter((a) => !a.pass).map((a) => `- answer fail \`${a.id}\`: ${a.reasons.join(", ")}${a.result ? ` — "${a.result.answer.slice(0, 160).replace(/\n/g, " ")}"` : ""}`),
].join("\n");
await writeFile(`evals/results/${stamp}.md`, md + "\n");
console.log(`\nsaved evals/results/${stamp}.{json,md}`);
