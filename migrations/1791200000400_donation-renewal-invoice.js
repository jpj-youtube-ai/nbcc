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
//      donations_removed_duplicates beside the gift it repeated, with an audit line. A double is a
//      renewal (a monthly gift with no checkout session, payment intent or charge) recorded within ten
//      minutes after another renewal of the same subscription for the same amount: a real renewal is a
//      month apart. One that has been refunded, put in a Gift Aid claim batch or claimed, or that
//      anything else points at, is left where it is.
//
// The column and the table are additive. Taking the doubles out changes no shape, so a code rollback
// is safe (golden rule 2); down puts them back.

const SAME_PAYMENT = `
  SELECT later.id,
         (SELECT first.id FROM donations first
           WHERE first.stripe_subscription_id = later.stripe_subscription_id
             AND first.id < later.id
             AND first.amount_pence = later.amount_pence
             AND first.mode = 'monthly'
             AND first.stripe_session_id IS NULL AND first.stripe_payment_intent_id IS NULL AND first.stripe_charge_id IS NULL
             AND later.created_at - first.created_at BETWEEN interval '0' AND interval '10 minutes'
           ORDER BY first.id ASC LIMIT 1) AS duplicate_of
    FROM donations later
   WHERE later.mode = 'monthly'
     AND later.stripe_subscription_id IS NOT NULL
     AND later.stripe_session_id IS NULL AND later.stripe_payment_intent_id IS NULL AND later.stripe_charge_id IS NULL
     AND later.stripe_invoice_id IS NULL
     AND later.refunded_amount_pence = 0
     AND later.claim_batch_id IS NULL
     AND later.claim_status IN ('eligible', 'not_eligible')
     AND NOT EXISTS (SELECT 1 FROM donation_benefits x WHERE x.donation_id = later.id)
     AND NOT EXISTS (SELECT 1 FROM donation_partner_shares x WHERE x.donation_id = later.id)
     AND NOT EXISTS (SELECT 1 FROM claim_adjustments x WHERE x.donation_id = later.id)
     AND NOT EXISTS (SELECT 1 FROM fundraiser_thank_gifts x WHERE x.donation_id = later.id)
     AND NOT EXISTS (SELECT 1 FROM sponsor_pledges x WHERE x.donation_id = later.id)
     AND NOT EXISTS (SELECT 1 FROM donation_invoices x WHERE x.donation_id = later.id)`;

// Keeps each double's row and an audit line, then takes it out of donations. Re-runnable: a double
// already taken out is no longer there to find. Exported for the BDD that proves it on Postgres.
const REMOVE_DOUBLES_SQL = `
  WITH found AS (
    SELECT id, duplicate_of FROM (${SAME_PAYMENT}) s WHERE duplicate_of IS NOT NULL
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
