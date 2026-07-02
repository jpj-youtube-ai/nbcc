import { describe, it, expect } from "vitest";
import {
  benefitCapPence,
  deriveBenefitCapBreach,
  annualisePence,
  isRecognitionPerk,
  recordedBenefitValuePence,
  RECOGNITION_PERKS,
  TIER2_FLAT_CAP_PENCE,
  TIER3_MAX_CAP_PENCE,
} from "../../src/benefits/caps";

// TASK-067 (REQ-045): the pure, DB-free HMRC donor-benefit cap logic. Pure like
// src/db/donations-model.ts (no pool/config/clock), so it is unit-tested here without a
// DB. Proves the three tiers at their boundaries and the breach decision; the
// transactional writer that persists benefits + flips donations.benefit_cap_breached is
// exercised DB-free against a mocked pool in test/unit/donation-benefits.test.ts.

const pounds = (p: number) => p * 100; // £ → pence

describe("benefitCapPence — HMRC tiered donor-benefit caps (REQ-045)", () => {
  it("tier 1: donation ≤ £100 is capped at 25% of the donation", () => {
    expect(benefitCapPence(pounds(80))).toBe(pounds(20)); // 25% of £80
    expect(benefitCapPence(pounds(40))).toBe(pounds(10)); // 25% of £40
    expect(benefitCapPence(0)).toBe(0);
  });

  it("tier 1/2 boundary: exactly £100 caps at £25 (25% = the flat £25)", () => {
    expect(benefitCapPence(pounds(100))).toBe(pounds(25));
    expect(benefitCapPence(pounds(100))).toBe(TIER2_FLAT_CAP_PENCE);
  });

  it("tier 2: £100 < donation ≤ £1,000 is capped at a flat £25", () => {
    expect(benefitCapPence(pounds(100) + 1)).toBe(TIER2_FLAT_CAP_PENCE); // £100.01
    expect(benefitCapPence(pounds(500))).toBe(TIER2_FLAT_CAP_PENCE);
    expect(benefitCapPence(pounds(1_000))).toBe(TIER2_FLAT_CAP_PENCE); // upper boundary
  });

  it("tier 3: donation > £1,000 is capped at 5% of the donation", () => {
    expect(benefitCapPence(pounds(1_000) + 1)).toBe(Math.floor((pounds(1_000) + 1) * 0.05)); // just over £1,000
    expect(benefitCapPence(pounds(2_000))).toBe(pounds(100)); // 5% of £2,000
    expect(benefitCapPence(pounds(10_000))).toBe(pounds(500)); // 5% of £10,000
  });

  it("tier 3: the 5% cap is itself capped at a £2,500 maximum", () => {
    expect(benefitCapPence(pounds(50_000))).toBe(TIER3_MAX_CAP_PENCE); // 5% of £50,000 = £2,500 exactly
    expect(benefitCapPence(pounds(200_000))).toBe(TIER3_MAX_CAP_PENCE); // 5% would be £10,000 → capped
  });

  it("rejects a negative or non-integer donation", () => {
    expect(() => benefitCapPence(-1)).toThrow();
    expect(() => benefitCapPence(10.5)).toThrow();
  });
});

describe("deriveBenefitCapBreach — flags a breach only when the benefit exceeds the cap", () => {
  it("tier 1: a benefit above 25% of the donation breaches; at/under does not", () => {
    const donation = pounds(80); // cap = £20
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(20) })).toBe(false);
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(20) + 1 })).toBe(true);
  });

  it("tier 2: a benefit over the flat £25 breaches", () => {
    const donation = pounds(500); // cap = £25
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(25) })).toBe(false);
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(25) + 1 })).toBe(true);
  });

  it("tier 3: a benefit over the £2,500 max breaches even on a huge donation", () => {
    const donation = pounds(200_000); // cap = £2,500 (5% capped)
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: TIER3_MAX_CAP_PENCE })).toBe(false);
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: TIER3_MAX_CAP_PENCE + 1 })).toBe(true);
  });
});

describe("annualisePence — a monthly gift is annualised ×12", () => {
  it("multiplies a monthly value by 12 and leaves a one-off unchanged", () => {
    expect(annualisePence("monthly", pounds(10))).toBe(pounds(120));
    expect(annualisePence("once", pounds(10))).toBe(pounds(10));
  });

  it("means a monthly gift is banded on its yearly total: £10/mo → £120/yr → tier 2 flat £25 cap", () => {
    const annualDonation = annualisePence("monthly", pounds(10)); // £120/yr
    expect(benefitCapPence(annualDonation)).toBe(TIER2_FLAT_CAP_PENCE);
  });
});

describe("recognition perks are always recorded at £0 (REQ-045)", () => {
  it("recognises exactly the five seeded perk names", () => {
    expect([...RECOGNITION_PERKS]).toEqual([
      "name-on-page",
      "impact update",
      "social thank-you",
      "digital badge",
      "certificate",
    ]);
    for (const name of RECOGNITION_PERKS) expect(isRecognitionPerk(name)).toBe(true);
    expect(isRecognitionPerk("gala dinner")).toBe(false);
  });

  it("forces a recognition perk's value to £0 regardless of admin input, but keeps other values", () => {
    expect(recordedBenefitValuePence({ name: "digital badge", valuePence: pounds(50) })).toBe(0);
    expect(recordedBenefitValuePence({ name: "name-on-page", valuePence: 999 })).toBe(0);
    expect(recordedBenefitValuePence({ name: "gala dinner", valuePence: pounds(50) })).toBe(pounds(50));
  });
});
