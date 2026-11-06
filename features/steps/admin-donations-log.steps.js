const { Before, After, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { Pool } = require("pg");

// Steps for admin-donations-log.feature (the Donations gift log). Chains the REAL journey, as
// donation-journey.steps.js does: POST /api/checkout-session with the giving page as its Referer
// (capturing the stub-echoed session metadata), then a signed checkout.session.completed built from
// that metadata. Then reads the log (GET /api/admin/donations) and a gift's details
// (GET /api/admin/donations/:kind/:id/details) as staff, signed in as admin-invoices.steps.js does.
// The staff come from the shared @admin steps. Every giver and payer here has an invented address
// ending "donlog.admin.bdd@example.com"; the hooks below remove their invoices, donations,
// declarations and donors, and this feature's webhook events. Invented names only.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "donlog-pw-123";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // generateTestHeaderString is pure HMAC: no account
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MINE = "%donlog.admin.bdd@example.com";

// In foreign key order. Donations first (they point at donors, declarations and invoices), then the
// invoices (a donation's link to one is SET NULL anyway), declarations, donors, and the ledger.
async function cleanUp() {
  const donors = "SELECT id FROM donors WHERE email LIKE $1";
  await pool.query(`DELETE FROM donations WHERE donor_id IN (${donors})`, [MINE]);
  const invoices = "SELECT id FROM donation_invoices WHERE email LIKE $1";
  await pool.query(`UPDATE donations SET invoice_id = NULL WHERE invoice_id IN (${invoices})`, [MINE]);
  await pool.query("DELETE FROM donation_invoices WHERE email LIKE $1", [MINE]);
  await pool.query(`DELETE FROM declarations WHERE donor_id IN (${donors})`, [MINE]);
  await pool.query("DELETE FROM donors WHERE email LIKE $1", [MINE]);
  await pool.query("DELETE FROM stripe_webhook_events WHERE id LIKE 'evt_donlog_%'");
}

Before({ tags: "@admin-donations-log" }, cleanUp);
After({ tags: "@admin-donations-log" }, cleanUp);

AfterAll(async function () {
  await pool.end();
});

let seq = 0;
/** A short mark no other run or scenario shares, for invented addresses and payment ids. */
function stamp() {
  seq += 1;
  return `${Date.now()}x${seq}`;
}

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

// One sign-in per person per scenario: each one mints and spends a 2FA code.
async function tokenFor(world, email) {
  world.logTokens = world.logTokens || {};
  if (!world.logTokens[email]) world.logTokens[email] = await login(email);
  return world.logTokens[email];
}

async function send(world, method, path, email, body) {
  const headers = email ? { Authorization: `Bearer ${await tokenFor(world, email)}` } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.logStatus = res.status;
  world.logBody = await res.json().catch(() => ({}));
}

/** The UK date today, as the server reckons it. */
function ukToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}
function inDays(n) {
  return new Date(Date.parse(`${ukToday()}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

// A £10 one off gift on the Donate page, as the page sends it: the giving page as the Referer, and
// cameFrom "" (the page was opened straight from the link, with nothing before it).
async function checkout(world, givingPath, extraHeaders) {
  world.giftEmail = `giver${stamp()}.donlog.admin.bdd@example.com`;
  const res = await fetch(`${BASE_URL}/api/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: `${BASE_URL}${givingPath}`, ...extraHeaders },
    body: JSON.stringify({
      mode: "once",
      plan: null,
      amount: 1000,
      giftAid: false,
      donorType: "individual",
      fullName: "Sophie Example",
      email: world.giftEmail,
      emailConsent: false,
      cameFrom: "",
    }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 300));
  const body = JSON.parse(text);
  // Present only in stub mode (TASK-116).
  assert.ok(body.session, "no session echoed from checkout: is the Stripe stub active?");
  world.session = body.session;
}

When("a giver checks out on the Donate page opened as {string}", async function (givingPath) {
  await checkout(this, givingPath, {});
});

When(
  "a giver whose browser sends Do Not Track checks out on the Donate page opened as {string}",
  async function (givingPath) {
    await checkout(this, givingPath, { DNT: "1" });
  },
);

Then("the checkout notes the arrival channel {string} and the giving page {string}", function (channel, page) {
  const m = this.session.metadata || {};
  assert.equal(m.arrChannel, channel, JSON.stringify(m));
  assert.equal(m.givenOn, page, JSON.stringify(m));
});

Then("the checkout notes no arrival", function () {
  const m = this.session.metadata || {};
  for (const key of ["arrChannel", "arrSource", "arrCampaign", "givenOn"]) {
    assert.equal(m[key], undefined, `${key} should not be on the session: ${JSON.stringify(m)}`);
  }
});

