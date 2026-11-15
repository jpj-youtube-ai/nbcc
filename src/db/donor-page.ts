import { pool } from "./pool";

// One donor's page in the admin (2026-11-14 admin refresh,
// docs/superpowers/specs/2026-11-14-admin-refresh-people.md): what they have given, the truth about
// their monthly gift, and their lines from the audit trail. Reads only (pool.query, no transaction),
// each bounded, beside getDonorPortalSnapshot and getDonorAddress, which the page already used.

/** A defensive cap on the gifts listed for one donor. The figures are counted separately, so they stay exact. */
const DONOR_GIFT_LIMIT = 200;
const DONOR_TRAIL_LIMIT = 50;
const MONTHLY_PAYMENT_LIMIT = 500;

export interface DonorGift {
  id: number;
  /** The donor record the gift sits under: one person is several records sharing an email address. */
  donorId: number;
  date: string;
  amountPence: number;
  refundedPence: number;
  mode: "once" | "monthly";
  plan: string | null;
  giftAid: boolean;
  /** pending | paid | failed, as the Donations list has it. */
  status: string;
  /** Where the gift was started ('red_bag', 'ball', 'invoice' and so on), or null. */
  source: string | null;
  invoiceId: number | null;
}

export interface DonorGiving {
  /** Paid gifts, less anything refunded. */
  totalPence: number;
  /** How many gifts were paid. */
  count: number;
  /** How many gifts there are of any kind, paid or not (the list holds the newest 200). */
  listed: number;
  firstAt: string | null;
  latestAt: string | null;
  gifts: DonorGift[];
}

// Every gift under this donor's email address, or under this one record when it has no email. A
// donor who gave N times is N donor records sharing an email (see getDonorDonationHistory in
// portal.ts, which does this for the donor's own page), so the record alone would show one gift.
// TASK-501: money they paid in for their own fundraiser is their supporters' giving, not theirs.
const THEIR_GIFTS = `FROM donations d
       JOIN donors dn ON dn.id = d.donor_id
      WHERE (d.donor_id = $1 OR LOWER(dn.email) = (SELECT LOWER(me.email) FROM donors me WHERE me.id = $1))
        AND NOT d.paid_in_by_organiser`;

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * What a donor has given: the total (paid gifts, less refunds, as the Overview counts money), how
 * many, the first and the latest, then each gift newest first. A gift that failed or is still
 * pending is listed, so the page can say so, but is in none of the figures.
 */
export async function getDonorGiving(donorId: number): Promise<DonorGiving> {
  const sums = (
    await pool.query<{
      paid_count: number;
      all_count: number;
      total_pence: number;
      first_at: Date | null;
      latest_at: Date | null;
    }>(
      `SELECT count(*) FILTER (WHERE d.payment_status = 'paid')::int AS paid_count,
              count(*)::int AS all_count,
              COALESCE(sum(GREATEST(d.amount_pence - d.refunded_amount_pence, 0)) FILTER (WHERE d.payment_status = 'paid'), 0)::int AS total_pence,
              min(d.created_at) FILTER (WHERE d.payment_status = 'paid') AS first_at,
              max(d.created_at) FILTER (WHERE d.payment_status = 'paid') AS latest_at
         ${THEIR_GIFTS}`,
      [donorId],
    )
  ).rows[0];
  const list = await pool.query<{
    id: number;
    donor_id: number;
    created_at: Date;
    amount_pence: number;
    refunded_amount_pence: number;
    mode: string;
    plan: string | null;
    gift_aid: boolean;
    payment_status: string;
    source: string | null;
    invoice_id: number | null;
  }>(
    `SELECT d.id, d.donor_id, d.created_at, d.amount_pence, d.refunded_amount_pence, d.mode, d.plan,
            d.gift_aid, d.payment_status, d.source, d.invoice_id
       ${THEIR_GIFTS}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ${DONOR_GIFT_LIMIT}`,
    [donorId],
  );
  return {
    totalPence: Number(sums?.total_pence) || 0,
    count: Number(sums?.paid_count) || 0,
    listed: Number(sums?.all_count) || 0,
    firstAt: iso(sums?.first_at),
    latestAt: iso(sums?.latest_at),
    gifts: list.rows.map((r) => ({
      id: r.id,
      donorId: r.donor_id,
      date: iso(r.created_at) ?? "",
      amountPence: Number(r.amount_pence) || 0,
      refundedPence: Number(r.refunded_amount_pence) || 0,
      mode: r.mode === "monthly" ? ("monthly" as const) : ("once" as const),
      plan: r.plan ?? null,
      giftAid: r.gift_aid === true,
      status: r.payment_status,
      source: r.source ?? null,
      invoiceId: r.invoice_id ?? null,
    })),
  };
}

