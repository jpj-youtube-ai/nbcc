import { pool } from "./pool";

// TASK-447: the individuals who give every month.
//
// Businesses have had a screen of their own since TASK-208; the people quietly paying £10 a month
// have had nothing. They were findable only by paging the whole donations list, which is how three
// of them went four months without a thank-you and nobody noticed (TASK-430).
//
// Deliberately NOT the supporters wall. That answers "who may we name in public"; this answers
// "who gives regularly, are they all right, and does anybody owe them something". A donor who asked
// to stay anonymous still belongs here, because the charity's own record of its regular income is
// not a public listing.

// A defensive cap, matching the other admin reads. Far beyond any realistic number of monthly
// donors, and there to stop one bad query returning the whole table.
const MONTHLY_SUPPORTER_LIMIT = 500;

export interface MonthlySupporter {
  donorId: number;
  fullName: string;
  email: string | null;
  /** The most recent paid monthly amount: what they give NOW, not an average across changes. */
  monthlyPence: number;
  /** Their first paid monthly gift, so "giving since" is a fact rather than when we noticed. */
  firstPaidAt: string;
  mostRecentPaidAt: string;
  paymentCount: number;
  totalPence: number;
  /** Whether their most recent monthly gift carries Gift Aid. */
  giftAid: boolean;
  /**
   * active | past_due | lapsed | cancelled | unknown.
   * 'unknown' means no dunning row: every subscription the webhook has seen has one, so this is an
   * older or hand-imported supporter rather than a problem.
   */
  state: string;
  cancelledAt: string | null;
  lapsedAt: string | null;
  failedAttempts: number;
  /** When they were thanked, or null. One letter per donor, so this is final either way. */
  thankedAt: string | null;
}

/**
 * Every INDIVIDUAL with at least one paid monthly donation, most recent giver first.
 *
 * The monthly amount and the Gift Aid flag come from their LATEST paid monthly gift rather than an
 * average or a sum: somebody who moved from £5 to £20 gives £20, and saying £12.50 would be true of
 * nothing. The count and the total cover everything they have given monthly, which is the number
 * worth seeing next to it.
 *
 * Companies are excluded because they have their own screen, and showing them twice would make two
 * lists that disagree about what a supporter is.
 */
export async function listMonthlySupporters(): Promise<MonthlySupporter[]> {
  const res = await pool.query<{
    donor_id: number;
    full_name: string;
    email: string | null;
    monthly_pence: number;
    first_paid_at: Date;
    most_recent_paid_at: Date;
    payment_count: number;
    total_pence: number;
    gift_aid: boolean;
    state: string | null;
    cancelled_at: Date | null;
    lapsed_at: Date | null;
    failed_attempts: number | null;
    thanked_at: Date | null;
  }>(
    `SELECT dn.id AS donor_id, dn.full_name, dn.email,
            latest.amount_pence AS monthly_pence,
            latest.gift_aid,
            agg.first_paid_at, agg.most_recent_paid_at, agg.payment_count, agg.total_pence,
            sd.status AS state, sd.cancelled_at, sd.lapsed_at, sd.failed_attempts,
            ty.sent_at AS thanked_at
       FROM donors dn
       -- Everything they have given monthly, in one pass.
       JOIN LATERAL (
              SELECT min(created_at) AS first_paid_at,
                     max(created_at) AS most_recent_paid_at,
                     count(*)::int   AS payment_count,
                     sum(amount_pence)::int AS total_pence
                FROM donations
               WHERE donor_id = dn.id AND mode = 'monthly' AND payment_status = 'paid'
            ) agg ON agg.payment_count > 0
       -- What they give NOW. An average across a change of amount would be true of nothing.
       JOIN LATERAL (
              SELECT amount_pence, gift_aid
                FROM donations
               WHERE donor_id = dn.id AND mode = 'monthly' AND payment_status = 'paid'
               ORDER BY created_at DESC
               LIMIT 1
            ) latest ON true
       -- Payment health. LEFT, because a hand-imported supporter has no dunning row and is not
       -- thereby a problem.
       LEFT JOIN subscription_dunning sd ON sd.donor_id = dn.id
       -- One letter per donor, so at most one row.
       LEFT JOIN thank_you_sent ty ON ty.donor_id = dn.id
      WHERE dn.donor_type = 'individual'
      ORDER BY agg.most_recent_paid_at DESC, dn.id DESC
      LIMIT ${MONTHLY_SUPPORTER_LIMIT}`,
  );

  return res.rows.map((r) => ({
    donorId: r.donor_id,
    fullName: r.full_name,
    email: r.email,
    monthlyPence: r.monthly_pence,
    firstPaidAt: new Date(r.first_paid_at).toISOString(),
    mostRecentPaidAt: new Date(r.most_recent_paid_at).toISOString(),
    paymentCount: r.payment_count,
    totalPence: r.total_pence,
    giftAid: r.gift_aid,
    // A cancellation outranks the status column: a cancelled subscription is still stored 'active'
    // until its period ends, and calling that active on a screen about regular income is a lie.
    state: r.cancelled_at ? "cancelled" : (r.state ?? "unknown"),
    cancelledAt: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null,
    lapsedAt: r.lapsed_at ? new Date(r.lapsed_at).toISOString() : null,
    failedAttempts: r.failed_attempts ?? 0,
    thankedAt: r.thanked_at ? new Date(r.thanked_at).toISOString() : null,
  }));
}
