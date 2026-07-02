import { pool } from "../db/pool";
import { gasdsPoolLimitPence } from "./caps";

// The DB read for the GASDS small-donations pool in a given year (REQ-050/REQ-058/TASK-078).
// Mirrors the listPublicSupporters (DB read in src/db/donations.ts) / groupPublicSupporters
// (pure logic in src/db/donations-model.ts) split: the SQL lives here, the pure limit maths
// in src/gasds/caps.ts (gasdsPoolLimitPence).
//
// Two INDEPENDENT sums, deliberately read by SEPARATE queries (REQ-050's accept clause — the
// GASDS pool total must be reported independently of the Gift Aid claim total it also reads,
// never conflated into one figure):
//   (a) this year's total of gasds_eligible donation amounts (the small-donations pool), and
//   (b) this year's total of CLAIMED Gift Aid donation amounts (feeds the 10× cap only).
// gasdsPoolLimitPence then reports the remaining headroom (the binding of the three caps).

export interface GasdsPoolReport {
  year: number;
  gasdsPoolTotalPence: number; // (a) sum of gasds_eligible=true donations this year
  giftAidClaimedPence: number; // (b) sum of claimed Gift Aid donations this year, read separately
  remainingHeadroomPence: number; // gasdsPoolLimitPence over (a)+(b), never negative
}

async function sumAmountPence(where: string, year: number): Promise<number> {
  const res = await pool.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount_pence), 0) AS total
       FROM donations
      WHERE ${where} AND EXTRACT(YEAR FROM created_at) = $1`,
    [year],
  );
  return Number(res.rows[0].total);
}

export async function getGasdsPoolReport(year: number): Promise<GasdsPoolReport> {
  // (a) The small-donations pool: gasds_eligible gifts this year.
  const gasdsPoolTotalPence = await sumAmountPence("gasds_eligible = true", year);
  // (b) Read the claimed Gift Aid total SEPARATELY — it only informs the 10× cap and is never
  // merged into the pool figure above.
  const giftAidClaimedPence = await sumAmountPence(
    "gift_aid = true AND claim_status IN ('batched', 'claimed')",
    year,
  );
  const remainingHeadroomPence = gasdsPoolLimitPence({
    smallDonationsClaimedPenceThisYear: gasdsPoolTotalPence,
    giftAidClaimedPenceThisYear: giftAidClaimedPence,
  });
  return { year, gasdsPoolTotalPence, giftAidClaimedPence, remainingHeadroomPence };
}
