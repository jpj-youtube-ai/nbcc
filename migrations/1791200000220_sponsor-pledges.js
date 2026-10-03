/* eslint-disable camelcase */

// Sponsor pledges (Jaimie, 2026-10-03): "Sponsor now, pay after" on a sponsorship fundraiser's page.
//
//   sponsor_pledges   one row per pledge: a PROMISE, never money. Who pledged (first name, surname,
//                     email), how much (£2 to £1,000), an optional message and the wall choices, and,
//                     when they ticked Gift Aid, their home address and the exact declaration they
//                     agreed to (its words, their version and when), made now for a payment made later.
//                     A pledge starts "unconfirmed": the sponsor is emailed a link, and only once they
//                     press Confirm is it "open" (shown on the page, listed for the organiser, and
//                     later emailed the pay link). One never confirmed is deleted after 7 days.
//                     It stays "open" until it is paid online ("paid", with the donation and the
//                     declaration that payment made), marked by the organiser as paid to them in cash
//                     ("cash"), cancelled by the sponsor or by staff ("cancelled"), or anonymised
//                     unpaid ("expired"). It never counts on the meter: only the donation made when it
//                     is paid does.
//                     The two later emails (the pay link the day after the event, one reminder a week
//                     later) are each claimed here BEFORE they are sent, so neither ever goes twice.
//                     pay_email_sent_at is the FIRST pay email; a pay link staff send by hand is
//                     counted apart (pay_email_last_sent_at, pay_email_resends), so the reminder and
//                     the 90 day clocks never restart.
//                     token_nonce is part of what the emailed links' signatures cover, so a link can
//                     be made useless by changing it (it is changed when a pledge is paid, cancelled
//                     or un-marked as cash).
//                     checkout_session_id is the Stripe checkout it last opened, so a newer one can
//                     close it and nobody pays twice; double_paid_* flags one that was paid twice
//                     anyway (or paid online after being marked as cash), for staff to check and refund.
//                     hidden_at: its organiser took it off their page (staff are told).
//                     Personal details are nullable: an unpaid pledge is anonymised 90 days after its
//                     pay email (anonymised_at), keeping only the amount.
//                     Cleared with the fundraiser it belongs to.
//   sponsor_pledge_declarations
//                     when the Gift Aid declaration made with a pledge was made, and its exact words,
//                     kept beside the donation and the declaration the payment made. Plain numbers,
//                     tied to nothing: it outlives the pledge and the fundraiser, so a claim can
//                     always show the declaration was made before the payment.
//
// Additive only: two new tables and their indexes, so a code rollback is safe (golden rule 2).
// Numbered 1791200000220: after 205 on main and the 215 that an open change uses.

exports.shorthands = undefined;

const STATUSES = "'unconfirmed', 'open', 'paid', 'cash', 'cancelled', 'expired'";

exports.up = (pgm) => {
  pgm.createTable(
    "sponsor_pledges",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      first_name: { type: "text" },
      surname: { type: "text" },
      email: { type: "text" },
      amount_pence: { type: "integer", notNull: true, check: "amount_pence >= 200 AND amount_pence <= 100000" },
      message: { type: "text" },
      message_hidden: { type: "boolean", notNull: true, default: false },
      show_name: { type: "boolean", notNull: true, default: false },
      show_amount: { type: "boolean", notNull: true, default: true },
      // The Gift Aid declaration made with the pledge, for a payment made later.
      gift_aid: { type: "boolean", notNull: true, default: false },
      ga_house: { type: "text" },
      ga_address: { type: "text" },
      ga_postcode: { type: "text" },
      ga_non_uk: { type: "boolean", notNull: true, default: false },
      ga_wording_version: { type: "text" },
      ga_wording_snapshot: { type: "text" },
      ga_declared_at: { type: "timestamptz" },
      status: { type: "text", notNull: true, default: "unconfirmed", check: `status IN (${STATUSES})` },
      token_nonce: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      // Confirm by email: the sponsor presses Confirm in the one email sent when they pledge.
      confirm_email_sent_at: { type: "timestamptz" },
      confirmed_at: { type: "timestamptz" },
      // Hidden from the page by its organiser (staff are told); never deleted.
      hidden_at: { type: "timestamptz" },
      hidden_by: { type: "text" },
      // Each email is claimed before it is sent, and marked sent once it has gone.
      pay_email_claimed_at: { type: "timestamptz" },
      pay_email_sent_at: { type: "timestamptz" },
      reminder_claimed_at: { type: "timestamptz" },
      reminder_sent_at: { type: "timestamptz" },
      // A pay link staff send by hand: the latest send (and a ten minute hold), and how many.
      pay_email_last_sent_at: { type: "timestamptz" },
      pay_email_resends: { type: "integer", notNull: true, default: 0 },
      // The Stripe checkout last opened for it: closed before another is opened.
      checkout_session_id: { type: "text" },
      // Paid online: the donation the payment made, and the declaration it carried.
      paid_at: { type: "timestamptz" },
      paid_amount_pence: { type: "integer" },
      donation_id: { type: "integer", references: "donations", onDelete: "SET NULL" },
      declaration_id: { type: "integer", references: "declarations", onDelete: "SET NULL" },
      // Paid twice, or paid online after being marked as cash: for staff to check and refund.
      double_paid_at: { type: "timestamptz" },
      double_paid_donation_id: { type: "integer" },
      double_paid_alerted_at: { type: "timestamptz" },
      double_paid_checked_at: { type: "timestamptz" },
      double_paid_checked_by: { type: "text" },
      cash_marked_at: { type: "timestamptz" },
      cash_marked_by: { type: "text" },
      cancelled_at: { type: "timestamptz" },
      cancelled_by: { type: "text" },
      anonymised_at: { type: "timestamptz" },
    },
    {
      constraints: {
        check:
          "NOT gift_aid OR anonymised_at IS NOT NULL OR status NOT IN ('unconfirmed', 'open') OR (ga_wording_snapshot IS NOT NULL AND ga_declared_at IS NOT NULL)",
      },
      comment: "Sponsor pledges: a promise to pay after the event, never money until paid (Jaimie, 2026-10-03).",
    },
  );
  pgm.createIndex("sponsor_pledges", ["fundraiser_id", "created_at"]);
  pgm.createIndex("sponsor_pledges", ["status"], { where: "status IN ('unconfirmed', 'open')", name: "sponsor_pledges_live_idx" });

  pgm.createTable(
    "sponsor_pledge_declarations",
    {
      id: "id",
      // Plain numbers, no foreign keys: this row must outlive the pledge and its fundraiser.
      pledge_id: { type: "integer", notNull: true },
      donation_id: { type: "integer", notNull: true },
      declaration_id: { type: "integer" },
      declared_at: { type: "timestamptz", notNull: true },
      wording_version: { type: "text" },
      wording_snapshot: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "When the Gift Aid declaration made with a sponsor pledge was made, kept with the donation it covers." },
  );
  pgm.createIndex("sponsor_pledge_declarations", ["donation_id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("sponsor_pledge_declarations");
  pgm.dropTable("sponsor_pledges");
};
