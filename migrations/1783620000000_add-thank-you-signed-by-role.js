/* eslint-disable */
// TASK-165 (REQ-069): add signed_by_role to thank_you_sent so the signatory's title (e.g. "Head Elf
// (Trustee), Night Before Christmas Campaign") can be re-rendered on the printable letter page and in
// the emailed letter. Previously the role was presentation-only and not stored, so a letter re-opened
// from its stored row lost it.
//
// Additive / expand-contract (golden rule 2): one NEW, NULLABLE column on an existing table — no
// drop/rename, nothing made NOT NULL, so older rows (role unknown) read as NULL and a code-level
// rollback stays safe. The down() drops the added column.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("thank_you_sent", {
    signed_by_role: { type: "text" }, // nullable: the signatory's title/role shown on the letter
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("thank_you_sent", "signed_by_role");
};
