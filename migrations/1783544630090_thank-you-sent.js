/* eslint-disable */
// TASK-161 (REQ-069): the thank_you_sent table — one row per thank-you letter
// sent to a donor or in-kind giver. It powers three things: the "already thanked"
// dedupe on the eligible-donors list, an audit-trail entry per send, and the Sent
// history view. Enough of each letter is stored to re-render its PDF on demand
// (recipient names, gift snapshot, personal message, signatory).
//
// Additive / expand-contract (golden rule 2): a single BRAND-NEW table plus its
// own index. No existing table/column is dropped, renamed or made NOT NULL, and
// the only foreign key (donor_id) is NULLABLE with ON DELETE SET NULL, so the
// history row survives a donor removal and a code-level rollback stays safe.
// donor_id is nullable because in-kind givers (a company or church that donated
// goods) may not exist as a donor row.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "thank_you_sent",
    {
      id: "id",
      // NULL for a giver who isn't a donor row (e.g. a company/church gift in kind).
      donor_id: { type: "integer", references: "donors", onDelete: "SET NULL" },
      thank_you_name: { type: "text", notNull: true }, // "Thank you, <name>." — person or organisation
      addressed_to: { type: "text", notNull: true }, // "Dear <name>," — the contact person
      recipient_email: { type: "text", notNull: true }, // where the letter was emailed
      gift_type: {
        type: "text",
        notNull: true,
        check: "gift_type IN ('money', 'in_kind')",
      },
      gift_amount_pence: { type: "integer", check: "gift_amount_pence > 0" }, // set for money gifts
      gift_in_kind: { type: "text" }, // description, set for in-kind gifts
      gift_aided: { type: "boolean", notNull: true, default: false }, // drives the 25% uplift line
      personal_message: { type: "text" }, // optional free-text note added to the letter
      signed_by_name: { type: "text", notNull: true }, // signatory shown on the letter
      sent_by: { type: "text", notNull: true }, // the logged-in admin who sent it (audit; may differ from the signatory)
      sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      comment:
        "One row per thank-you letter sent (REQ-069): powers dedupe, audit and the Sent history; stores enough to re-render the PDF.",
      // A money gift carries an amount; an in-kind gift carries a description.
      constraints: {
        check:
          "(gift_type = 'money' AND gift_amount_pence IS NOT NULL) OR (gift_type = 'in_kind' AND gift_in_kind IS NOT NULL)",
      },
    },
  );
  // per-donor lookup for the "has this donor been thanked?" dedupe.
  pgm.createIndex("thank_you_sent", "donor_id");
};

exports.down = (pgm) => {
  pgm.dropTable("thank_you_sent");
};
