import { endOfUkTaxYear, RETENTION_YEARS } from "../declarations/retention";

// How long email_log rows live (email-audit feature): SIX YEARS after the end of the UK tax year
// they were sent in — the same HMRC Gift Aid record-keeping window (and the same anchor,
// endOfUkTaxYear) the declaration retention uses, because these rows are the evidence that
// receipts and declaration emails were actually sent. Pure and clock-injected, so the rule is
// unit-tested without a database.

// The instant a row created at tax-year-end `boundary` falls out of retention.
function expiryOf(boundary: Date): number {
  return Date.UTC(
    boundary.getUTCFullYear() + RETENTION_YEARS,
    boundary.getUTCMonth(),
    boundary.getUTCDate(),
  );
}

/**
 * The latest tax-year-end boundary whose six-year window has fully elapsed at `now`. Rows with
 * created_at ON OR BEFORE this instant are out of retention and may be pruned; everything after
 * it is kept. Conservative by construction: a row is only expired once the 5 April that ends ITS
 * tax year is at least six years past.
 */
export function emailLogPruneCutoff(now: Date): Date {
  // Start at the tax-year-end containing `now` and walk back to the newest boundary already six
  // years old. Bounded: at most RETENTION_YEARS + 1 steps.
  const boundary = endOfUkTaxYear(now);
  while (expiryOf(boundary) > now.getTime()) {
    boundary.setUTCFullYear(boundary.getUTCFullYear() - 1);
  }
  return boundary;
}
