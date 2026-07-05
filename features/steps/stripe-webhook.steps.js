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
  // Capture the donor ids from THIS feature's donations FIRST, then delete by id. Many webhook
  // scenarios create a donor with NO email (no marketing consent — e.g. "Grace Prorate", "Ada BACS",
  // the anonymous walk-in), so an email-only delete can never reach them and they pile up across
  // local runs. Match donations by payment-intent OR subscription id (the monthly parent donation
  // has a NULL payment intent).
  const { rows } = await pool.query(
    "SELECT DISTINCT donor_id FROM donations WHERE stripe_payment_intent_id LIKE 'pi_bdd_%' OR stripe_subscription_id LIKE 'sub_bdd_%'",
  );
  const donorIds = rows.map((r) => r.donor_id).filter((id) => id != null);
  await pool.query(
    "DELETE FROM donations WHERE stripe_payment_intent_id LIKE 'pi_bdd_%' OR stripe_subscription_id LIKE 'sub_bdd_%'",
  );
  // Declarations reference donors (RESTRICT) and donations reference declarations (RESTRICT), so
  // clear these donors' declarations after their donations, before the donor delete.
  if (donorIds.length) {
    await pool.query("DELETE FROM declarations WHERE donor_id = ANY($1)", [donorIds]);
    await pool.query("DELETE FROM donors WHERE id = ANY($1)", [donorIds]);
  }
  // Belt-and-braces: any bdd donor reached by email (some scenarios do set one) that had no
  // donation this run, plus any now-childless walk-in donor. Clear their donations FIRST — other
  // features (e.g. @portal) seed bdd-email donors with donations that carry NO pi_bdd_/sub_bdd_
  // marker, so the marker-based delete above misses them and the donor delete would hit the
  // donations FK. Donations reference declarations (RESTRICT), so donations go before declarations.
  await pool.query(
    "DELETE FROM donations WHERE donor_id IN (SELECT id FROM donors WHERE email LIKE '%bdd@example.com')",
  );
  await pool.query(
    "DELETE FROM declarations WHERE donor_id IN (SELECT id FROM donors WHERE email LIKE '%bdd@example.com')",
  );
  await pool.query("DELETE FROM donors WHERE email LIKE '%bdd@example.com'");
  await pool.query(
    "DELETE FROM donors WHERE full_name = 'In-person donor' AND id NOT IN (SELECT donor_id FROM donations WHERE donor_id IS NOT NULL)",
  );
  // Clear the idempotency ledger for this feature's events. Scenarios that reuse a FIXED event id
  // (e.g. evt_bdd_cp_1) would otherwise be treated as duplicates on a re-run and no-op, so the
  // donation is never (re)created and the counts fail. CI runs on a fresh DB; this keeps local
  // re-runs deterministic too.
  await pool.query("DELETE FROM stripe_webhook_events WHERE id LIKE 'evt_bdd_%'");
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

// Like the step above but with an EXPLICIT event id (not the auto-generated one), so a
// scenario can resend the IDENTICAL id to prove idempotency (TASK-073).
When(
  "I POST a signed Stripe {string} webhook event with id {string}:",
  async function (type, id, docString) {
    const payload = JSON.stringify({ id, object: "event", type, data: { object: JSON.parse(docString) } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const res = await postWebhook(payload, signature);
    this.statusCode = res.status;
    this.text = await res.text();
  },
);

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
  "the donation with payment intent {string} should have amount {int}",
  async function (paymentIntent, amount) {
    const r = await pool.query(
      "SELECT amount_pence FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].amount_pence, amount);
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
  "the donation with payment intent {string} should have a linked declaration",
  async function (paymentIntent) {
    const r = await pool.query(
      "SELECT declaration_id FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.ok(
      r.rows[0].declaration_id != null,
      `expected a non-null declaration_id, got ${r.rows[0].declaration_id}`,
    );
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

Then(
  "the donation with payment intent {string} should have gift aid false",
  async function (paymentIntent) {
    const r = await pool.query(
      "SELECT gift_aid FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].gift_aid, false);
  },
);

Then(
  "the donation with payment intent {string} should have claim status {string}",
  async function (paymentIntent, claimStatus) {
    const r = await pool.query(
      "SELECT claim_status FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].claim_status, claimStatus);
  },
);

// donor_type / business_name live on the donor the donation points to (one model),
// so these join donations → donors to assert the persisted donor record (REQ-038).
Then(
  "the donation with payment intent {string} should have payment channel {string}",
  async function (paymentIntent, channel) {
    const r = await pool.query(
      "SELECT payment_channel FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].payment_channel, channel);
  },
);

Then(
  "the donation with payment intent {string} should have gasds eligible {word}",
  async function (paymentIntent, expected) {
    const r = await pool.query(
      "SELECT gasds_eligible FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].gasds_eligible, expected === "true");
  },
);

Then(
  "the donation with payment intent {string} should have declaration status {string}",
  async function (paymentIntent, status) {
    const r = await pool.query(
      "SELECT declaration_status FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].declaration_status, status);
  },
);

Then(
  "the donation with payment intent {string} should have a declaration token",
  async function (paymentIntent) {
    const r = await pool.query(
      "SELECT declaration_token FROM donations WHERE stripe_payment_intent_id = $1",
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donation for payment intent ${paymentIntent}`);
    assert.ok(
      r.rows[0].declaration_token != null && r.rows[0].declaration_token.length > 0,
      `expected a non-empty declaration_token, got ${r.rows[0].declaration_token}`,
    );
  },
);

Then(
  "there should be exactly {int} donor for payment intent {string}",
  async function (count, paymentIntent) {
    const r = await pool.query(
      `SELECT count(DISTINCT dn.id)::int AS n
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.equal(r.rows[0].n, count);
  },
);

Then(
  "there should be a {string} audit row for the donation with payment intent {string}",
  async function (action, paymentIntent) {
    const r = await pool.query(
      `SELECT count(*)::int AS n
         FROM audit_log a JOIN donations d ON d.id = a.entity_id
        WHERE d.stripe_payment_intent_id = $1 AND a.entity = 'donation' AND a.action = $2`,
      [paymentIntent, action],
    );
    assert.ok(r.rows[0].n >= 1, `no ${action} audit row for donation ${paymentIntent}`);
  },
);

Then(
  "the donor for payment intent {string} should have donor type {string}",
  async function (paymentIntent, donorType) {
    const r = await pool.query(
      `SELECT dn.donor_type FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donor for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].donor_type, donorType);
  },
);

Then(
  "the donor for payment intent {string} should have business name {string}",
  async function (paymentIntent, businessName) {
    const r = await pool.query(
      `SELECT dn.business_name FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    assert.ok(r.rows.length > 0, `no donor for payment intent ${paymentIntent}`);
    assert.equal(r.rows[0].business_name, businessName);
  },
);