When("Stripe completes the giver's checkout", async function () {
  assert.ok(this.session, "no checkout to complete");
  const marker = stamp();
  const object = {
    id: this.session.id,
    object: "checkout.session",
    metadata: this.session.metadata,
    mode: this.session.mode,
    amount_total: 1000,
    currency: "gbp",
    payment_status: "paid",
    payment_intent: `pi_donlog_${marker}`,
    subscription: null,
    customer_details: { name: "Sophie Example", email: this.giftEmail },
    created: Math.floor(Date.now() / 1000),
  };
  const payload = JSON.stringify({
    id: `evt_donlog_${marker}`,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  assert.equal(res.status, 200, await res.text());
});

When(
  "{string} sends an invoice of {string} and marks it paid by bank transfer today",
  async function (email, amount) {
    this.giftEmail = `payer${stamp()}.donlog.admin.bdd@example.com`;
    await send(this, "POST", "/api/admin/invoices", email, {
      payerKind: "person",
      contactName: "Sam Example",
      email: this.giftEmail,
      amount,
      description: "Donation to NBCC",
      dueOn: inDays(30),
    });
    assert.equal(this.logStatus, 201, JSON.stringify(this.logBody).slice(0, 300));
    this.invId = this.logBody.id;
    await send(this, "POST", `/api/admin/invoices/${this.invId}/mark-paid`, email, { paidOn: ukToday() });
    assert.equal(this.logStatus, 200, JSON.stringify(this.logBody).slice(0, 300));
  },
);

// The log, searched by the gift's own invented address, with any other filters added. Only this
// scenario's gift (or invoice's gift) is counted, so other features' rows can never confuse it.
async function giftsFound(world, email, filters) {
  const query = new URLSearchParams(filters || "");
  query.set("q", world.giftEmail);
  query.set("limit", "100");
  await send(world, "GET", `/api/admin/donations?${query.toString()}`, email);
  assert.equal(world.logStatus, 200, JSON.stringify(world.logBody).slice(0, 300));
  return (world.logBody.results || []).filter(
    (r) => r.kind === "donation" && r.donor_email === world.giftEmail && (world.invId === undefined || r.invoice_id === world.invId),
  );
}

async function theGift(world, email, filters) {
  const mine = await giftsFound(world, email, filters);
  assert.equal(mine.length, 1, JSON.stringify(world.logBody).slice(0, 500));
  world.giftId = mine[0].id;
  return mine[0];
}

Then(
  "{string} finds the gift by its email, noted as arrival channel {string} given on {string}",
  async function (email, channel, page) {
    const row = await theGift(this, email, "");
    assert.equal(row.arrival_channel, channel, JSON.stringify(row));
    assert.equal(row.given_on, page, JSON.stringify(row));
  },
);

Then("{string} finds the gift by its email, with no arrival noted", async function (email) {
  const row = await theGift(this, email, "");
  assert.equal(row.arrival_channel, null, JSON.stringify(row));
  assert.equal(row.given_on, null, JSON.stringify(row));
});

Then("{string} finds the gift when the log is filtered with {string}", async function (email, filters) {
  await theGift(this, email, filters);
});

Then("{string} does not find the gift when the log is filtered with {string}", async function (email, filters) {
  const mine = await giftsFound(this, email, filters);
  assert.equal(mine.length, 0, JSON.stringify(mine).slice(0, 300));
});

Then("{string} finds no gifts when the log is filtered with {string}", async function (email, filters) {
  await send(this, "GET", `/api/admin/donations?${filters}`, email);
  assert.equal(this.logStatus, 200, JSON.stringify(this.logBody).slice(0, 300));
  assert.deepEqual(this.logBody.results, []);
  assert.equal(this.logBody.total, 0);
});

// The gift's id, from the log, when a scenario has not looked it up yet.
async function giftId(world) {
  if (world.giftId === undefined) await theGift(world, "ann.donlog.admin.bdd@example.com", "");
  return world.giftId;
}

When("{string} opens the gift's details", async function (email) {
  const id = await giftId(this);
  await send(this, "GET", `/api/admin/donations/donation/${id}/details`, email);
});

When("{string} opens the gift's details as the kind {string}", async function (email, kind) {
  const id = await giftId(this);
  await send(this, "GET", `/api/admin/donations/${encodeURIComponent(kind)}/${id}/details`, email);
});

When("{string} opens the details of a donation that does not exist", async function (email) {
  // The largest id the route accepts; no donation in a test database gets near it.
  await send(this, "GET", "/api/admin/donations/donation/2147483647/details", email);
});

When("someone opens the gift's details without a session", async function () {
  const id = await giftId(this);
  await send(this, "GET", `/api/admin/donations/donation/${id}/details`, null);
});

Then("the gift log answer is {int}", function (status) {
  assert.equal(this.logStatus, status, JSON.stringify(this.logBody).slice(0, 300));
});

Then("the details are a donation given on the {string} that came from a QR code", function (givenOn) {
  const d = this.logBody;
  assert.equal(d.kind, "donation", JSON.stringify(d).slice(0, 300));
  assert.equal(Number(d.id), Number(this.giftId));
  assert.equal(d.labels.givenOnLabel, givenOn);
  assert.equal(d.arrival.channel, "qr");
  assert.equal(d.arrival.givenOn, "/donate");
  assert.ok(String(d.labels.arrivalLabel).startsWith("QR code"), `arrival label: ${d.labels.arrivalLabel}`);
});

Then("the details say it was paid by {string}", function (words) {
  const d = this.logBody;
  assert.equal(d.kind, "donation", JSON.stringify(d).slice(0, 300));
  assert.equal(d.payment.method, "bank_transfer");
  assert.equal(d.labels.paidByLabel, words);
  assert.ok(String(d.labels.givenOnLabel).startsWith("Invoice"), `given on: ${d.labels.givenOnLabel}`);
});
