const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const Stripe = require("stripe");

// Steps for uniform-payments.feature (TASK-604). Posts signed Stripe events to the real webhook and
// reads Admin > Donations over HTTP against the real database. The staff come from the shared @admin
// steps (admin-api.steps.js). Every buyer is invented, with an address ending
// "uniform.admin.bdd@example.com"; the hooks remove their uniform payments and the events sent.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "uniform-pw-123";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // generateTestHeaderString is pure HMAC: no account
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MINE = "%uniform.admin.bdd@example.com";

async function cleanUp() {
  await pool.query("DELETE FROM uniform_payments WHERE buyer_email LIKE $1", [MINE]);
  await pool.query("DELETE FROM stripe_webhook_events WHERE id LIKE 'evt_uniform_bdd_%'");
}
Before({ tags: "@uniform-payments" }, cleanUp);
After({ tags: "@uniform-payments" }, cleanUp);
AfterAll(async () => {
  await pool.end();
});

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    return (await res2.json().catch(() => ({}))).token;
  }
  throw new Error(`could not sign in as ${email}: ${JSON.stringify(body)}`);
}

async function get(path, email) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${await login(email)}` } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function sendEvent(world, type, object) {
  const payload = JSON.stringify({ id: `evt_uniform_bdd_${stamp()}`, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  world.uniformAnswer = JSON.parse(text || "{}");
}

const checkout = (world) => ({
  id: world.uniformSession,
  object: "checkout.session",
  status: "complete",
  payment_status: "paid",
  payment_intent: world.uniformIntent,
  payment_link: "plink_uniform_bdd",
  amount_total: world.uniformPence,
  currency: "gbp",
  customer_details: { name: "Robin Testperson", email: world.uniformEmail },
  custom_fields: [{ key: "child", label: { type: "custom", custom: "Child's name" }, type: "text", text: { value: "Sam" } }],
  metadata: { product: "uniform" },
});

Given("{string} has noted the Uniform totals", async function (email) {
  const { status, body } = await get("/api/admin/donations/source-totals", email);
  assert.equal(status, 200, JSON.stringify(body));
  this.uniformBefore = body.totals;
  this.uniformStaff = email;
});

When("Stripe completes a uniform payment link checkout of {int} pence", async function (pence) {
  const s = stamp();
  this.uniformSession = `cs_uniform_bdd_${s}`;
  this.uniformIntent = `pi_uniform_bdd_${s}`;
  this.uniformEmail = `buyer${s}.uniform.admin.bdd@example.com`;
  this.uniformPence = pence;
  await sendEvent(this, "checkout.session.completed", checkout(this));
});

When("Stripe sends the same uniform checkout again under another event", async function () {
  await sendEvent(this, "checkout.session.completed", checkout(this));
});

When("Stripe refunds {int} pence of that uniform payment", async function (pence) {
  await sendEvent(this, "charge.refunded", { id: `ch_uniform_bdd_${stamp()}`, object: "charge", payment_intent: this.uniformIntent, amount_refunded: pence });
});

Then("the webhook took it as {string}", function (action) {
  assert.equal(this.uniformAnswer.action, action, JSON.stringify(this.uniformAnswer));
});

async function totalsNow(world) {
  const { status, body } = await get("/api/admin/donations/source-totals", world.uniformStaff);
  assert.equal(status, 200, JSON.stringify(body));
  return body.totals;
}

Then("Uniform has gone up by {int} pence from {int} payment(s), this month and in all", async function (pence, count) {
  const now = await totalsNow(this);
  for (const span of ["month", "all"]) {
    assert.equal(now.uniform[span].pence - this.uniformBefore.uniform[span].pence, pence, `${span}: ${JSON.stringify(now.uniform)}`);
    assert.equal(now.uniform[span].gifts - this.uniformBefore.uniform[span].gifts, count, `${span}: ${JSON.stringify(now.uniform)}`);
  }
  this.uniformAfter = now;
});

Then("Uniform has gone down by {int} pence in all", async function (pence) {
  const now = await totalsNow(this);
  assert.equal(this.uniformBefore.uniform.all.pence - now.uniform.all.pence, pence, JSON.stringify(now.uniform));
});

Then("the Donate page has not changed", function () {
  assert.deepEqual(this.uniformAfter.donatePage, this.uniformBefore.donatePage);
});

Then("no donor or donation was recorded for the buyer", async function () {
  const donors = await pool.query("SELECT count(*)::int AS n FROM donors WHERE email = $1", [this.uniformEmail]);
  assert.equal(donors.rows[0].n, 0);
  const gifts = await pool.query("SELECT count(*)::int AS n FROM donations WHERE stripe_session_id = $1 OR stripe_payment_intent_id = $2", [
    this.uniformSession,
    this.uniformIntent,
  ]);
  assert.equal(gifts.rows[0].n, 0);
});

Then("{string} finds the buyer listed under Uniform only", async function (email) {
  const q = encodeURIComponent(this.uniformEmail);
  const only = await get(`/api/admin/donations?source=uniform&q=${q}`, email);
  assert.equal(only.status, 200, JSON.stringify(only.body));
  assert.equal(only.body.total, 1, JSON.stringify(only.body));
  const row = only.body.results[0];
  assert.equal(row.kind, "uniform");
  assert.equal(row.donor_name, "Robin Testperson");
  assert.equal(row.amount_pence, this.uniformPence);
  assert.equal(row.given_on_label, "Uniform");
  assert.equal(row.stripe_ref, this.uniformIntent);
  assert.deepEqual(row.uniform_details, [{ label: "Child's name", value: "Sam" }]);
  const plain = await get(`/api/admin/donations?q=${q}`, email);
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  assert.equal(plain.body.total, 0, JSON.stringify(plain.body));
});
