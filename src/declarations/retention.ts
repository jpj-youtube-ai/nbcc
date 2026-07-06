import { type Scope } from "./wording";

// The pure, DB-free declaration retention-expiry calculator (REQ-046). HMRC's basis is to keep
// Gift Aid records SIX YEARS after the END OF THE ACCOUNTING PERIOD the donation relates to — not
// six years after the charge date itself (TASK-134). NBCC has no stored financial year-end, so the
// accounting period is proxied by the UK TAX YEAR (6 April–5 April): the clock is anchored to the
// 5 April that ends the tax year of the final claimed charge, then six years are added. This is
// slightly conservative (records are kept a little longer, never binned early). An enduring /
// monthly declaration is retained permanently while its subscription is live; on cancellation the
// clock still anchors to the FINAL claimed charge's tax-year-end, never to the cancellation
// timestamp. No pool/config/clock — unit-tested DB-free. This module only computes the expiry date;
// the admin retention-expiry queue (src/db/admin.ts) calls it.
//
// Online declarations require NO 30-day confirmation letter (REQ-046 accept clause), so there is no
// confirmation-window offset to model here.

// HMRC's six-year Gift Aid record-retention window.
export const RETENTION_YEARS = 6;

// The UK tax year ends on 5 April (month index 3). A donation on/before 5 April falls in the tax
// year ending that 5 April; on/after 6 April it falls in the next one.
export const TAX_YEAR_END_MONTH = 3; // April, 0-indexed
export const TAX_YEAR_END_DAY = 5;

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

// The 5 April (UTC) that ends the UK tax year containing `at` — the accounting-period-end proxy.
// Exported so other tax-year-anchored deadlines (e.g. the GASDS 2-year claim cliff) reuse one
// definition of the UK tax-year boundary.
export function endOfUkTaxYear(at: Date): Date {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  const onOrBeforeApr5 =
    m < TAX_YEAR_END_MONTH || (m === TAX_YEAR_END_MONTH && d <= TAX_YEAR_END_DAY);
  const endYear = onOrBeforeApr5 ? y : y + 1;
  return new Date(Date.UTC(endYear, TAX_YEAR_END_MONTH, TAX_YEAR_END_DAY));
}

// Six years after the end of the accounting period (tax-year-end) of the given instant, in UTC so
// the result is timezone-independent.
function retentionExpiryFrom(at: Date): Date {
  const periodEnd = endOfUkTaxYear(at);
  periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + RETENTION_YEARS);
  return periodEnd;
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

  return retentionExpiryFrom(finalCharge);
}
