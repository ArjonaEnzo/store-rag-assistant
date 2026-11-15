import type { AskResult } from "../src/assistant.ts";

export type Case = {
  id: string;
  question: string;
  expectIds?: string[];
  /** Each entry must appear; "a|b" means any of the alternatives. Case/accent-insensitive. */
  mustMention?: string[];
  mustNotMention?: string[];
  shouldEscalate: boolean;
  tags: string[];
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Returns failure reasons; empty = pass. */
export function gradeAnswer(c: Case, r: Pick<AskResult, "answer" | "citations" | "escalated" | "flags">): string[] {
  const reasons: string[] = [];
  const text = fold(r.answer);
  if (r.escalated !== c.shouldEscalate) reasons.push(c.shouldEscalate ? "should_escalate" : "escalated_wrongly");
  if (!c.shouldEscalate) for (const id of c.expectIds ?? []) if (!r.citations.includes(id)) reasons.push(`missing_citation:${id}`);
  for (const m of c.mustMention ?? []) if (!m.split("|").some((alt) => text.includes(fold(alt)))) reasons.push(`missing_text:${m.split("|")[0]}`);
  for (const m of c.mustNotMention ?? []) if (text.includes(fold(m))) reasons.push(`forbidden_text:${m.trim()}`);
  reasons.push(...r.flags.map((f) => `guard:${f}`));
  return reasons;
}
