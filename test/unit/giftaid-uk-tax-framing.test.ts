import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-127 (REQ-043): Gift Aid eligibility is paying UK tax (the verbatim HMRC
// liability statement), NOT a residency/postcode flag. The overseas-address
// checkbox is a matching detail only. Guard the framing shown to donors.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const OLD_FRAMING =
  "I live outside the UK (Channel Islands or Isle of Man), so I have no UK postcode.";
const DONOR_CHECKBOX =
  "I have no UK postcode, for example my home address is in the Channel Islands or Isle of Man.";
const PARTNER_CHECKBOX =
  "This partner has no UK postcode, for example a home address in the Channel Islands or Isle of Man.";
const TAX_NOTE =
  "Gift Aid depends on paying UK Income Tax or Capital Gains Tax, not on where you live";

describe("Gift Aid UK-tax framing (TASK-127)", () => {
  for (const page of ["gift-aid.html", "donate.html"]) {
    it(`${page} drops the old residency-eligibility framing`, () => {
      expect(read(page)).not.toContain(OLD_FRAMING);
    });
    it(`${page} carries the UK-taxpayer eligibility note`, () => {
      expect(read(page)).toContain(TAX_NOTE);
    });
    it(`${page} uses the address-as-matching-detail donor checkbox`, () => {
      expect(read(page)).toContain(DONOR_CHECKBOX);
    });
  }

  it("donate.html partner checkbox is address-only", () => {
    expect(read("donate.html")).toContain(PARTNER_CHECKBOX);
  });
});
