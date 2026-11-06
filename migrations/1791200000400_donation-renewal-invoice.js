/* eslint-disable camelcase */

// A monthly gift's renewal recorded once (TASK-596). Stripe sends invoice.paid AND
// invoice.payment_succeeded for every paid renewal, and on the API version we are pinned to the
// invoice carries no payment_intent or charge, so the webhook's old check never ran and each renewal
// was recorded twice: two donations, two NBCC references, two thank you emails.
//
//   1. donations.stripe_invoice_id: the Stripe invoice a renewal paid. The webhook looks for it under
//      a lock before recording one, and keeps it on the gift it records; one gift per invoice, held by
//      a unique index. Empty for everything else.
//   2. The doubles already recorded are taken out of donations, so totals, Gift Aid claims and the
//      donor's gifts count each payment once. Nothing is lost: each one's whole row is kept in
//      donations_removed_duplicates beside the gift it repeated, with an audit line.
//
// How a double is known, from what was recorded with it rather than by guessing from times. Every
// renewal (a monthly gift with no checkout session, payment intent, charge or invoice id) has the
// audit line the webhook wrote with it (donation.recurring), naming the event that made it, and the
// webhook ledger (stripe_webhook_events) says that event's type. A renewal's two copies came one from
// invoice.paid and one from invoice.payment_succeeded, within moments of each other. So the renewals
// of each subscription and amount are put into bursts (each within ten minutes of the one before),
// and in a burst the payment_succeeded copies are paired one to one, in order, with the invoice.paid
// copies. Each pair is one payment: one copy stays, the other is taken out. Two invoices paid seconds
// apart (a giver catching up on missed months) are two pairs, so both payments stay; a copy with no
// partner is never touched. Of a pair, the payment_succeeded copy goes, unless it has been refunded, put
// in a Gift Aid claim batch or claimed, or anything else points at it, and its twin has not: then the
// twin goes. A pair where both copies are held like that is left as it is, and named in one
// donation.duplicates_left audit line, so staff can see a claim may need adjusting.
//
// The column and the table are additive. Taking the doubles out changes no shape, so a code rollback
// is safe (golden rule 2); down puts them back.

const HELD = `(d.refunded_amount_pence > 0
     OR d.claim_batch_id IS NOT NULL
     OR d.claim_status NOT IN ('eligible', 'not_eligible')
     OR EXISTS (SELECT 1 FROM donation_benefits x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM donation_partner_shares x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM claim_adjustments x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM fundraiser_thank_gifts x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM sponsor_pledges x WHERE x.donation_id = d.id)
     OR EXISTS (SELECT 1 FROM donation_invoices x WHERE x.donation_id = d.id))`;

