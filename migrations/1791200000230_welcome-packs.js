/* eslint-disable camelcase */

// Welcome packs (Jaimie, 2026-10-03): what staff pack and post to each approved fundraiser and event
// host, ticked off in Admin > Fundraising. A page in memory of someone has no welcome pack: the same
// rows hold its "Things to send" (only what they asked for).
//
//   welcome_packs        one row per fundraiser, made the first time staff tick something, choose
//                        who signs the letter, or mark it sent.
//     sent_at, sent_by   "Pack sent": when, and who ("admin:<email>"). Empty again after Undo.
//     signer             who signs the printed welcome letter, by name, from the admin's "Signed by"
//     signer_role        list, with their title when the list has one, and the staff member who
//     signer_by          chose them (their last choice is offered first on the next letter).
//
//   welcome_pack_items   one row per thing in a pack that staff have ticked or left out. What a pack
//                        holds is worked out from the sign up each time (src/fundraising/welcome-
//                        pack.ts), so a thing nobody has touched needs no row.
//     key                which thing: letter, posters_a4, sponsor_form, tshirt...
//     label, quantity    what it was called and how many, as staff saw it when they ticked it
//     ticked_at          when it was put in the pack
//     skipped_reason     or why it was left out (never both)
//     ticked_by          who ticked it, or left it out
//
// Every change is in audit_log against the fundraiser, in the same transaction. Cleared with the
// fundraiser.
//
// Additive only: two new tables, so a code rollback is safe (golden rule 2). Numbered 1791200000230,
// above everything on its way to main before it (the sign up tidy 210, and 215, 220 and 225).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "welcome_packs",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, unique: true, references: "fundraisers", onDelete: "CASCADE" },
      sent_at: { type: "timestamptz" },
      sent_by: { type: "text" },
      signer: { type: "text" },
      signer_role: { type: "text" },
      signer_by: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: {
        check: [
          "(signer IS NULL OR char_length(signer) <= 100) AND (signer_role IS NULL OR char_length(signer_role) <= 200)",
          "(sent_at IS NULL) = (sent_by IS NULL)",
        ],
      },
      comment: "Welcome packs (and, in memory, things to send): when each was sent, by whom, and who signs its letter.",
    },
  );
  pgm.createTable(
    "welcome_pack_items",
    {
      id: "id",
      pack_id: { type: "integer", notNull: true, references: "welcome_packs", onDelete: "CASCADE" },
      key: { type: "text", notNull: true },
      label: { type: "text", notNull: true },
      quantity: { type: "integer" },
      ticked_at: { type: "timestamptz" },
      ticked_by: { type: "text" },
      skipped_reason: { type: "text" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: {
        unique: ["pack_id", "key"],
        check: [
          "char_length(key) <= 40 AND char_length(label) <= 200",
          "skipped_reason IS NULL OR char_length(skipped_reason) <= 200",
          "ticked_at IS NULL OR skipped_reason IS NULL",
        ],
      },
      comment: "Each thing in a welcome pack that staff have ticked, or left out with a reason.",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("welcome_pack_items");
  pgm.dropTable("welcome_packs");
};
