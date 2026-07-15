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

Then("the response body should not contain {string}", function (unexpected) {
  assert.ok(!this.text.includes(unexpected), `expected response body NOT to contain "${unexpected}"`);
});

AfterAll(async function () {
  await pool.end();
});
