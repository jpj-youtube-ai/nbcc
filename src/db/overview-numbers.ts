import { pool } from "./pool";
import type { NowAndBefore, SoFar } from "../admin/overview-numbers";
import { sourceTotalsFrom, type SourceTotals, type SourceTotalsRow } from "../admin/gift-sources";
import { DONATION_SOURCES, type DonationSource } from "./stripe-webhook-model";

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

// A source picked from the one list by its value, so the order of DONATION_SOURCES never matters here.
const bySource = (s: DonationSource): DonationSource => DONATION_SOURCES.find((x) => x === s) as DonationSource;

/**
 * Fill a Red Bag against the Donate page, this UK month so far and all time, in one grouped read.
 *
 * Money is counted as sumDonations above counts it: paid gifts less refunds, the gift alone (the
 * card fee top up is its own column, fee_cover_pence, and Gift Aid is never added in), with this
 * month being IN_MONTH. Each payment of a monthly gift is a row, so each counts as a gift. A gift
 * refunded in full is no longer a gift received, so it is not counted as one.
 *
 *   Fill a Red Bag   source = 'red_bag' (written by the Stripe webhook since TASK-555).
 *   Festive Ball     source = 'ball' (the Ball's own donate page, /ball/donate).
 *   Red bags at the Ball  source = 'ball_bags' (the table cards, /bag). Its own bucket, never in the Festive Ball's.
 *   Invoices         source = 'invoice' (a paid invoice from Admin > Giving > Invoices, card or bank transfer).
 *   Donate page      no source, paid online (not a card reader), and not on a fundraiser's page.
 *                    A gift started anywhere else that later gets a source of its own is in neither.
 *
 * The Elf Detective School is a second read, of elf_orders (they are not donations): paid orders of
 * families a head elf has not removed, entry plus gift (the card fee top up is not added in), this
 * month by when each was paid, each order one payment. Head Elf HQ's Raised so far counts the same.
 */
export async function sumGiftsBySource(month: SoFar): Promise<SourceTotals> {
  const kept = "GREATEST(amount_pence - refunded_amount_pence, 0)";
  const paidAt = "COALESCE(o.paid_at, o.created_at)";
  const [gifts, elf] = await Promise.all([
    pool.query<SourceTotalsRow>(
      `SELECT CASE WHEN source = $3 THEN 'redBag' WHEN source = $4 THEN 'ball' WHEN source = $5 THEN 'ballBags' WHEN source = $6 THEN 'invoices' ELSE 'donatePage' END AS bucket,
              COALESCE(SUM(${kept}) FILTER (WHERE ${IN_MONTH("created_at")}), 0) AS month_pence,
              COUNT(*) FILTER (WHERE ${IN_MONTH("created_at")}) AS month_gifts,
              COALESCE(SUM(${kept}), 0) AS all_pence,
              COUNT(*) AS all_gifts
         FROM donations
        WHERE payment_status = 'paid'
          AND amount_pence > refunded_amount_pence
          AND (source IN ($3, $4, $5, $6) OR (source IS NULL AND payment_channel = 'online' AND fundraiser_id IS NULL))
        GROUP BY 1`,
      [month.from, month.until, bySource("red_bag"), bySource("ball"), bySource("ball_bags"), bySource("invoice")],
    ),
    pool.query<SourceTotalsRow>(
      `SELECT 'elfSchool' AS bucket,
              COALESCE(SUM(o.entry_pence + o.donation_pence) FILTER (WHERE ${IN_MONTH(paidAt)}), 0) AS month_pence,
              COUNT(*) FILTER (WHERE ${IN_MONTH(paidAt)}) AS month_gifts,
              COALESCE(SUM(o.entry_pence + o.donation_pence), 0) AS all_pence,
              COUNT(*) AS all_gifts
         FROM elf_orders o JOIN elf_families f ON f.id = o.family_id
        WHERE o.status = 'paid' AND f.active AND f.removed_at IS NULL`,
      [month.from, month.until],
    ),
  ]);
  return sourceTotalsFrom([...gifts.rows, ...elf.rows]);
}
