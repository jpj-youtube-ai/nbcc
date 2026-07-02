const { When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for gift-aid.feature (REQ-048). The in-person donation is seeded via the signed
// Stripe webhook (the global step in stripe-webhook.steps.js); these steps capture the
// donation's declaration_token and drive GET/POST /api/gift-aid/:token. GET/POST use the
// url-encoded form contract the server-rendered page submits.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Self-contained cleanup: the walk-in donor carries a completed declaration (donor RESTRICT),
// so capture the donor ids, delete the donation, then the declaration, then the donor, then
// the event-id ledger — leaving nothing for another feature's cleanup to trip over.
async function clean() {
  const ids = (
    await pool.query("SELECT DISTINCT donor_id FROM donations WHERE stripe_payment_intent_id LIKE 'pi_bdd_ga%'")
  ).rows.map((r) => r.donor_id);
  await pool.query("DELETE FROM donations WHERE stripe_payment_intent_id LIKE 'pi_bdd_ga%'");
  if (ids.length) {
    await pool.query("DELETE FROM declarations WHERE donor_id = ANY($1)", [ids]);
    await pool.query("DELETE FROM donors WHERE id = ANY($1)", [ids]);
  }
  await pool.query("DELETE FROM stripe_webhook_events WHERE id LIKE 'evt_bdd_ga%'");
}

Before({ tags: "@gift-aid" }, clean);
After({ tags: "@gift-aid" }, clean);
AfterAll(async function () {
  await pool.end();
});

When("I capture the declaration token for payment intent {string}", async function (paymentIntent) {
  const r = await pool.query(
    "SELECT declaration_token FROM donations WHERE stripe_payment_intent_id = $1",
    [paymentIntent],
  );
  assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
  this.giftAidToken = r.rows[0].declaration_token;
  assert.ok(this.giftAidToken, "expected a declaration_token to be set");
});

When("I GET the gift aid page for the captured token", async function () {
  const res = await fetch(`${BASE_URL}/api/gift-aid/${encodeURIComponent(this.giftAidToken)}`);
  this.statusCode = res.status;
  this.text = await res.text();
});

When("I POST the gift aid declaration for the captured token", async function () {
  const body = new URLSearchParams({
    firstName: "Ada",
    lastName: "Lovelace",
    houseNameNumber: "12",
    address: "Analytical Avenue, London",
    postcode: "KA1 1AA",
  });
  const res = await fetch(`${BASE_URL}/api/gift-aid/${encodeURIComponent(this.giftAidToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  this.statusCode = res.status;
  this.text = await res.text();
});
