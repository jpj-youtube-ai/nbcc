const { When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for supporters.feature (REQ-035; opt-in monthly 4-band rework TASK-223). Supporters are
// seeded via the signed Stripe webhook (the global "I POST a signed Stripe … webhook event:" step in
// stripe-webhook.steps.js); the GET + "response body should contain" steps are the shared ones in
// health.steps.js. This file adds the @supporters cleanup, the "should not contain" assertion, and the
// two opt-in steps that set consent the way the app does (individual: donors.list_on_supporters;
// business: the fulfilment record's list_on_supporters + captured_at). The pool uses the same
// DATABASE_URL the app writes to.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Fresh start: remove any supporters seeded by a previous run so the wall is deterministic. This
// feature now seeds MONTHLY (subscription) donations too — whose parent donation has a NULL payment
// intent and a sub_bdd_sup_* id — plus, for a business, a business_supporter_fulfilment row (FK
// RESTRICT to donors). Capture the donor ids by the shared email marker, then delete dependents in FK
// order (fulfilment + donations + declarations) before the donors.
Before({ tags: "@supporters" }, async function () {
  const { rows } = await pool.query("SELECT id FROM donors WHERE email LIKE '%sup.bdd@example.com'");
  const donorIds = rows.map((r) => r.id);
  if (donorIds.length) {
    await pool.query("DELETE FROM business_supporter_fulfilment WHERE donor_id = ANY($1)", [donorIds]);
    await pool.query("DELETE FROM donations WHERE donor_id = ANY($1)", [donorIds]);
    await pool.query("DELETE FROM declarations WHERE donor_id = ANY($1)", [donorIds]);
    // subscription_dunning FK-references donors with onDelete RESTRICT (TASK-240 adds a cancelled_at
    // row here), so it must be cleared before the donors it points at.
    await pool.query("DELETE FROM subscription_dunning WHERE donor_id = ANY($1)", [donorIds]);
    await pool.query("DELETE FROM donors WHERE id = ANY($1)", [donorIds]);
  }
  // Belt-and-braces: clear any donations left by the pi/sub markers (defensive), and the event ledger
  // so a re-run's fixed-id events are not treated as duplicates (CI is fresh regardless).
  await pool.query(
    "DELETE FROM donations WHERE stripe_payment_intent_id LIKE 'pi_bdd_sup%' OR stripe_subscription_id LIKE 'sub_bdd_sup%'",
  );
  await pool.query("DELETE FROM stripe_webhook_events WHERE id LIKE 'evt_bdd_%'");
});

// Individual opt-in: the donor chose to appear on the wall under a display name — donors.list_on_supporters
// + donors.credit_name (what the later individual thank-you page will write; here we set it directly).
When(
  "the donor with email {string} opts into the supporters wall as {string}",
  async function (email, creditName) {
    await pool.query("UPDATE donors SET list_on_supporters = true, credit_name = $2 WHERE email = $1", [
      email,
      creditName,
    ]);
  },
);

// Business opt-in: the business submitted its thank-you form choosing to appear — the fulfilment
// record's list_on_supporters + a captured_at stamp + credit_name (what postFulfilment writes; here we
// set it directly on the record the webhook created for that donor).
When(
  "the business with email {string} opts into the supporters wall as {string}",
  async function (email, creditName) {
    await pool.query(
      `UPDATE business_supporter_fulfilment f
          SET list_on_supporters = true, captured_at = now(), credit_name = $2
         FROM donors dn
        WHERE dn.id = f.donor_id AND dn.email = $1`,
      [email, creditName],
    );
  },
);

// Grandfathered (TASK-228): the pre-223 wall's set is snapshotted by the migration backfill
// (donors.grandfathered_on_supporters) at deploy time — there is no app action for it, so here we set
// the flag directly, the same way the opt-in steps set consent directly. A grandfathered donor appears
// on the wall WITHOUT opting in, banded by their max paid amount (any frequency).
When(
  "the donor with email {string} is grandfathered onto the supporters wall",
  async function (email) {
    await pool.query("UPDATE donors SET grandfathered_on_supporters = true WHERE email = $1", [email]);
  },
);

// TASK-240: record a VOLUNTARY cancellation the way the webhook does (subscription_dunning.cancelled_at),
// backdated by the given number of days so the grace-window arithmetic in listPublicSupporters is
// exercised end to end. Joins the donor's monthly donation to reuse its subscription id.
// TASK-246: seed REALISTICALLY — the last paid gift comes BEFORE the cancel (you pay, then later cancel),
// so backdate the donation to a few days before the cancel. The recovery-aware active-sub check treats a
// gift dated AFTER an end as a recovery, so a "now" donation with a back-dated cancel would wrongly read
// as still-active.
When(
  "the donor with email {string} cancelled their subscription {int} days ago",
  async function (email, days) {
    // Backdate the donor's monthly gift to before the cancel.
    await pool.query(
      `UPDATE donations SET created_at = now() - make_interval(days => $2::int + 5)
        WHERE id = (SELECT d.id FROM donations d JOIN donors dn ON dn.id = d.donor_id
                     WHERE dn.email = $1 AND d.mode = 'monthly' AND d.stripe_subscription_id IS NOT NULL
                     ORDER BY d.id ASC LIMIT 1)`,
      [email, days],
    );
    await pool.query(
      `INSERT INTO subscription_dunning (donor_id, stripe_subscription_id, status, failed_attempts, cancelled_at)
       SELECT dn.id, d.stripe_subscription_id, 'active', 0, now() - make_interval(days => $2::int)
         FROM donors dn JOIN donations d ON d.donor_id = dn.id
        WHERE dn.email = $1 AND d.mode = 'monthly' AND d.stripe_subscription_id IS NOT NULL
        ORDER BY d.id ASC LIMIT 1
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET cancelled_at = EXCLUDED.cancelled_at`,
      [email, days],
    );
  },
);

// TASK-246: a RECOVERY — the donor lapsed/cancelled long ago (beyond the grace window) but is paying
// again, so their latest monthly gift is dated AFTER the end. We stamp a cancel 60 days ago while the
// donor's monthly gift stays at "now" (the webhook created it now, un-backdated), so the gift is after
// the end and the active-sub check keeps the donor despite the old cancel.
When(
  "the donor with email {string} cancelled long ago but is paying again",
  async function (email) {
    await pool.query(
      `INSERT INTO subscription_dunning (donor_id, stripe_subscription_id, status, failed_attempts, cancelled_at)
       SELECT dn.id, d.stripe_subscription_id, 'active', 0, now() - make_interval(days => 60)
         FROM donors dn JOIN donations d ON d.donor_id = dn.id
        WHERE dn.email = $1 AND d.mode = 'monthly' AND d.stripe_subscription_id IS NOT NULL
        ORDER BY d.id ASC LIMIT 1
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET cancelled_at = EXCLUDED.cancelled_at`,
      [email],
    );
  },
);

Then("the response body should not contain {string}", function (unexpected) {
  assert.ok(!this.text.includes(unexpected), `expected response body NOT to contain "${unexpected}"`);
});

AfterAll(async function () {
  await pool.end();
});