// Keeps each double's row and an audit line, then takes it out of donations. Re-runnable: a double
// already taken out has no twin left to pair with. Exported for the BDD that proves it on Postgres.
const REMOVE_DOUBLES_SQL = `
  WITH renewals AS (
    SELECT d.id, d.stripe_subscription_id AS sub, d.amount_pence, d.created_at, e.type AS event_type, ${HELD} AS held
      FROM donations d
      JOIN audit_log a ON a.entity = 'donation' AND a.entity_id = d.id AND a.action = 'donation.recurring'
      JOIN stripe_webhook_events e ON e.id = a.data->>'eventId'
     WHERE d.mode = 'monthly'
       AND d.stripe_subscription_id IS NOT NULL
       AND d.stripe_session_id IS NULL AND d.stripe_payment_intent_id IS NULL AND d.stripe_charge_id IS NULL
       AND d.stripe_invoice_id IS NULL
       AND e.type IN ('invoice.paid', 'invoice.payment_succeeded')
  ), starts AS (
    SELECT r.*,
           CASE WHEN lag(created_at) OVER w IS NULL OR created_at - lag(created_at) OVER w > interval '10 minutes'
                THEN 1 ELSE 0 END AS starts_burst
      FROM renewals r
    WINDOW w AS (PARTITION BY sub, amount_pence ORDER BY created_at, id)
  ), bursts AS (
    SELECT s.*, sum(starts_burst) OVER (PARTITION BY sub, amount_pence ORDER BY created_at, id) AS burst
      FROM starts s
  ), numbered AS (
    SELECT b.*, row_number() OVER (PARTITION BY sub, amount_pence, burst, event_type ORDER BY created_at, id) AS n
      FROM bursts b
  ), pairs AS (
    SELECT p.id AS paid_id, p.held AS paid_held, s.id AS succeeded_id, s.held AS succeeded_held
      FROM numbered p
      JOIN numbered s ON s.sub = p.sub AND s.amount_pence = p.amount_pence AND s.burst = p.burst AND s.n = p.n
     WHERE p.event_type = 'invoice.paid' AND s.event_type = 'invoice.payment_succeeded'
       AND abs(extract(epoch FROM s.created_at - p.created_at)) <= 600
  ), found AS (
    SELECT CASE WHEN succeeded_held THEN paid_id ELSE succeeded_id END AS id,
           CASE WHEN succeeded_held THEN succeeded_id ELSE paid_id END AS duplicate_of
      FROM pairs
     WHERE NOT (succeeded_held AND paid_held)
  ), left_alone AS (
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration', 'donation.duplicates_left', 'donation', NULL,
           jsonb_build_object(
             'reason', 'monthly renewal recorded twice, both copies refunded, claimed or linked, so both kept (TASK-596)',
             'pairs', jsonb_agg(jsonb_build_object('kept', paid_id, 'repeat', succeeded_id) ORDER BY paid_id))
      FROM pairs
     WHERE succeeded_held AND paid_held
    HAVING count(*) > 0
    RETURNING id
  ), kept AS (
    INSERT INTO donations_removed_duplicates (donation_id, duplicate_of, donation_row)
    SELECT d.id, f.duplicate_of, to_jsonb(d) FROM donations d JOIN found f ON f.id = d.id
    RETURNING donation_id, duplicate_of
  ), noted AS (
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration', 'donation.duplicate_removed', 'donation', k.donation_id,
           jsonb_build_object('duplicateOf', k.duplicate_of, 'reason', 'monthly renewal recorded twice (TASK-596)')
      FROM kept k
    RETURNING entity_id
  )
  DELETE FROM donations WHERE id IN (SELECT donation_id FROM kept)`;

exports.up = (pgm) => {
  pgm.addColumns("donations", {
    stripe_invoice_id: {
      type: "text",
      comment: "For a monthly gift's renewal: the Stripe invoice it paid, so it is recorded once. Null for everything else, and for renewals before 6 November 2026.",
    },
  });
  pgm.createIndex("donations", "stripe_invoice_id", { unique: true, where: "stripe_invoice_id IS NOT NULL" });
  pgm.createTable(
    "donations_removed_duplicates",
    {
      donation_id: { type: "integer", primaryKey: true, comment: "The id the double had in donations." },
      duplicate_of: { type: "integer", comment: "The donation it repeated, which stays." },
      donation_row: { type: "jsonb", notNull: true, comment: "The double's whole donations row, as it was." },
      removed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Monthly renewals recorded twice before TASK-596, taken out of donations and kept here." },
  );
  pgm.sql(REMOVE_DOUBLES_SQL);
};

exports.down = (pgm) => {
  pgm.sql(`INSERT INTO donations SELECT (jsonb_populate_record(NULL::donations, donation_row)).* FROM donations_removed_duplicates
           ON CONFLICT (id) DO NOTHING`);
  pgm.dropTable("donations_removed_duplicates");
  pgm.dropIndex("donations", "stripe_invoice_id");
  pgm.dropColumns("donations", ["stripe_invoice_id"]);
};

exports.REMOVE_DOUBLES_SQL = REMOVE_DOUBLES_SQL;
