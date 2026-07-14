/* eslint-disable */
// TASK-223 (REQ / supporters wall opt-in): the public supporters wall becomes OPT-IN. Individuals now
// choose whether to appear (and under what name), and an admin can hide anyone. These are the
// individual-consent + admin-hide columns; business consent stays in its own business_supporter_fulfilment
// table (migration 1783961442118).
//
// Additive / expand-contract: three brand-new columns on donors — two NOT-NULL booleans WITH a
// default(false) and one NULLABLE text — so every existing donor row back-fills safely (opted OUT by
// default, not hidden, no custom name) and no existing column is dropped, renamed or made NOT NULL on
// existing data. A code-level rollback stays safe (golden rule 2). Independent of the earlier additive
// migrations (order between them does not matter). Mirrors the additive column style of
// 1783054395270 (donor-billing-address) and 1783062309816 (donation-payment-status).
//
//   list_on_supporters     — the individual opt-in: the donor asked to be shown on the wall.
//   credit_name            — the individual's chosen public display name (falls back to full_name).
//   hidden_from_supporters — an admin override that removes a donor from the wall regardless of opt-in.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("donors", {
    // Individual opt-in; default hidden (opt-in, not opt-out), mirroring
    // business_supporter_fulfilment.list_on_supporters.
    list_on_supporters: { type: "boolean", notNull: true, default: false },
    // The individual's chosen public display name; NULL until they set one (wall falls back to full_name).
    credit_name: { type: "text" },
    // Admin "hide from wall" override; default false (visible). The wall query excludes a hidden donor.
    hidden_from_supporters: { type: "boolean", notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("donors", ["list_on_supporters", "credit_name", "hidden_from_supporters"]);
};
