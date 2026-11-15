import { ask } from "./assistant.ts";
import { buildIndex, buildProvider } from "./bootstrap.ts";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: pnpm ask "¿tienen zapatillas para correr por menos de $80.000?"');
  process.exit(1);
}

const built = buildProvider();
if ("error" in built) {
  console.error(built.error);
  process.exit(1);
}

const index = await buildIndex();
const r = await ask(question, { provider: built.provider, index });

console.log(`\n${r.answer}\n`);
console.log(`citations: ${r.citations.join(", ") || "-"}`);
if (r.escalated) console.log(`escalated: yes (${r.escalationReason})`);
if (r.flags.length) console.log(`⚠ flags: ${r.flags.join(", ")}`);
console.log(`searches: ${r.searches.map((s) => `"${s.query}" ${JSON.stringify(s.filters)}`).join(" | ") || "-"}`);
console.log(
  `model: ${r.model} · tokens in/out: ${r.usage.inputTokens}/${r.usage.outputTokens} · cost: USD ${r.costUsd.toFixed(6)} · ${r.latencyMs} ms`,
);
