import { describe, it, expect } from "vitest";
import {
  benefitCapPence,
  deriveBenefitCapBreach,
  annualisePence,
  isRecognitionPerk,
  recordedBenefitValuePence,
  RECOGNITION_PERKS,
  AGGREGATE_MAX_CAP_PENCE,
} from "../../src/benefits/caps";

// TASK-067 (REQ-045) · TASK-132: the pure, DB-free HMRC donor-benefit cap logic. Since 6 April 2019
// the "relevant value test" is a single two-band sum: 25% of the first £100 + 5% of everything above
// £100, capped at £2,500 total (the pre-2019 three-tier rule is gone). Pure (no pool/config/clock),
// so it is unit-tested here without a DB; the transactional writer that persists benefits + flips
// donations.benefit_cap_breached is exercised DB-free in test/unit/donation-benefits.test.ts.

const pounds = (p: number) => p * 100; // £ → pence

describe("benefitCapPence — HMRC relevant value test (REQ-045 · TASK-132)", () => {
  it("at or below £100: 25% of the donation", () => {
    expect(benefitCapPence(pounds(80))).toBe(pounds(20)); // 25% of £80
    expect(benefitCapPence(pounds(40))).toBe(pounds(10)); // 25% of £40
    expect(benefitCapPence(0)).toBe(0);
    expect(benefitCapPence(pounds(100))).toBe(pounds(25)); // 25% of £100
  });

  it("above £100: 25% of the first £100 + 5% of the excess", () => {
    // just over £100: 5% of 1p floors to 0, so still £25
    expect(benefitCapPence(pounds(100) + 1)).toBe(pounds(25));
    expect(benefitCapPence(pounds(500))).toBe(pounds(25) + pounds(20)); // £25 + 5% of £400 = £45
    expect(benefitCapPence(pounds(1_000))).toBe(pounds(25) + pounds(45)); // £25 + 5% of £900 = £70
    expect(benefitCapPence(pounds(2_000))).toBe(pounds(25) + pounds(95)); // £25 + 5% of £1,900 = £120
  });

  it("gives the corrected annualised tier caps (Bronze/Silver/Gold/Platinum)", () => {
    expect(benefitCapPence(pounds(120))).toBe(pounds(26)); // Bronze £120/yr → £26
    expect(benefitCapPence(pounds(300))).toBe(pounds(35)); // Silver £300/yr → £35
    expect(benefitCapPence(pounds(600))).toBe(pounds(50)); // Gold   £600/yr → £50
    expect(benefitCapPence(pounds(1_200))).toBe(pounds(80)); // Platinum £1,200/yr → £80 (not £60)
  });

  it("caps the total at £2,500 however large the gift", () => {
    // £2,500 is reached at £49,100: £25 + 5% of £49,000 = £25 + £2,450 = £2,475 … so test past the cap.
    expect(benefitCapPence(pounds(60_000))).toBe(AGGREGATE_MAX_CAP_PENCE); // £25 + 5% of £59,900 = £3,020 → capped £2,500
    expect(benefitCapPence(pounds(200_000))).toBe(AGGREGATE_MAX_CAP_PENCE);
  });

  it("rejects a negative or non-integer donation", () => {
    expect(() => benefitCapPence(-1)).toThrow();
    expect(() => benefitCapPence(10.5)).toThrow();
  });
});

describe("deriveBenefitCapBreach — flags a breach only when the benefit exceeds the cap", () => {
  it("at/below £100: a benefit above 25% of the donation breaches; at/under does not", () => {
    const donation = pounds(80); // cap = £20
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(20) })).toBe(false);
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(20) + 1 })).toBe(true);
  });

  it("above £100: a benefit over the relevant-value cap breaches", () => {
    const donation = pounds(500); // cap = £25 + 5% of £400 = £45
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(45) })).toBe(false);
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: pounds(45) + 1 })).toBe(true);
  });

  it("a benefit over the £2,500 max breaches even on a huge donation", () => {
    const donation = pounds(200_000); // cap = £2,500 (aggregate max)
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: AGGREGATE_MAX_CAP_PENCE })).toBe(false);
    expect(deriveBenefitCapBreach({ annualisedDonationPence: donation, benefitValuePence: AGGREGATE_MAX_CAP_PENCE + 1 })).toBe(true);
  });
});

describe("annualisePence — a monthly gift is annualised ×12", () => {
  it("multiplies a monthly value by 12 and leaves a one-off unchanged", () => {
    expect(annualisePence("monthly", pounds(10))).toBe(pounds(120));
    expect(annualisePence("once", pounds(10))).toBe(pounds(10));
  });

  it("means a monthly gift is capped on its yearly total: £10/mo → £120/yr → £26 (Bronze)", () => {
    const annualDonation = annualisePence("monthly", pounds(10)); // £120/yr
    expect(benefitCapPence(annualDonation)).toBe(pounds(26)); // £25 + 5% of £20
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
