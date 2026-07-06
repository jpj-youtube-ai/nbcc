import { endOfUkTaxYear } from "../declarations/retention";

// Pure, DB-free GASDS claim-deadline logic (TASK-135). GASDS (the Gift Aid Small Donations Scheme
// top-up) has a SHORTER claim deadline than Gift Aid: a small donation must be claimed within
// TWO YEARS of the END OF THE TAX YEAR in which it was collected (Gift Aid itself allows four
// years). Miss the two-year cliff and the small-gift top-up is lost. No pool/config/clock — like
// src/gasds/caps.ts it is unit-tested in isolation. The admin queue that lists gifts approaching
// the cliff (src/db/admin.ts) calls this.

export const GASDS_CLAIM_YEARS = 2;

// The date the GASDS claim window closes for a small donation collected at `collectedAt`: two years
// after the 5 April that ends the tax year of collection (UTC, deterministic).
export function gasdsClaimDeadline(collectedAt: Date | string): Date {
  const at = collectedAt instanceof Date ? collectedAt : new Date(collectedAt);
  const deadline = endOfUkTaxYear(at);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + GASDS_CLAIM_YEARS);
  return deadline;
}
