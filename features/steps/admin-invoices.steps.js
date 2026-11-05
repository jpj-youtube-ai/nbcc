const { Before, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { Pool } = require("pg");

// Steps for admin-invoices.feature (invoices for donations). Drives /api/admin/invoices, the private
// page /invoice/<token> and the Stripe webhook over HTTP. The staff come from the shared @admin steps
// (addresses ending "admin.bdd@example.com", which the @admin hooks remove, with the donors and
// donations made for those addresses). Every invoice here is sent to such an address, and the hook
// below removes those invoices. Invented names only.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "inv-pw-123";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // generateTestHeaderString is pure HMAC: no account
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PAYER = "payer.invoices.admin.bdd@example.com";

Before({ tags: "@admin-invoices" }, async function () {
  // Donations that paid these invoices first (the @admin hook may not have reached them yet), then
  // the invoices. Each link is SET NULL on delete, so the order never fails.
  const ids = "SELECT id FROM donation_invoices WHERE email LIKE '%invoices.admin.bdd@example.com'";
  await pool.query(`UPDATE donations SET invoice_id = NULL WHERE invoice_id IN (${ids})`);
  await pool.query("DELETE FROM donation_invoices WHERE email LIKE '%invoices.admin.bdd@example.com'");
});

AfterAll(async function () {
  await pool.end();
});

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
  world.invTokens = world.invTokens || {};
  if (!world.invTokens[email]) world.invTokens[email] = await login(email);
  return world.invTokens[email];
}

async function send(world, method, path, email, body) {
  const headers = email ? { Authorization: `Bearer ${await tokenFor(world, email)}` } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.invStatus = res.status;
  world.invBody = await res.json().catch(() => ({}));
}

async function page(world, method, path, form) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    redirect: "manual",
    headers: form ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  world.pageStatus = res.status;
  world.pageHtml = await res.text();
}

/** The UK date today, as the server reckons it. */
function ukToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}
function inDays(n) {
  return new Date(Date.parse(`${ukToday()}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

async function sendInvoice(world, email, body) {
  await send(world, "POST", "/api/admin/invoices", email, { amount: "25", description: "Donation to NBCC", dueOn: inDays(30), ...body });
  if (world.invStatus === 201) {
    world.invId = world.invBody.id;
    world.invNumber = world.invBody.number;
    world.invPath = new URL(world.invBody.link).pathname;
  }
}

When("I ask for the invoices without a session", async function () {
  await send(this, "GET", "/api/admin/invoices", null);
});

When("{string} lists the invoices", async function (email) {
  await send(this, "GET", "/api/admin/invoices", email);
});

When("{string} sends an invoice for a person of {string}", async function (email, amount) {
  await sendInvoice(this, email, { payerKind: "person", contactName: "Sam Example", email: PAYER, amount });
});

When("{string} sends an invoice for a business of {string}", async function (email, amount) {
  await sendInvoice(this, email, {
    payerKind: "business",
    orgName: "Example Joinery Ltd",
    contactName: "Alex Example",
    email: PAYER,
    address: "1 Made Up Street\nExampletown",
    postcode: "KA1 1AA",
    considerationGiven: false,
    amount,
  });
});

When("{string} marks the new invoice paid today", async function (email) {
  await send(this, "POST", `/api/admin/invoices/${this.invId}/mark-paid`, email, { paidOn: ukToday() });
});

When("{string} cancels the new invoice", async function (email) {
  await send(this, "POST", `/api/admin/invoices/${this.invId}/cancel`, email, {});
});

let seq = 0;
async function cardPayment(world, sessionId) {
  seq += 1;
  const payload = JSON.stringify({
    id: `evt_invoice_${Date.now()}_${seq}`,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        payment_intent: `pi_${sessionId}`,
        amount_total: 6000,
        currency: "gbp",
        metadata: { product: "donation_invoice", invoiceId: String(world.invId) },
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  assert.equal(res.status, 200, await res.text());
}

When("Stripe reports the new invoice paid by card", async function () {
  this.invSession = `cs_test_invoice_${Date.now()}`;
  await cardPayment(this, this.invSession);
});

When("Stripe reports the same card payment again", async function () {
  // A new event id for the same payment, as Stripe can send.
  await cardPayment(this, this.invSession);
});

When("someone opens the new invoice's link", async function () {
  await page(this, "GET", this.invPath);
});

When("someone opens an invoice link that has been tampered with", async function () {
  await page(this, "GET", `${this.invPath}x`);
});

When("someone posts a Gift Aid declaration to the new invoice's page", async function () {
  await page(this, "POST", `${this.invPath}/gift-aid`, {
    giftAid: "yes",
    firstName: "Alex",
    lastName: "Example",
    houseNameNumber: "1",
    address: "Made Up Street, Exampletown",
    postcode: "KA1 1AA",
  });
});

When("someone presses Pay by card on the new invoice's page", async function () {
  await page(this, "POST", `${this.invPath}/pay`, {});
});

Then("the invoices answer is {int}", function (status) {
  assert.equal(this.invStatus, status, JSON.stringify(this.invBody).slice(0, 300));
});

Then("the page answer is {int}", function (status) {
  assert.equal(this.pageStatus, status, String(this.pageHtml).slice(0, 300));
});

Then("the page answer is {int} and shows the invoice's number", function (status) {
  assert.equal(this.pageStatus, status);
  assert.ok(this.pageHtml.includes(`Invoice ${this.invNumber}`), "the page shows its number");
});

Then("the page says it was paid", function () {
  assert.ok(/Paid on \d{1,2} \w+ \d{4}/.test(this.pageHtml), "the page has its Paid stamp");
  assert.ok(!this.pageHtml.includes("/pay\""), "and no way to pay");
});

Then("the page says it has been cancelled", function () {
  assert.ok(this.pageHtml.includes("This invoice has been cancelled"));
});

Then("the new invoice has {int} donation(s) in Donations", async function (count) {
  const res = await fetch(`${BASE_URL}/api/admin/donations?limit=100&source=invoice`, {
    headers: { Authorization: `Bearer ${await tokenFor(this, "ann.invoices.admin.bdd@example.com")}` },
  });
  const body = await res.json();
  const mine = (body.results || []).filter((d) => d.invoice_id === this.invId);
  assert.equal(mine.length, count, JSON.stringify(mine).slice(0, 300));
});
