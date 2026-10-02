import { pool } from "./pool";
import type { NowAndBefore, SoFar } from "../admin/overview-numbers";

// TASK-509: the money behind the Overview's "Money in" line: this month so far and the same days
// last month (src/admin/overview-numbers.ts monthSoFar), each part read on its own so each can carry
// its own screen's gate. Money is counted as the screens count it: paid gifts less refunds, as the
// fundraising meter does (src/db/fundraisers.ts ONLINE_SQL); paid Ball bookings, as the Festive Ball
// dashboard does; cash staff recorded as paid in, by the day it was paid in.

type Months = { current: SoFar; previous: SoFar };

// Days are UK days; `until` is a moment. Rows from before last month's 1st are never looked at.
const IN_MONTH = (at: string) => `(${at} AT TIME ZONE 'Europe/London')::date >= $1::date AND ${at} <= $2::timestamptz`;
const IN_LAST = (at: string) => `(${at} AT TIME ZONE 'Europe/London')::date >= $3::date AND ${at} < $4::timestamptz`;
const params = (p: Months) => [p.current.from, p.current.until, p.previous.from, p.previous.until];

const pair = (r: { now: string | number; before: string | number } | undefined): NowAndBefore => ({
  now: Number(r?.now ?? 0),
  before: Number(r?.before ?? 0),
});

/** Gifts given on the site: through a fundraising page or not. */
export async function sumDonations(p: Months, fundraisingPages: boolean): Promise<NowAndBefore> {
  const r = await pool.query<{ now: string; before: string }>(
    `SELECT COALESCE(SUM(GREATEST(amount_pence - refunded_amount_pence, 0)) FILTER (WHERE ${IN_MONTH("created_at")}), 0) AS now,
            COALESCE(SUM(GREATEST(amount_pence - refunded_amount_pence, 0)) FILTER (WHERE ${IN_LAST("created_at")}), 0) AS before
       FROM donations
      WHERE payment_status = 'paid'
        AND fundraiser_id IS ${fundraisingPages ? "NOT NULL" : "NULL"}
        AND created_at >= $3::date - 1`,
    params(p),
  );
  return pair(r.rows[0]);
}

/** Cash organisers paid in, recorded by staff, by the UK day it was paid in. */
export async function sumFundraisingCash(p: Months): Promise<NowAndBefore> {
  // paid_in_on is a day: last month counts up to the day `until` falls in, or the day before when
  // `until` is midnight (the whole of a shorter last month).
  const r = await pool.query<{ now: string; before: string }>(
    `SELECT COALESCE(SUM(amount_pence) FILTER (WHERE paid_in_on >= $1::date
                                               AND paid_in_on <= ($2::timestamptz AT TIME ZONE 'Europe/London')::date), 0) AS now,
            COALESCE(SUM(amount_pence) FILTER (WHERE paid_in_on >= $3::date
                                               AND paid_in_on <= (($4::timestamptz - interval '1 microsecond') AT TIME ZONE 'Europe/London')::date), 0) AS before
       FROM fundraiser_cash
      WHERE paid_in_on >= $3::date`,
    params(p),
  );
  return pair(r.rows[0]);
}

/** Paid Festive Ball bookings, by when they were paid. */
export async function sumBallTaken(p: Months): Promise<NowAndBefore> {
  const r = await pool.query<{ now: string; before: string }>(
    `SELECT COALESCE(SUM(total_pence) FILTER (WHERE ${IN_MONTH("paid_at")}), 0) AS now,
            COALESCE(SUM(total_pence) FILTER (WHERE ${IN_LAST("paid_at")}), 0) AS before
       FROM ball_bookings
      WHERE status = 'paid' AND paid_at >= $3::date - 1`,
    params(p),
  );
  return pair(r.rows[0]);
}