export interface DonorMonthlyGift {
  subscriptionId: string;
  plan: string | null;
  /**
   * active | past_due | lapsed | cancelled | unknown, as Monthly givers has it
   * (src/db/monthly-supporters.ts). 'unknown' is an older gift with no payment health on record,
   * not a problem.
   */
  state: string;
  /** What they give now: their latest paid monthly amount, or null before the first is paid. */
  monthlyPence: number | null;
  firstPaidAt: string | null;
  payments: number;
  cancelledAt: string | null;
  lapsedAt: string | null;
  failedAttempts: number;
}

/**
 * The truth about one donor's monthly gift. The donor snapshot only says which plan their newest
 * subscription was on, and goes on saying it after the gift has been cancelled; this says whether it
 * is still running.
 *
 * A cancellation outranks the status column, as on Monthly givers: Stripe's own message stamps
 * cancelled_at and can leave the status 'active'. The team's own cancellation counts as well, from
 * the audit row written in the same request (recordAdminSubscriptionCancellation), because the page
 * is read again the moment after the button is pressed and Stripe's message arrives a little later.
 */
export async function getDonorMonthlyGift(
  donorId: number,
  subscriptionId: string,
  plan: string | null,
): Promise<DonorMonthlyGift> {
  const health = (
    await pool.query<{
      status: string | null;
      cancelled_at: Date | null;
      lapsed_at: Date | null;
      failed_attempts: number | null;
    }>(
      `SELECT status, cancelled_at, lapsed_at, failed_attempts
         FROM subscription_dunning
        WHERE stripe_subscription_id = $1`,
      [subscriptionId],
    )
  ).rows[0];
  const byTeam = (
    await pool.query<{ created_at: Date }>(
      `SELECT created_at
         FROM audit_log
        WHERE entity = 'donor' AND entity_id = $1 AND action = 'admin.subscription_cancelled'
          AND data->>'subscriptionId' = $2
        ORDER BY id DESC
        LIMIT 1`,
      [donorId, subscriptionId],
    )
  ).rows[0];
  const paid = (
    await pool.query<{ amount_pence: number; created_at: Date }>(
      `SELECT amount_pence, created_at
         FROM donations
        WHERE donor_id = $1 AND stripe_subscription_id = $2 AND payment_status = 'paid'
        ORDER BY created_at DESC, id DESC
        LIMIT ${MONTHLY_PAYMENT_LIMIT}`,
      [donorId, subscriptionId],
    )
  ).rows;

  const cancelledAt = iso(health?.cancelled_at) ?? iso(byTeam?.created_at);
  const latest = paid[0];
  const first = paid[paid.length - 1];
  return {
    subscriptionId,
    plan,
    state: cancelledAt ? "cancelled" : (health?.status ?? "unknown"),
    monthlyPence: latest && typeof latest.amount_pence === "number" ? latest.amount_pence : null,
    firstPaidAt: iso(first?.created_at),
    payments: paid.length,
    cancelledAt,
    lapsedAt: iso(health?.lapsed_at),
    failedAttempts: Number(health?.failed_attempts) || 0,
  };
}

export interface DonorTrailLine {
  id: number;
  action: string;
  actor: string;
  at: string;
  /** For a change of details, the names of the details that changed (never their values). */
  fields: string[];
}

/**
 * This donor's lines from the audit trail, newest first: what was done to the donor record, to
 * their monthly gift (those rows carry the donor's id), and to any Gift Aid declaration of theirs.
 *
 * The row's own data is NOT handed on. A sign in link's row holds the link's secret, and a Stripe
 * row holds Stripe's ids; the page needs only who, what and when, plus which details a change
 * touched.
 */
export async function listDonorAuditTrail(donorId: number): Promise<DonorTrailLine[]> {
  const res = await pool.query<{
    id: number;
    actor: string;
    action: string;
    data: { fields?: unknown } | null;
    created_at: Date;
  }>(
    `SELECT id, actor, action, data, created_at
       FROM audit_log
      WHERE (entity IN ('donor', 'subscription') AND entity_id = $1)
         OR (entity = 'declaration' AND entity_id IN (SELECT id FROM declarations WHERE donor_id = $1))
      ORDER BY id DESC
      LIMIT ${DONOR_TRAIL_LIMIT}`,
    [donorId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    action: r.action,
    actor: r.actor,
    at: iso(r.created_at) ?? "",
    fields:
      r.action === "donor.updated" && r.data && Array.isArray(r.data.fields)
        ? r.data.fields.filter((f): f is string => typeof f === "string")
        : [],
  }));
}
