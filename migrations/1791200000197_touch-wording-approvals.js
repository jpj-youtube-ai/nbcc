/* eslint-disable camelcase */

// Jaimie, 2026-10-03: new automatic email wording only sends once an admin has approved it in
// Admin > Fundraising > Automatic emails. Before this the preview said "waiting for sign off" but
// switching the emails on sent everything.
//
//   touch_wording_approvals    one row per approved wording (WORDING_KEYS in
//                              src/fundraising/touch-rules.ts: the four new wordings, and the nothing
//                              raised versions of 16, 17 and 18 as "<kind>_zero"), with when and by
//                              whom. No row, not approved: the sender skips that email and does not
//                              claim it, so it can still go once approved while it is due.
//
// Seeded with the three Jaimie approved on 2026-10-03 (target, need_a_hand, on_track), each with a
// History row. Finished and the three nothing raised versions are left waiting for her sign off.
//
// Additive only: one new table and its rows, so a code rollback is safe (golden rule 2). Numbered
// 1791200000197: after 190 on main and the 195 and 196 that open changes use, before 200.

exports.shorthands = undefined;

const APPROVED = ["target", "need_a_hand", "on_track"];
const ON = "TIMESTAMPTZ '2026-10-03 12:00:00+01'";

exports.up = (pgm) => {
  pgm.createTable(
    "touch_wording_approvals",
    {
      key: { type: "text", primaryKey: true },
      approved_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      approved_by: { type: "text", notNull: true },
    },
    { comment: "Which new automatic email wordings an admin has approved; only those are sent (Jaimie, 2026-10-03)." },
  );
  pgm.sql(`
    INSERT INTO touch_wording_approvals (key, approved_at, approved_by) VALUES
      ${APPROVED.map((k) => `('${k}', ${ON}, 'Jaimie')`).join(",\n      ")}
    ON CONFLICT (key) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO audit_log (actor, action, entity, entity_id, data)
    SELECT 'migration:touch-wording-approvals', 'fundraising.touch_wording_approved', 'fundraising_settings', 1,
           jsonb_build_object('key', k, 'approvedBy', 'Jaimie', 'approvedOn', '2026-10-03')
      FROM unnest(ARRAY[${APPROVED.map((k) => `'${k}'`).join(", ")}]) AS k
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("touch_wording_approvals");
};
