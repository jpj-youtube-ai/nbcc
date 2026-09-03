import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUTCOMES } from "../../src/outreach/model";
import {
  OUTCOME_LABELS,
  OUTCOME_MEANINGS,
  OUTCOME_ORDER,
  isDoNotContactOutcome,
  isEngagement,
  wantsAskAgainDate,
  suggestedAskAgain,
  isOutcome,
} from "../../src/outreach/outcomes";

// TASK-404: what each outcome means. The value of a richer list than yes/no is entirely in the
// middle states, and the middle states only pay off if the rules attached to them are right.

describe("every outcome is accounted for", () => {
  it.each(OUTCOMES)("%s has a label and a meaning", (outcome) => {
    expect(OUTCOME_LABELS[outcome], "label").toBeTruthy();
    expect(OUTCOME_MEANINGS[outcome], "meaning").toBeTruthy();
  });

  it("orders them best news first, silence last", () => {
    expect(OUTCOME_ORDER).toHaveLength(OUTCOMES.length);
    expect(new Set(OUTCOME_ORDER)).toEqual(new Set(OUTCOMES));
    expect(OUTCOME_ORDER[0]).toBe("signed_up");
    expect(OUTCOME_ORDER[OUTCOME_ORDER.length - 1]).toBe("no_reply");
  });

  // A volunteer choosing between "Interested" and "Asked for information" should not have to
  // guess. If a meaning just restates its label it is not doing anything.
  it("explains each one rather than restating it", () => {
    for (const outcome of OUTCOMES) {
      expect(OUTCOME_MEANINGS[outcome].length, outcome).toBeGreaterThan(
        OUTCOME_LABELS[outcome].length,
      );
    }
  });

  it("says nothing in block capitals", () => {
    for (const text of [...Object.values(OUTCOME_LABELS), ...Object.values(OUTCOME_MEANINGS)]) {
      expect(text).not.toMatch(/\b[A-Z]{3,}\b/);
    }
  });
});

describe("a decline is an instruction", () => {
  it("is the only outcome that puts a business out of reach", () => {
    const stopping = OUTCOMES.filter(isDoNotContactOutcome);
    expect(stopping).toEqual(["declined"]);
  });

  // The distinction the whole list exists for. "Not this year" is worth more than a decline, and
  // treating the two the same would throw away the better half of every no.
  it("does not treat not-this-year as a decline", () => {
    expect(isDoNotContactOutcome("not_this_year")).toBe(false);
  });
});

describe("what counts as the business engaging", () => {
  // This drives the call list and holds off the three-year purge, so silence must not count -
  // recording that we heard nothing is not contact, and would keep a dead record alive for ever.
  it("counts everything except silence", () => {
    expect(OUTCOMES.filter((o) => !isEngagement(o))).toEqual(["no_reply"]);
  });
});

describe("coming back to them later", () => {
  it("asks for a date only where one is owed", () => {
    expect(OUTCOMES.filter(wantsAskAgainDate)).toEqual(["not_this_year"]);
  });

  // Eleven months, not twelve: a business that said "not this year" in September is thinking
  // about next year's budget in August, so the ask should land slightly early rather than late.
  it("suggests a date just under a year out, on the first of the month", () => {
    const from = new Date("2026-09-03T10:00:00Z");
    expect(suggestedAskAgain(from)).toBe("2027-08-01");
  });

  it("rolls the year over correctly near December", () => {
    expect(suggestedAskAgain(new Date("2026-12-20T00:00:00Z"))).toBe("2027-11-01");
  });

  it("produces a date a date input accepts", () => {
    expect(suggestedAskAgain(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("what arrives in a request body", () => {
  it("accepts only the outcomes that exist", () => {
    expect(isOutcome("signed_up")).toBe(true);
    expect(isOutcome("maybe_later")).toBe(false);
    expect(isOutcome(null)).toBe(false);
    expect(isOutcome(7)).toBe(false);
  });
});

// The browser has its own copy of the labels, because the screen renders them without a
// round-trip. Two copies drift; this is the same guard the repo already puts on SECTIONS.
describe("the browser's copy matches", () => {
  const app = readFileSync(resolve(__dirname, "../../assets/js/admin/app.js"), "utf8");

  it.each(OUTCOMES)("%s reads the same in the admin as on the server", (outcome) => {
    expect(app).toContain(`${outcome}: "${OUTCOME_LABELS[outcome]}"`);
  });
});
