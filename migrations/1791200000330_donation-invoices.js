/* eslint-disable camelcase */

// Invoices for donations (src/invoices/model.ts; docs/superpowers/specs/2026-11-05-donation-invoices-design.md).
// Staff send an invoice from Admin > Giving > Invoices; the person pays it by card or bank transfer from
// a private page; a paid invoice becomes one ordinary donation.
//
// Additive only (golden rule 2): two new tables and one new nullable column, nothing else touched.
//   - donation_invoices: one row per invoice. Its id makes its number (INV-0012) and the bank transfer
//     reference. Never deleted: a sent invoice is cancelled, so what the person was sent and what we
//     hold stay the same. While it waits, a person's Gift Aid declaration is kept in gift_aid, and only
//     becomes a declarations row when the invoice is paid.
//   - donation_invoice_settings: one row, the bank details printed on invoices. Its own, so the Festive
//     Ball's settings can never change them.
//   - donations.invoice_id: the invoice a donation paid, so Donations can label it. A payment that
//     arrives twice makes two donations that both point at their invoice.
// Both links are SET NULL on delete, so neither ever stops a donation or an invoice being erased.
//
// Numbered 1791200000330: after Elf Detective School's 320, the newest on main.

exports.up = (pgm) => {
  pgm.createTable("donation_invoices", {
    id: "id",
    payer_kind: { type: "text", notNull: true, comment: "person, business or group. A business or group is never Gift Aided." },
    contact_name: { type: "text", notNull: true },
    org_name: { type: "text", comment: "The business or group's name; null for a person." },
    email: { type: "text", notNull: true },
    address: { type: "text" },
    postcode: { type: "text" },
    consideration_given: {
      type: "boolean",
      comment: "A business only: whether NBCC gives anything in return (advertising, a logo). Yes flags the gift for the trustees.",
    },
    description: { type: "text", notNull: true },
    note: { type: "text" },
    amount_pence: { type: "integer", notNull: true },
    issued_on: { type: "date", notNull: true, comment: "The UK date it was made and sent." },
    due_on: { type: "date", notNull: true },
    status: { type: "text", notNull: true, default: "waiting" },
    paid_on: { type: "date", comment: "The UK date the first payment arrived." },
    paid_by: { type: "text" },
    donation_id: { type: "integer", references: "donations", onDelete: "SET NULL", comment: "The donation the first payment became." },
    cancelled_at: { type: "timestamptz" },
    paid_twice_at: { type: "timestamptz", comment: "When a second payment arrived for an invoice already paid." },
    paid_twice_alerted_at: { type: "timestamptz" },
    gift_aid: { type: "jsonb", comment: "A person's Gift Aid declaration details, saved from the invoice page before paying." },
    gift_aid_at: { type: "timestamptz" },
    send_count: { type: "integer", notNull: true, default: 0 },
    last_sent_at: { type: "timestamptz" },
    created_by: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "text", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("donation_invoices", "donation_invoices_payer_kind", { check: "payer_kind IN ('person', 'business', 'group')" });
  pgm.addConstraint("donation_invoices", "donation_invoices_status", { check: "status IN ('waiting', 'paid', 'cancelled')" });
  pgm.addConstraint("donation_invoices", "donation_invoices_paid_by", { check: "paid_by IS NULL OR paid_by IN ('card', 'transfer')" });
  pgm.addConstraint("donation_invoices", "donation_invoices_amount", { check: "amount_pence BETWEEN 100 AND 5000000" });
  pgm.addConstraint("donation_invoices", "donation_invoices_org", { check: "payer_kind = 'person' OR org_name IS NOT NULL" });
  pgm.createIndex("donation_invoices", "status");

  pgm.createTable("donation_invoice_settings", {
    id: { type: "integer", primaryKey: true, default: 1 },
    account_name: { type: "text" },
    sort_code: { type: "text" },
    account_number: { type: "text" },
    updated_by: { type: "text" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("donation_invoice_settings", "donation_invoice_settings_one_row", { check: "id = 1" });

  pgm.addColumns("donations", {
    invoice_id: {
      type: "integer",
      references: "donation_invoices",
      onDelete: "SET NULL",
      comment: "The invoice this donation paid (Admin > Giving > Invoices). NULL for every other gift.",
    },
  });
  pgm.createIndex("donations", "invoice_id", { where: "invoice_id IS NOT NULL" });
};

exports.down = (pgm) => {
  pgm.dropIndex("donations", "invoice_id", { ifExists: true });
  pgm.dropColumns("donations", ["invoice_id"], { ifExists: true });
  pgm.dropTable("donation_invoice_settings");
  pgm.dropTable("donation_invoices");
};
