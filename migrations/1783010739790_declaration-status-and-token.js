/* eslint-disable */
// TASK-074 (REQ-057): postal/telephone Gift Aid declaration confirmation lifecycle.
// Additive / expand-contract: two brand-new columns on donations, both safe on
// populated data — declaration_status is NOT NULL WITH a default ('not_required', which
// every existing online-captured donation back-fills to, needing no letter), and
// declaration_token is NULLABLE. No existing column is dropped, renamed or made NOT NULL
// on populated data, so a code-level rollback stays safe (golden rule 2). Independent of
// the earlier additive migrations (order between them does not matter).
//
// declaration_status tracks the confirmation letter/link flow for a declaration captured
// where no wet/online signature exists (in-person, telephone): a donor must confirm it
// before the gift is claimable. declaration_token is the unguessable token embedded in
// that confirmation link (unique so it addresses exactly one donation). The pure
// transition rules live in src/declarations/status.ts; the code that sends letters and
// flips the status through the token is a LATER task — this only lays the columns.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("donations", {
    // The confirmation lifecycle. 'not_required' is the default (an online/at-checkout
    // declaration needs no separate confirmation); 'pending' → a confirmation is owed;
    // 'sent' → the letter/link was dispatched; 'undelivered' → it bounced; 'completed' →
    // the donor confirmed. The CHECK pins the allowed values at the column level.
    declaration_status: {
      type: "text",
      notNull: true,
      default: "not_required",
      check:
        "declaration_status IN ('not_required','pending','sent','undelivered','completed')",
    },
    // The unguessable token in the confirmation link, addressing exactly one donation.
    // NULLABLE (only a declaration awaiting confirmation has one) and UNIQUE (Postgres
    // allows many NULLs under a unique constraint, so unconfirmed rows do not collide).
    declaration_token: { type: "text", unique: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("donations", ["declaration_status", "declaration_token"]);
};
