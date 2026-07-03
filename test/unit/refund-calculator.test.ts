import { describe, it, expect } from "vitest";
import {
  recalculateClaimOnRefund,
  RefundError,
  REFUND_RECEIPT_ACTIONS,
  type RefundInput,
} from "../../src/claims/refund";

// TASK-093 (REQ-037/REQ-063): the pure refund/dispute claim-recalculation calculator. DB-free
// (no pool/config/clock) per CLAUDE.md — mirrors test/unit/benefit-caps.test.ts and
// test/unit/subscription-dunning.test.ts.

// A gift-aided individual donation with an active declaration, £50, not yet claimed (eligible).
const eligibleIndividual = (overrides: Partial<RefundInput> = {}): RefundInput => ({
  donorType: "individual",
  giftAid: true,
  hasDeclaration: true,
  amountPence: 5000,
  refundedPence: 0,
  claimStatus: "eligible",
  ...overrides,
});

describe("recalculateClaimOnRefund — not-yet-claimed individual (REQ-037)", () => {
  it("recalculates a full refund to not_eligible", () => {
    const result = recalculateClaimOnRefund(eligibleIndividual({ refundedPence: 5000 }));
    expect(result.claimStatus).toBe("not_eligible");
    expect(result.adjustmentPence).toBe(0);
    expect(result.receiptAction).toBeNull();
  });

  it("re-derives eligibility from the retained amount on a partial refund (stays eligible)", () => {
    const result = recalculateClaimOnRefund(eligibleIndividual({ refundedPence: 2000 }));
    // £30 retained, still gift-aided + declared → eligible; nothing claimed yet, so no adjustment.
    expect(result.claimStatus).toBe("eligible");
    expect(result.adjustmentPence).toBe(0);
  });

  it("keeps a non-gift-aided / undeclared gift not_eligible on a partial refund", () => {
    expect(recalculateClaimOnRefund(eligibleIndividual({ giftAid: false, claimStatus: "not_eligible", refundedPence: 1000 })).claimStatus).toBe("not_eligible");
    expect(recalculateClaimOnRefund(eligibleIndividual({ hasDeclaration: false, claimStatus: "not_eligible", refundedPence: 1000 })).claimStatus).toBe("not_eligible");
  });
});

describe("recalculateClaimOnRefund — already claimed/batched (REQ-063)", () => {
  it("flags adjustment_due with the refunded portion for a batched donation (full refund)", () => {
    const result = recalculateClaimOnRefund(eligibleIndividual({ claimStatus: "batched", refundedPence: 5000 }));
    expect(result.claimStatus).toBe("adjustment_due");
    expect(result.adjustmentPence).toBe(5000); // the refunded portion of the already-claimed amount
    expect(result.receiptAction).toBeNull();
  });

  it("flags adjustment_due with the refunded portion for a claimed donation (partial refund)", () => {
    const result = recalculateClaimOnRefund(eligibleIndividual({ claimStatus: "claimed", refundedPence: 2000 }));
    expect(result.claimStatus).toBe("adjustment_due");
    expect(result.adjustmentPence).toBe(2000);
  });
});

describe("recalculateClaimOnRefund — company (REQ-053)", () => {
  const company = (overrides: Partial<RefundInput> = {}): RefundInput => ({
    donorType: "company",
    giftAid: false,
    hasDeclaration: false,
    amountPence: 100000,
    refundedPence: 0,
    claimStatus: "not_eligible",
    ...overrides,
  });

  it("returns a 'void' receipt action on a full refund, claim_status untouched", () => {
    const result = recalculateClaimOnRefund(company({ refundedPence: 100000 }));
    expect(result.receiptAction).toBe("void");
    expect(result.claimStatus).toBe("not_eligible"); // untouched — companies never claim
    expect(result.adjustmentPence).toBe(0);
  });

  it("returns a 'correct' receipt action on a partial refund, claim_status untouched", () => {
    const result = recalculateClaimOnRefund(company({ refundedPence: 40000 }));
    expect(result.receiptAction).toBe("correct");
    expect(result.claimStatus).toBe("not_eligible");
    expect(REFUND_RECEIPT_ACTIONS).toContain(result.receiptAction);
  });
});

describe("recalculateClaimOnRefund — invalid input", () => {
  it("throws RefundError when the refund exceeds the donation amount", () => {
    expect(() => recalculateClaimOnRefund(eligibleIndividual({ refundedPence: 6000 }))).toThrow(RefundError);
  });

  it("rejects a malformed input via schema validation", () => {
    // A negative refund / non-integer amount is rejected before the calculation runs.
    expect(() => recalculateClaimOnRefund(eligibleIndividual({ refundedPence: -1 }))).toThrow();
    expect(() => recalculateClaimOnRefund(eligibleIndividual({ amountPence: 0 }))).toThrow();
  });
});
