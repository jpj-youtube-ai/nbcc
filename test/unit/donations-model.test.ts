import { describe, it, expect } from "vitest";
import {
  donationInputSchema,
  buildDonationRow,
  deriveClaimStatus,
} from "../../src/db/donations-model";

// TASK-045 (REQ-036/REQ-037): the pure field-mapping / claim-eligibility logic of
// the unified donation model. These are DB-free (no pool, no config, no clock),
// per CLAUDE.md's "unit tests test pure functions / schemas" rule — the atomic
// write helper in src/db/donations.ts is exercised separately against a real DB.

describe("deriveClaimStatus (REQ-037)", () => {
  it("marks a company donation not_eligible, even with gift aid + a declaration", () => {
    expect(
      deriveClaimStatus({ donorType: "company", giftAid: true, hasDeclaration: true }),
    ).toBe("not_eligible");
  });

  it("marks an individual gift eligible only with gift aid AND an active declaration", () => {
    expect(
      deriveClaimStatus({ donorType: "individual", giftAid: true, hasDeclaration: true }),
    ).toBe("eligible");
  });

  it("is not_eligible for an individual without gift aid", () => {
    expect(
      deriveClaimStatus({ donorType: "individual", giftAid: false, hasDeclaration: true }),
    ).toBe("not_eligible");
  });

  it("is not_eligible for an individual with gift aid but no declaration covering it", () => {
    expect(
      deriveClaimStatus({ donorType: "individual", giftAid: true, hasDeclaration: false }),
    ).toBe("not_eligible");
  });

  it("is not_eligible once fully refunded, even when otherwise claimable", () => {
    expect(
      deriveClaimStatus({
        donorType: "individual",
        giftAid: true,
        hasDeclaration: true,
        fullyRefunded: true,
      }),
    ).toBe("not_eligible");
  });
});

describe("donationInputSchema", () => {
  const base = {
    donorType: "individual",
    mode: "once",
    amountPence: 5000,
    giftAid: true,
    declarationId: 7,
  };

  it("accepts a valid one-off gift and defaults currency/channel/plan", () => {
    const parsed = donationInputSchema.parse(base);
    expect(parsed.currency).toBe("GBP");
    expect(parsed.paymentChannel).toBe("online");
    expect(parsed.plan).toBeNull();
  });

  it("requires a plan for a monthly gift", () => {
    expect(donationInputSchema.safeParse({ ...base, mode: "monthly", plan: null }).success).toBe(
      false,
    );
    expect(
      donationInputSchema.safeParse({ ...base, mode: "monthly", plan: "gold" }).success,
    ).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    expect(donationInputSchema.safeParse({ ...base, amountPence: 0 }).success).toBe(false);
    expect(donationInputSchema.safeParse({ ...base, amountPence: -100 }).success).toBe(false);
  });

  it("rejects an unknown donor type or payment channel", () => {
    expect(donationInputSchema.safeParse({ ...base, donorType: "trust" }).success).toBe(false);
    expect(donationInputSchema.safeParse({ ...base, paymentChannel: "cash" }).success).toBe(false);
  });
});

describe("buildDonationRow", () => {
  const donorId = 42;

  it("maps an individual gift-aided gift to an eligible row (gift aid is a flag)", () => {
    const row = buildDonationRow(
      donationInputSchema.parse({
        donorType: "individual",
        mode: "monthly",
        plan: "silver",
        amountPence: 2500,
        giftAid: true,
        declarationId: 9,
        stripeSubscriptionId: "sub_123",
      }),
      donorId,
    );
    expect(row.donor_id).toBe(donorId);
    expect(row.declaration_id).toBe(9);
    expect(row.gift_aid).toBe(true);
    expect(row.claim_status).toBe("eligible");
    expect(row.plan).toBe("silver");
    expect(row.amount_pence).toBe(2500);
    expect(row.currency).toBe("GBP");
    expect(row.stripe_subscription_id).toBe("sub_123");
  });

  it("forces gift aid off, declaration null and not_eligible for a company donor", () => {
    const row = buildDonationRow(
      donationInputSchema.parse({
        donorType: "company",
        mode: "once",
        amountPence: 100000,
        giftAid: true, // even if a company ticks it, it can never be claimed
        declarationId: 9,
      }),
      donorId,
    );
    expect(row.gift_aid).toBe(false);
    expect(row.declaration_id).toBeNull();
    expect(row.claim_status).toBe("not_eligible");
  });

  it("normalises the currency to upper case", () => {
    const row = buildDonationRow(
      donationInputSchema.parse({ ...{ donorType: "individual", mode: "once", amountPence: 1000, giftAid: false }, currency: "gbp" }),
      donorId,
    );
    expect(row.currency).toBe("GBP");
  });
});
