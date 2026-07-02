import { describe, it, expect } from "vitest";
import {
  isGasdsEligibleAmount,
  gasdsPoolLimitPence,
  GASDS_SMALL_DONATION_MAX_PENCE,
  GASDS_ANNUAL_CEILING_PENCE,
  GASDS_TOP_UP_CAP_PENCE,
} from "../../src/gasds/caps";

// TASK-077 (REQ-058): the pure GASDS eligibility + pool-limit logic. DB-free (no
// pool/config/clock) per CLAUDE.md — mirrors test/unit/benefit-caps.test.ts.

describe("isGasdsEligibleAmount", () => {
  const small = { hasDeclaration: false, giftAid: false };

  it("is eligible for a £25 undeclared, non-Gift-Aided (card-present) gift", () => {
    expect(isGasdsEligibleAmount(2500, small)).toBe(true);
  });

  it("is eligible at exactly the £30 small-donation ceiling", () => {
    expect(isGasdsEligibleAmount(GASDS_SMALL_DONATION_MAX_PENCE, small)).toBe(true);
    expect(isGasdsEligibleAmount(3000, small)).toBe(true);
  });

  it("is NOT eligible for a £50 gift (above the £30 ceiling)", () => {
    expect(isGasdsEligibleAmount(5000, small)).toBe(false);
    expect(isGasdsEligibleAmount(3001, small)).toBe(false);
  });

  it("is NOT eligible for a Gift-Aided gift, even a small one (never claimed under both)", () => {
    expect(isGasdsEligibleAmount(2500, { hasDeclaration: false, giftAid: true })).toBe(false);
  });

  it("is NOT eligible when a declaration is held (that gift goes the Gift Aid route)", () => {
    expect(isGasdsEligibleAmount(2500, { hasDeclaration: true, giftAid: false })).toBe(false);
  });

  it("is NOT eligible for a £0 (non) gift", () => {
    expect(isGasdsEligibleAmount(0, small)).toBe(false);
  });
});

describe("gasdsPoolLimitPence — the binding (lowest) of the three caps", () => {
  it("returns the minimum of the three ceilings when nothing is claimed yet", () => {
    // Large Gift Aid → 10× cap is huge, so the £2,000 top-up component binds.
    const remaining = gasdsPoolLimitPence({
      smallDonationsClaimedPenceThisYear: 0,
      giftAidClaimedPenceThisYear: 1_000_000, // £10,000 → 10× = £100,000
    });
    expect(remaining).toBe(GASDS_TOP_UP_CAP_PENCE); // £2,000 binds
  });

  it("binds on the 10× Gift Aid cap when it falls BELOW £8,000", () => {
    // £150 Gift Aid claimed → 10× = £1,500, below both the £8,000 and £2,000 figures.
    const remaining = gasdsPoolLimitPence({
      smallDonationsClaimedPenceThisYear: 0,
      giftAidClaimedPenceThisYear: 15_000, // £150 → 10× = £1,500
    });
    expect(remaining).toBe(150_000); // £1,500
    expect(remaining).toBeLessThan(GASDS_ANNUAL_CEILING_PENCE);
    expect(remaining).toBeLessThan(GASDS_TOP_UP_CAP_PENCE);
  });

  it("subtracts what has already been claimed from the binding ceiling", () => {
    const remaining = gasdsPoolLimitPence({
      smallDonationsClaimedPenceThisYear: 50_000, // £500 already claimed
      giftAidClaimedPenceThisYear: 1_000_000, // top-up (£2,000) binds
    });
    expect(remaining).toBe(GASDS_TOP_UP_CAP_PENCE - 50_000); // £1,500 left
  });

  it("never returns a negative headroom once the pool is exhausted", () => {
    const remaining = gasdsPoolLimitPence({
      smallDonationsClaimedPenceThisYear: 500_000, // £5,000, past the £2,000 binding cap
      giftAidClaimedPenceThisYear: 1_000_000,
    });
    expect(remaining).toBe(0);
  });
});
