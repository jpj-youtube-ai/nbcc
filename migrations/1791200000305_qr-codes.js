/* eslint-disable camelcase */

// TASK-588: named QR codes (src/site/qr-named.ts). Staff make a code for each place one is printed
// (a billboard, a business card), name it, and pick where it goes; each code counts its own scans.
//
// Additive only (golden rule 2): two new tables, nothing else touched.
//   - qr_codes: one row per named code. Its id is its short link, /q/c<id>, printed for good, so a
//     row is never deleted: a code staff have finished with is hidden, and it still forwards.
//   - qr_code_scans: one number per code per UK day. Nothing about the person scanning is kept.
//
// Numbered 1791200000305: after the Festive Ball chase's 300, the newest production has run, and
// below 310, which the open Elf Detective School pull request (#711) has taken, so whichever of the
// two merges first, the other still sorts after everything production has run.

exports.up = (pgm) => {
  pgm.createTable("qr_codes", {
    id: "id",
    name: { type: "text", notNull: true, comment: "What staff call it, e.g. a billboard's place. Staff only." },
    target: {
      type: "text",
      notNull: true,
      comment: "Where it goes: a path on nbcc.scot, or one of the sign up sites. Only ever a value from the admin's list.",
    },
    hidden: { type: "boolean", notNull: true, default: false },
    created_by: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "text", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("qr_codes", "qr_codes_name_length", { check: "char_length(name) BETWEEN 1 AND 80" });

  pgm.createTable("qr_code_scans", {
    code_id: { type: "integer", notNull: true, references: "qr_codes", onDelete: "CASCADE" },
    day: { type: "date", notNull: true, comment: "The UK date of the scans." },
    scans: { type: "integer", notNull: true, default: 0 },
  });
  pgm.addConstraint("qr_code_scans", "qr_code_scans_pkey", { primaryKey: ["code_id", "day"] });
};

exports.down = (pgm) => {
  pgm.dropTable("qr_code_scans");
  pgm.dropTable("qr_codes");
};
