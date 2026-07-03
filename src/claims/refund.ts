import { z } from "zod";
import {
  DONOR_TYPES,
  CLAIM_STATUSES,
  deriveClaimStatus,
  type ClaimStatus,
} from "../db/donations-model";

// Pure, DB-free refund/dispute claim-recalculation calculator (REQ-037/REQ-063). When a donation
// is refunded or disputed, its Gift Aid claim state must be recomputed. NO pool/config/clock —
// importing this file touches nothing external, so it is unit-tested DB-free like
// src/db/donations-model.ts, src/benefits/caps.ts and src/subscriptions/dunning.ts. The
// transactional writer that reads the refund event and persists the new claim_status /
// adjustment lives in the webhook (src/db/stripe-webhook.ts); this module only decides the values.
//
// It EXTENDS the existing claim invariant (deriveClaimStatus: an individual gift is claimable only
// with Gift Aid + an active declaration and not fully refunded) with refund awareness:
//   • a NOT-yet-claimed gift re-derives eligibility from the RETAINED (post-refund) amount;
//   • an already-claimed/batched gift cannot un-claim what HMRC already has, so a refund owes an
//     ADJUSTMENT for the refunded portion (claim_status → 'adjustment_due');
//   • a COMPANY gift never claims Gift Aid, so its claim_status is untouched and only its
//     Corporation Tax receipt is voided (full refund) or corrected (partial).

// The receipt action for a company refund (REQ-053): void the whole receipt on a full refund, or
// issue a corrected one for a partial refund.
export const REFUND_RECEIPT_ACTIONS = ["void", "correct"] as const;
export type RefundReceiptAction = (typeof REFUND_RECEIPT_ACTIONS)[number];

// The recomputed claim state. 'adjustment_due' is NOT a donations.claim_status value (that column
// stays not_eligible/eligible/batched/claimed) — it is a computed outcome the caller acts on (it
// mirrors the claim_batches.adjustment_due status), so this module's output type is its own.
export type RefundClaimStatus = ClaimStatus | "adjustment_due";

export interface RefundRecalculation {
  claimStatus: RefundClaimStatus;
  // The pence owed back / to adjust — non-zero ONLY for 'adjustment_due' (the refunded portion of
  // the already-claimed amount). 0 otherwise.
  adjustmentPence: number;
  // Set ONLY for a company refund (void/correct the Corporation Tax receipt); null otherwise.
  receiptAction: RefundReceiptAction | null;
}

// A refund whose absolute refunded amount exceeds the donation — a data inconsistency. A typed
// error like DunningTransitionError so a caller can distinguish it from a generic failure.
export class RefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundError";
  }
}

// The refund inputs: the donation's claim-relevant shape (donor type, Gift Aid flag, whether it
// has an active declaration, its amount and current claim_status) plus the ABSOLUTE refunded
// amount so far (charge.refunded reports the cumulative total, so this is replay-safe). All money
// in integer pence, matching the DB columns.
export const refundInputSchema = z.object({
  donorType: z.enum(DONOR_TYPES),
  giftAid: z.boolean(),
  hasDeclaration: z.boolean(),
  amountPence: z.number().int().positive(),
  refundedPence: z.number().int().nonnegative(),
  claimStatus: z.enum(CLAIM_STATUSES),
});
export type RefundInput = z.infer<typeof refundInputSchema>;

// Recompute the claim state after a refund/dispute. Pure: no clock, no eligibility re-derivation
// beyond the shared deriveClaimStatus.
export function recalculateClaimOnRefund(input: RefundInput): RefundRecalculation {
  const p = refundInputSchema.parse(input);
  if (p.refundedPence > p.amountPence) {
    throw new RefundError(
      `refund of ${p.refundedPence}p exceeds the donation amount ${p.amountPence}p`,
    );
  }
  const fullyRefunded = p.refundedPence >= p.amountPence;

  // Company: never claims Gift Aid, so claim_status is untouched; the Corporation Tax receipt is
  // voided on a full refund or corrected on a partial one.
  if (p.donorType === "company") {
    return {
      claimStatus: p.claimStatus,
      adjustmentPence: 0,
      receiptAction: fullyRefunded ? "void" : "correct",
    };
  }

  // Already batched/claimed: the Gift Aid is locked in with HMRC and cannot be un-claimed, so a
  // refund owes an adjustment for the refunded portion of the already-claimed amount.
  if (p.claimStatus === "batched" || p.claimStatus === "claimed") {
    return { claimStatus: "adjustment_due", adjustmentPence: p.refundedPence, receiptAction: null };
  }

  // Not yet claimed (eligible / not_eligible): re-derive eligibility from the RETAINED amount — a
  // full refund drops to not_eligible, a partial refund keeps eligibility (Gift Aid is claimed on
  // the amount actually retained). No adjustment is owed (nothing was claimed yet).
  const claimStatus = deriveClaimStatus({
    donorType: p.donorType,
    giftAid: p.giftAid,
    hasDeclaration: p.hasDeclaration,
    fullyRefunded,
  });
  return { claimStatus, adjustmentPence: 0, receiptAction: null };
}
