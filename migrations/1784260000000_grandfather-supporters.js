/* eslint-disable */
// TASK-228 (grandfather the pre-223 supporters wall): TASK-223 turned the public /supporters wall
// OPT-IN + MONTHLY-only. To make sure nobody the OLD (pre-223) wall recognised is LOST when that goes
// live, this adds a grandfather flag and, in the SAME up(), takes a ONE-TIME snapshot of the old wall's
// set by back-filling the flag to true for them. NEW donors default false, so from launch onward
// everyone uses the existing opt-in flow.
//
// Additive / expand-contract (golden rule 2): one brand-new NOT-NULL boolean WITH a default(false) — so
// every existing row back-fills safely — plus a one-time data UPDATE. No column is dropped, renamed or
// made NOT NULL on existing data, so a code-level rollback stays safe. down() drops the column. Mirrors
// the additive-column style of 1784198523000 (supporters-optin-columns) and the data-backfill style of
// 1783715098494 (partners-hidden-by-default). Independent of the other additive migrations (order
// between them does not matter).
//
// The backfill reproduces the OLD wall's inclusion set. The pre-223 wall (git 8d2f829,
// listPublicSupporters) showed a donor iff NOT anonymous AND they had at least one donation, banded by
// their MAX amount_pence. The grandfather render path re-bands by the donor's MAX *paid* amount, so the
// snapshot here is: NOT anonymous AND EXISTS a payment_status='paid' donation. A donor whose gifts are
// ALL unpaid/failed has no bandable paid amount and was never a settled supporter, so is not
// grandfathered. anonymous donors are excluded exactly as isPubliclyListable does on the wall. The
// UPDATE runs per environment at deploy time, so it snapshots each env's real donors (on prod, the
// actual current supporters); it is idempotent — re-running matches the same set.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("donors", {
    // TASK-228 grandfather flag: TRUE keeps a donor on the wall without the TASK-223 opt-in. Default
    // false so every NEW donor (from launch onward) must opt in via the existing flow.
    grandfathered_on_supporters: { type: "boolean", notNull: true, default: false },
  });
  // One-time snapshot of the OLD (pre-223) wall's set: NOT anonymous AND has >= 1 PAID donation.
  pgm.sql(`
    UPDATE donors dn
       SET grandfathered_on_supporters = true
     WHERE dn.anonymous = false
       AND EXISTS (
             SELECT 1
               FROM donations d
              WHERE d.donor_id = dn.id
                AND d.payment_status = 'paid'
           );
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn("donors", "grandfathered_on_supporters");
};
