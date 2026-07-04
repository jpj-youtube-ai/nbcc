const { When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { Pool } = require("pg");

// Steps for donation-journey.feature (TASK-116). Chains the REAL journey: POST
// /api/checkout-session (capturing the stub-echoed session metadata), then a signed
// checkout.session.completed built from that metadata + the payment fields Stripe adds at
// completion. Signs with the same STRIPE_WEBHOOK_SECRET the app verifies against
// (generateTestHeaderString is pure HMAC — no live account). DB assertions use DATABASE_URL.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // key unused: generateTestHeaderString is pure HMAC
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let seq = 0;
function signedEvent(type, object) {
  seq += 1;
  const payload = JSON.stringify({
    id: `evt_journey_${Date.now()}_${seq}`,
    object: "event",
    type,
    data: { object },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, signature };
}
async function postWebhook(payload, signature) {
  return fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
}

// Deterministic cleanup for the tagged scenarios: remove journey rows in FK order
// (partner shares → donations → declarations → donors). Capturing donor ids from the
// donations FIRST lets us reach donors with no email (anonymous / partnership) too.
Before({ tags: "@donation-journey" }, async function () {
  const { rows } = await pool.query(
    "SELECT id, donor_id FROM donations WHERE stripe_payment_intent_id LIKE 'pi_journey_%' OR stripe_subscription_id LIKE 'sub_journey_%'",
  );
  const donationIds = rows.map((r) => r.id);
  const donorIds = [...new Set(rows.map((r) => r.donor_id).filter((id) => id != null))];
  if (donationIds.length) {
    await pool.query("DELETE FROM donation_partner_shares WHERE donation_id = ANY($1)", [donationIds]);
    await pool.query("DELETE FROM donations WHERE id = ANY($1)", [donationIds]);
  }
  if (donorIds.length) {
    await pool.query("DELETE FROM declarations WHERE donor_id = ANY($1)", [donorIds]);
    await pool.query("DELETE FROM donors WHERE id = ANY($1)", [donorIds]);
  }
});

AfterAll(async function () {
  await pool.end();
});

When("I start checkout with JSON:", async function (docString) {
  const res = await fetch(`${BASE_URL}/api/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: docString,
  });
  this.statusCode = res.status;
  this.text = await res.text();
  try {
    this.body = JSON.parse(this.text);
  } catch {
    this.body = {};
  }
  // Present only in stub mode (TASK-116). Undefined on a 400 (rejected before Stripe).
  this.session = this.body.session;
});

When("Stripe completes the checkout with:", async function (docString) {
  assert.ok(this.session, "no session echoed from checkout — is the Stripe stub active?");
  const c = JSON.parse(docString);
  const object = {
    id: this.session.id,
    object: "checkout.session",
    metadata: this.session.metadata,
    mode: this.session.mode,
    amount_total: c.amount_total ?? null,
    currency: c.currency ?? "gbp",
    payment_status: c.payment_status ?? "paid",
    payment_intent: c.payment_intent ?? null,
    subscription: c.subscription ?? null,
    customer_details: c.customer_details ?? null,
    created: c.created ?? 1700000000,
  };
  const { payload, signature } = signedEvent("checkout.session.completed", object);
  const res = await postWebhook(payload, signature);
  this.statusCode = res.status;
  this.text = await res.text();
});

When("Stripe settles the pending payment as {word}", async function (outcome) {
  assert.ok(this.session, "no session echoed from checkout — is the Stripe stub active?");
  const type =
    outcome === "succeeded"
      ? "checkout.session.async_payment_succeeded"
      : "checkout.session.async_payment_failed";
  const { payload, signature } = signedEvent(type, { id: this.session.id, object: "checkout.session" });
  const res = await postWebhook(payload, signature);
  this.statusCode = res.status;
  this.text = await res.text();
});

async function declarationForPaymentIntent(paymentIntent) {
  const r = await pool.query(
    `SELECT dec.* FROM donations d JOIN declarations dec ON dec.id = d.declaration_id
      WHERE d.stripe_payment_intent_id = $1`,
    [paymentIntent],
  );
  assert.ok(r.rows.length > 0, `no linked declaration for payment intent ${paymentIntent}`);
  return r.rows[0];
}

Then(
  "the declaration for payment intent {string} should have scope {string}",
  async function (paymentIntent, scope) {
    const dec = await declarationForPaymentIntent(paymentIntent);
    assert.equal(dec.scope, scope);
  },
);

Then(
  "the declaration for payment intent {string} should have wording version {string}",
  async function (paymentIntent, version) {
    const dec = await declarationForPaymentIntent(paymentIntent);
    assert.equal(dec.wording_version, version);
  },
);

Then(
  "the declaration for payment intent {string} should have blank postcode",
  async function (paymentIntent) {
    const dec = await declarationForPaymentIntent(paymentIntent);
    assert.ok(
      dec.postcode == null || dec.postcode === "",
      `expected a blank postcode, got ${JSON.stringify(dec.postcode)}`,
    );
  },
);

Then(
  "the donor for payment intent {string} should have anonymous {word}",
  async function (paymentIntent, expected) {
    const r = await pool.query(
      `SELECT dn.anonymous FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donor for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].anonymous, expected === "true");
  },
);

Then(
  "the donation for subscription {string} should have gift aid {word}",
  async function (subscriptionId, expected) {
    const r = await pool.query(
      "SELECT gift_aid FROM donations WHERE stripe_subscription_id = $1 AND stripe_payment_intent_id IS NULL ORDER BY id ASC LIMIT 1",
      [subscriptionId],
    );
    assert.ok(r.rows.length > 0, `no parent donation for subscription ${subscriptionId}`);
    assert.equal(r.rows[0].gift_aid, expected === "true");
  },
);

Then(
  "the declaration for subscription {string} should have scope {string}",
  async function (subscriptionId, scope) {
    const r = await pool.query(
      `SELECT dec.scope
         FROM donations d JOIN declarations dec ON dec.id = d.declaration_id
        WHERE d.stripe_subscription_id = $1 AND d.stripe_payment_intent_id IS NULL
        ORDER BY d.id ASC LIMIT 1`,
      [subscriptionId],
    );
    assert.ok(r.rows.length > 0, `no parent declaration for subscription ${subscriptionId}`);
    assert.equal(r.rows[0].scope, scope);
  },
);

Then(
  "there should be exactly {int} partner share for payment intent {string}",
  async function (count, paymentIntent) {
    const r = await pool.query(
      `SELECT count(*)::int AS n
         FROM donation_partner_shares s JOIN donations d ON d.id = s.donation_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.equal(r.rows[0].n, count);
  },
);

Then(
  "the partner shares for payment intent {string} should sum to {int}",
  async function (paymentIntent, total) {
    const r = await pool.query(
      `SELECT COALESCE(sum(s.share_pence), 0)::int AS total
         FROM donation_partner_shares s JOIN donations d ON d.id = s.donation_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.equal(r.rows[0].total, total);
  },
);
