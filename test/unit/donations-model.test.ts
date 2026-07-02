import { describe, it, expect } from "vitest";
import {
  donationInputSchema,
  buildDonationRow,
  deriveClaimStatus,
  batchAssignmentBlock,
  isPubliclyListable,
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

describe("batchAssignmentBlock (REQ-037 — the claim invariant + one batch)", () => {
  it("returns null (assignable) for an eligible donation not yet in a batch", () => {
    expect(batchAssignmentBlock({ claimStatus: "eligible", claimBatchId: null })).toBeNull();
  });

  it("blocks a donation already in a batch as 'already_batched' (one-batch-per-donation)", () => {
    // A batched donation carries claim_status 'batched' AND a non-null claim_batch_id;
    // the non-null FK is checked first, so re-assignment is reported as already_batched.
    expect(batchAssignmentBlock({ claimStatus: "batched", claimBatchId: 7 })).toBe("already_batched");
  });

  it("blocks a claim-ineligible donation as 'not_eligible' even when unbatched", () => {
    expect(batchAssignmentBlock({ claimStatus: "not_eligible", claimBatchId: null })).toBe(
      "not_eligible",
    );
  });

  it("blocks an eligible donation that somehow already has a batch id as 'already_batched'", () => {
    // The FK guard wins over the status guard, so a stale eligible+batched row still can't
    // be double-assigned.
    expect(batchAssignmentBlock({ claimStatus: "eligible", claimBatchId: 3 })).toBe(
      "already_batched",
    );
  });
});

describe("isPubliclyListable (REQ-039 — anonymous donors are never shown publicly)", () => {
  it("is false for an anonymous donor (pulled through to payment, never shown publicly)", () => {
    expect(isPubliclyListable({ anonymous: true })).toBe(false);
  });

  it("is true for a donor who did not opt to be anonymous", () => {
    expect(isPubliclyListable({ anonymous: false })).toBe(true);
  });

  it("defaults to listable when anonymity is unset", () => {
    expect(isPubliclyListable({})).toBe(true);
  });
});

describe("REQ-041 — amount, frequency and currency are captured on the donation", () => {
  it("carries amount_pence, mode (frequency) and an explicit GBP currency onto the row", () => {
    const row = buildDonationRow(
      donationInputSchema.parse({
        donorType: "individual",
        mode: "monthly",
        plan: "gold",
        amountPence: 5000,
        giftAid: false,
      }),
      99,
    );
    expect(row.amount_pence).toBe(5000);
    expect(row.mode).toBe("monthly"); // frequency
    expect(row.currency).toBe("GBP"); // captured explicitly, defaulting to GBP
  });

  it("preserves a one-off's amount and defaults its currency to GBP", () => {
    const row = buildDonationRow(
      donationInputSchema.parse({ donorType: "individual", mode: "once", amountPence: 2500, giftAid: false }),
      99,
    );
    expect(row.amount_pence).toBe(2500);
    expect(row.mode).toBe("once");
    expect(row.currency).toBe("GBP");
  });
});
