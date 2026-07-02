import { type Scope } from "./wording";

// The pure, DB-free declaration retention-expiry calculator (REQ-046). An immutable Gift
// Aid declaration must be retained SIX YEARS after the most recent claimed donation, and
// permanently while an enduring / monthly declaration's subscription is still active. On
// cancellation the six-year clock is anchored to the FINAL claimed charge, never to the
// cancellation timestamp itself. No pool/config/clock — like src/declarations/wording.ts
// and src/db/donations-model.ts it is unit-tested DB-free. This module only computes the
// expiry date; the REQ-063 admin retention-expiry queue that will call it is out of scope.
//
// Online declarations require NO 30-day confirmation letter (REQ-046 accept clause), so
// there is no confirmation-window offset to model here — only the six-year-after-last-claim
// rule below.

// HMRC's six-year Gift Aid record-retention window.
export const RETENTION_YEARS = 6;

export interface RetentionInput {
  // The persisted declarations.scope (REQ-044). An enduring declaration is `all_donations`
  // — a monthly gift is always enduring (REQ-041) and persists as `all_donations` too.
  scope: Scope;
  // Whether the enduring/monthly subscription behind the declaration is still live.
  subscriptionActive: boolean;
  // The created_at of the FINAL claimed donation covered by this declaration (the most
  // recent charge with claim_status past `eligible`), or null if none has been claimed.
  lastClaimedDonationAt: Date | string | null;
  // When the subscription was cancelled, or null while it runs. Used ONLY to decide the
  // declaration is inactive — it is deliberately NOT the retention anchor (the final charge
  // is), so a cancellation long after the last charge cannot extend retention.
  cancelledAt: Date | string | null;
}

// Six years after a given instant, computed in UTC so the result is independent of the
// server's timezone. Does not mutate the input. Leap-day anchors (29 Feb) roll to 1 Mar,
// which JS Date handles natively.
function addRetentionYears(at: Date): Date {
  const expiry = new Date(at.getTime());
  expiry.setUTCFullYear(expiry.getUTCFullYear() + RETENTION_YEARS);
  return expiry;
}

// Compute a declaration's retention-expiry date, or null to retain it indefinitely.
//
// Returns null when EITHER an enduring/monthly declaration's subscription is still active
// (retain indefinitely — the clock has not started), OR there is no claimed donation to
// anchor the clock to (nothing to retain against — a deterministic, non-throwing result the
// caller reads as "no computable expiry", not "retain forever"). Otherwise the six-year
// clock runs from the final claimed charge, regardless of when the subscription was
// cancelled (REQ-046).
export function computeRetentionExpiry(input: RetentionInput): Date | null {
  const enduring = input.scope === "all_donations";
  const active = input.subscriptionActive && input.cancelledAt == null;

  // Retain indefinitely while an enduring/monthly declaration is live.
  if (enduring && active) return null;

  // No claimed donation → no anchor for the six-year clock; nothing to retain against.
  if (input.lastClaimedDonationAt == null) return null;

  const finalCharge =
    input.lastClaimedDonationAt instanceof Date
      ? input.lastClaimedDonationAt
      : new Date(input.lastClaimedDonationAt);

  return addRetentionYears(finalCharge);
}
