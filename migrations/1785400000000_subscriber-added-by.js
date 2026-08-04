/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration (1785300000000), NOT the
// wall-clock stamp `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-278 (letter N): WHO put this person on the list.
//
// consent_source already recorded HOW someone arrived — 'footer' (they signed up), 'import' (a
// spreadsheet) or 'admin' (typed in by staff) — and consented_at recorded WHEN. What it could not
// answer was "which of us added them?", which is the first question asked when an address turns out
// to be wrong, or when someone says they never signed up. For 'footer' the answer is the person
// themselves; for the other two there is a member of staff behind it, and the audit is only complete
// if that is on the row.
//
// Nullable by design: every existing membership predates this and there is no honest value to
// backfill. A blank means "added before we recorded this", not "added by nobody" — inventing an
// actor for historic rows would be worse than admitting we don't know.
//
// Additive: one nullable column.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("list_subscribers", {
    added_by: { type: "text" }, // the admin's email for staff adds and imports; NULL for self-signup
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("list_subscribers", ["added_by"]);
};
