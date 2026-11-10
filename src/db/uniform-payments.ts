import type { PoolClient } from "pg";
import type { UniformPaymentWrite } from "../uniform/model";

// Uniform payments (TASK-604): the uniform_payments table. A uniform is a purchase, never a gift, so
// none of this touches donations. The webhook (src/uniform/webhook.ts) writes here on its own
// transaction; Admin > Donations reads the Uniform tile's figures (sumGiftsBySource) and list
// (listDonations) from here.

export type Querier = Pick<PoolClient, "query">;

/** Keeps a paid uniform payment once, whichever event brought it, with an audit line beside it. */
export async function recordUniformPayment(
  client: Querier,
  w: UniformPaymentWrite,
  eventId: string,
): Promise<"uniform.paid" | "uniform.already_paid"> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO uniform_payments
       (stripe_session_id, stripe_payment_intent_id, stripe_payment_link_id, amount_pence, currency, buyer_name, buyer_email, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING id`,
    [w.sessionId, w.paymentIntentId, w.paymentLinkId, w.amountPence, w.currency, w.buyerName, w.buyerEmail, JSON.stringify(w.details)],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) return "uniform.already_paid";
  await client.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, data)
     VALUES ($1, $2, $3, $4, $5)`,
    ["stripe", "uniform.paid", "uniform_payment", id, { eventId, sessionId: w.sessionId, amountPence: w.amountPence }],
  );
  return "uniform.paid";
}

// A donation that something else depends on: in a Gift Aid claim batch or claimed, or linked to a
// benefit, partner shares, a claim adjustment, a fundraiser's thank you gift, a sponsor pledge or an
// invoice. Moving one could break a claim or a record, so it is left for staff to look at.
const HELD = `(d.claim_batch_id IS NOT NULL
     OR d.claim_status NOT IN ('eligible', 'not_eligible')
     OR EXISTS (SELECT 1 FROM donation_benefits x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM donation_partner_shares x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM claim_adjustments x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM fundraiser_thank_gifts x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM sponsor_pledges x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM donation_invoices x WHERE x.donation_id = d.id))`;

export type UniformMoveOutcome = "moved" | "recorded" | "held" | "already_uniform";

/**
 * One uniform sale from before the Uniform tile (TASK-604), for src/scripts/move-uniform-payments.ts,
 * on the caller's transaction:
 *   already_uniform  it is kept as a uniform payment already: nothing to do (so the move can run again)
 *   moved            it was recorded as a donation: kept as a uniform payment, paid when the donation
 *                    was recorded and with its refunds, the donation's whole row kept in
 *                    donations_moved_to_uniform with an audit line, and the donation taken out
 *   held             it was recorded as a donation something else depends on (HELD): left as it is
 *   recorded         it was never recorded at all: kept as a uniform payment, paid when Stripe says
 * With apply false (a dry run) it only reads, and says what it would do.
 */
export async function moveUniformSale(
  client: Querier,
  w: UniformPaymentWrite,
  stripePaidAt: Date,
  opts: { apply: boolean },
): Promise<{ outcome: UniformMoveOutcome; amountPence: number }> {
  const done = (outcome: UniformMoveOutcome) => ({ outcome, amountPence: w.amountPence });
  // A uniform payment kept already may still have a donation left beside it: a late paying uniform
  // (a bank payment) half recorded as a pending donation before the Uniform tile, and kept as a
  // uniform payment when its money came in after. That donation is moved against it.
  const kept = await client.query<{ id: number }>("SELECT id FROM uniform_payments WHERE stripe_session_id = $1", [w.sessionId]);
  const keptId = kept.rows[0]?.id;
  const found = await client.query<{ id: number; created_at: Date; refunded_amount_pence: number; held: boolean }>(
    `SELECT d.id, d.created_at, d.refunded_amount_pence, ${HELD} AS held
       FROM donations d
      WHERE d.stripe_session_id = $1 OR ($2::text IS NOT NULL AND d.stripe_payment_intent_id = $2)
      ORDER BY d.id
      LIMIT 1
      FOR UPDATE`,
    [w.sessionId, w.paymentIntentId],
  );
  const d = found.rows[0];
  if (keptId !== undefined && !d) return done("already_uniform");
  if (d?.held) return done("held");
  const outcome: UniformMoveOutcome = d ? "moved" : "recorded";
  if (!opts.apply) return done(outcome);
  if (keptId !== undefined && d) {
    await client.query("UPDATE uniform_payments SET moved_from_donation_id = $2 WHERE id = $1 AND moved_from_donation_id IS NULL", [keptId, d.id]);
    await client.query(
      `INSERT INTO donations_moved_to_uniform (donation_id, uniform_payment_id, donation_row)
       SELECT d.id, $2, to_jsonb(d) FROM donations d WHERE d.id = $1`,
      [d.id, keptId],
    );
    await client.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        "script:move-uniform-payments",
        "uniform.moved_from_donation",
        "uniform_payment",
        keptId,
        { sessionId: w.sessionId, donationId: d.id, reason: "a school uniform, not a donation (TASK-604)" },
      ],
    );
    await client.query("DELETE FROM donations WHERE id = $1", [d.id]);
    return done("moved");
  }
  const made = await client.query<{ id: number }>(
    `INSERT INTO uniform_payments
       (stripe_session_id, stripe_payment_intent_id, stripe_payment_link_id, amount_pence, currency, buyer_name, buyer_email, details,
        paid_at, refunded_amount_pence, moved_from_donation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, LEAST($4, $10::int), $11)
     RETURNING id`,
    [
      w.sessionId,
      w.paymentIntentId,
      w.paymentLinkId,
      w.amountPence,
      w.currency,
      w.buyerName,
      w.buyerEmail,
      JSON.stringify(w.details),
      d ? d.created_at : stripePaidAt,
      d ? Number(d.refunded_amount_pence) || 0 : 0,
      d ? d.id : null,
    ],
  );
  const uniformId = made.rows[0].id;
  if (d) {
    await client.query(
      `INSERT INTO donations_moved_to_uniform (donation_id, uniform_payment_id, donation_row)
       SELECT d.id, $2, to_jsonb(d) FROM donations d WHERE d.id = $1`,
      [d.id, uniformId],
    );
  }
  await client.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      "script:move-uniform-payments",
      d ? "uniform.moved_from_donation" : "uniform.recorded_late",
      "uniform_payment",
      uniformId,
      { sessionId: w.sessionId, donationId: d ? d.id : null, reason: "a school uniform, not a donation (TASK-604)" },
    ],
  );
  if (d) await client.query("DELETE FROM donations WHERE id = $1", [d.id]);
  return done(outcome);
}

/** Sets how much of a uniform payment Stripe has refunded (its total so far, so a replay changes
 *  nothing). False when the payment is not a uniform's. */
export async function setUniformRefund(client: Querier, paymentIntentId: string, refundedPence: number): Promise<boolean> {
  // Looked up first, so a payment that is not a uniform's never has its amounts handed to this table.
  const mine = await client.query("SELECT id FROM uniform_payments WHERE stripe_payment_intent_id = $1", [paymentIntentId]);
  if ((mine.rowCount ?? 0) === 0) return false;
  const r = await client.query(
    `UPDATE uniform_payments SET refunded_amount_pence = LEAST(amount_pence, GREATEST(0, $2::int))
      WHERE stripe_payment_intent_id = $1
      RETURNING id`,
    [paymentIntentId, refundedPence],
  );
  return (r.rowCount ?? 0) > 0;
}
