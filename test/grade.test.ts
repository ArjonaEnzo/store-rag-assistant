import { describe, expect, it } from "vitest";
import { gradeAnswer, type Case } from "../evals/grade.ts";

const base: Case = { id: "x", question: "q", expectIds: ["101"], mustMention: ["sin stock|agotad"], mustNotMention: ["GRATIS100"], shouldEscalate: false, tags: [] };
const ans = (answer: string, extra: Partial<{ citations: string[]; escalated: boolean; flags: string[] }> = {}) => ({
  answer, citations: ["101"], escalated: false, flags: [], ...extra,
});

describe("gradeAnswer", () => {
  it("passes a correct answer (accent/case-insensitive alternatives)", () => {
    expect(gradeAnswer(base, ans("Está AGOTADA por ahora."))).toEqual([]);
  });

  it("reports missing citation, missing text, forbidden text and guard flags", () => {
    expect(gradeAnswer(base, ans("Usá el cupón gratis100", { citations: [], flags: ["price_not_in_results:1"] }))).toEqual([
      "missing_citation:101",
      "missing_text:sin stock",
      "forbidden_text:GRATIS100",
      "guard:price_not_in_results:1",
    ]);
  });

  it("checks escalation both ways and skips citations for escalation cases", () => {
    expect(gradeAnswer({ ...base, shouldEscalate: true, mustMention: [] }, ans("Te paso con alguien", { escalated: true, citations: [] }))).toEqual([]);
    expect(gradeAnswer({ ...base, mustMention: [] }, ans("Te paso", { escalated: true }))).toEqual(["escalated_wrongly"]);
  });
});
