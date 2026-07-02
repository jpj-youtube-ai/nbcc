const { Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for supporters.feature (REQ-035). Donors are seeded via the signed Stripe
// webhook (the global "I POST a signed Stripe … webhook event:" step in
// stripe-webhook.steps.js); the GET + "response body should contain" steps are the
// shared ones in health.steps.js. This file adds the @supporters cleanup and the
// "should not contain" assertion. The pool uses the same DATABASE_URL the app writes to.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Fresh start: remove any supporters seeded by a previous run so the wall is
// deterministic. Donations first (they reference the donor), then the donors.
Before({ tags: "@supporters" }, async function () {
  await pool.query("DELETE FROM donations WHERE stripe_payment_intent_id LIKE 'pi_bdd_sup%'");
  await pool.query("DELETE FROM donors WHERE email LIKE '%sup.bdd@example.com'");
});

Then("the response body should not contain {string}", function (unexpected) {
  assert.ok(
    !this.text.includes(unexpected),
    `expected response body NOT to contain "${unexpected}"`,
  );
});

AfterAll(async function () {
  await pool.end();
});
