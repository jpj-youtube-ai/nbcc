import { describe, it, expect } from "vitest";
import {
  selectDeclarationWording,
  hasFullLiabilityStatement,
  assertFullLiabilityStatement,
  wordingSnapshotSchema,
  SINGLE_DONATION_WORDING,
  ALL_DONATIONS_WORDING,
} from "../../src/declarations/wording";

// TASK-049 (REQ-040): the versioned, verbatim HMRC Gift Aid declaration wording +
// its selector and liability-statement validator. Pure / DB-free (no pool, config
// or clock), like src/db/donations-model.ts — unit-tested here without a DB. The
// selected { wording_version, wording_snapshot } is what a saved declaration
// records (the declarations columns, migration 1782923222001).

describe("selectDeclarationWording (REQ-040/REQ-044)", () => {
  it("selects the all-donations template for a monthly / enduring gift", () => {
    const w = selectDeclarationWording({ mode: "monthly", scope: "all_donations" });
    expect(w.wording_version).toBe(ALL_DONATIONS_WORDING.wording_version);
    // the multiple/all-donations declaration covers past + future gifts
    expect(w.wording_snapshot).toMatch(/past 4 years/i);
    expect(w.wording_snapshot).toMatch(/in the future/i);
  });

  it("selects the single-donation template for a one-off gift", () => {
    const w = selectDeclarationWording({ mode: "once", scope: "this_donation" });
    expect(w.wording_version).toBe(SINGLE_DONATION_WORDING.wording_version);
    expect(w.wording_snapshot).not.toMatch(/past 4 years/i);
  });

  it("treats a monthly gift as enduring even if scope says this_donation (REQ-041)", () => {
    const w = selectDeclarationWording({ mode: "monthly", scope: "this_donation" });
    expect(w.wording_version).toBe(ALL_DONATIONS_WORDING.wording_version);
  });

  it("returns exactly the declarations columns: wording_version + wording_snapshot", () => {
    const w = selectDeclarationWording({ mode: "once", scope: "this_donation" });
    expect(Object.keys(w).sort()).toEqual(["wording_snapshot", "wording_version"]);
    expect(typeof w.wording_version).toBe("string");
    expect(w.wording_version.length).toBeGreaterThan(0);
    expect(typeof w.wording_snapshot).toBe("string");
  });

  it("rejects an unknown mode or scope", () => {
    // @ts-expect-error invalid mode
    expect(() => selectDeclarationWording({ mode: "weekly", scope: "all_donations" })).toThrow();
    // @ts-expect-error invalid scope
    expect(() => selectDeclarationWording({ mode: "once", scope: "forever" })).toThrow();
  });
});

describe("liability statement validation (REQ-040)", () => {
  it("rejects a snapshot of just 'I am a UK taxpayer'", () => {
    expect(hasFullLiabilityStatement("I am a UK taxpayer")).toBe(false);
    expect(() => assertFullLiabilityStatement("I am a UK taxpayer")).toThrow();
    expect(wordingSnapshotSchema.safeParse("I am a UK taxpayer").success).toBe(false);
  });

  it("rejects a near-miss that names tax but omits the responsibility clause", () => {
    expect(hasFullLiabilityStatement("I am a UK taxpayer and I pay some Income Tax")).toBe(false);
  });

  it("accepts a snapshot containing the full liability paragraph", () => {
    const full =
      "I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital " +
      "Gains Tax than the amount of Gift Aid claimed on all my donations in that tax " +
      "year it is my responsibility to pay any difference.";
    expect(hasFullLiabilityStatement(full)).toBe(true);
    expect(() => assertFullLiabilityStatement(full)).not.toThrow();
    expect(wordingSnapshotSchema.safeParse(full).success).toBe(true);
  });

  it("both official templates carry the full liability statement", () => {
    for (const w of [SINGLE_DONATION_WORDING, ALL_DONATIONS_WORDING]) {
      expect(hasFullLiabilityStatement(w.wording_snapshot)).toBe(true);
      // and the taxpayer-responsibility markers HMRC requires
      expect(w.wording_snapshot).toMatch(/Income Tax/i);
      expect(w.wording_snapshot).toMatch(/Capital Gains Tax/i);
      expect(w.wording_snapshot).toMatch(/responsibility to pay/i);
    }
  });
});
