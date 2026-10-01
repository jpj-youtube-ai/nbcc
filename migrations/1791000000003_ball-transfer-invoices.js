/* eslint-disable camelcase */

// TASK-486: paying for the Festive Ball by bank transfer, stage 3 (invoices; see
// docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md).
//
// Additive only (golden rule 2), all nullable. A booking has an invoice when invoice_company is set.
//   invoice_company          the company the invoice is made out to
//   invoice_address          its postal address, as typed (several lines)
//   invoice_po               the company's purchase order number, if it gave one
//   invoice_accounts_email   its accounts team, copied in on the invoice emails, if given
//   invoice_phone            a number for chasing an unpaid invoice, if given
//
// Numbered after stage 2 (1791000000002), the highest on main.

exports.up = (pgm) => {
  pgm.addColumns("ball_bookings", {
    invoice_company: { type: "text" },
    invoice_address: { type: "text" },
    invoice_po: { type: "text" },
    invoice_accounts_email: { type: "text" },
    invoice_phone: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_bookings", [
    "invoice_company",
    "invoice_address",
    "invoice_po",
    "invoice_accounts_email",
    "invoice_phone",
  ]);
};
