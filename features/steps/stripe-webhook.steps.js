const { When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { Pool } = require("pg");

// Steps for stripe-webhook.feature (REQ-036). Signs events with the same
// STRIPE_WEBHOOK_SECRET the running app verifies against, using the Stripe SDK's
// offline test-header helper (no live account) — the stub-seam philosophy from
// checkout.feature. DB assertions use the same DATABASE_URL the app writes to.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // key unused: generateTestHeaderString is pure HMAC
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let seq = 0;
function envelope(type, object) {
  seq += 1;
  return JSON.stringify({
    id: `evt_bdd_${Date.now()}_${seq}`,
    object: "event",
    type,
    data: { object },
  });
}

async function postWebhook(payload, signature) {
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  return res;
}

// Fresh start for the tagged scenarios: remove any test donations/donors from a
// previous run so the "exactly 1" counts are deterministic.
Before({ tags: "@stripe-webhook" }, async function () {
  await pool.query("DELETE FROM donations WHERE stripe_payment_intent_id LIKE 'pi_bdd_%'");
  await pool.query("DELETE FROM donors WHERE email LIKE '%bdd@example.com'");
});

AfterAll(async function () {
  await pool.end();
});

When("I POST a signed Stripe {string} webhook event:", async function (type, docString) {
  const payload = envelope(type, JSON.parse(docString));
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await postWebhook(payload, signature);
  this.statusCode = res.status;
  this.text = await res.text();
});

When(
  "I POST a Stripe {string} webhook event with an invalid signature:",
  async function (type, docString) {
    const payload = envelope(type, JSON.parse(docString));
    const res = await postWebhook(payload, "t=1,v1=deadbeefdeadbeef");
    this.statusCode = res.status;
    this.text = await res.text();
  },
);

Then(
  "there should be exactly {int} donation with payment intent {string}",
  async function (count, paymentIntent) {
    const r = await pool.query(
      "SELECT count(*)::int AS n FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.equal(r.rows[0].n, count);
  },
);

Then(
  "the donation with payment intent {string} should have refunded amount {int}",
  async function (paymentIntent, amount) {
    const r = await pool.query(
      "SELECT refunded_amount_pence FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].refunded_amount_pence, amount);
  },
);

Then(
  "the donation with payment intent {string} should have gift aid true",
  async function (paymentIntent) {
    const r = await pool.query(
      "SELECT gift_aid FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].gift_aid, true);
  },
);
