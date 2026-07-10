/* eslint-disable */
// TASK-182 (REQ-003): the seeded partners should start HIDDEN so staff can review the list and switch
// each partner on when they're ready — rather than the whole 127-name batch appearing at once. Runs
// right after the seed (1783709948147), so on a fresh prod the partners are inserted then hidden.
//
// Data-only and additive/expand-contract (golden rule 2): flips a boolean flag on existing rows — no
// schema change, nothing dropped/renamed. Scoped to currently-active rows so re-running is a no-op
// and admins can freely re-activate afterwards (this migration runs once per environment). down()
// re-shows them (best-effort reverse).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`UPDATE supporter_ticker SET active = false WHERE active = true;`);
};

exports.down = (pgm) => {
  pgm.sql(`UPDATE supporter_ticker SET active = true WHERE active = false;`);
};
