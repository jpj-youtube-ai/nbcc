const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for ball-bank-transfer.feature (TASK-484). Drives the public and admin routes over HTTP and
// checks the main database. The staff come from the shared @admin steps (addresses ending
// "admin.bdd@example.com", which the @admin hooks remove). Every name, address and bank detail here is
// invented: this repository is public. Bank transfer is switched off and its details cleared before and
// after each scenario, so other features see the settings as shipped.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "transfer-pw-123";
const BUYER = "ada.transfer.bdd@example.com";
const BANK = { accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" };

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
  world.transferTokens = world.transferTokens || {};
  if (!world.transferTokens[email]) world.transferTokens[email] = await login(email);
  return world.transferTokens[email];
}

async function asStaff(world, email, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(world, email)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.adminStatus = res.status;
  world.adminBody = await res.json().catch(() => ({}));
}

/** A UTC date `days` from today, YYYY-MM-DD: far enough ahead that the UK date cannot differ. */
function daysFromToday(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function reset() {
  await pool.query(
    `UPDATE ball_settings SET transfer_on = false, transfer_account_name = NULL,
            transfer_sort_code = NULL, transfer_account_number = NULL, transfer_last_day = NULL WHERE id = 1`,
  );
  await pool.query("DELETE FROM ball_bookings WHERE buyer_email LIKE '%transfer.bdd@example.com'");
}

Before({ tags: "@ball-transfer" }, reset);
After({ tags: "@ball-transfer" }, reset);
AfterAll(async () => {
  await pool.end();
});

// A stored map is a complete statement of access: exactly Festive Ball edit, nothing else.
Given("{string} has Festive Ball edit access", async function (email) {
  await pool.query(`UPDATE users SET permissions = $2::jsonb WHERE email = $1`, [email, JSON.stringify({ ball: "edit" })]);
});

Given("bank transfer is switched on with bank details", async function () {
  await pool.query(
    `UPDATE ball_settings SET transfer_on = true, transfer_account_name = $1,
            transfer_sort_code = $2, transfer_account_number = $3 WHERE id = 1`,
    [BANK.accountName, BANK.sortCode, BANK.accountNumber],
  );
});

async function book(world, quantity, what, extra = {}) {
  const kind = what.startsWith("table") ? "table" : "seat";
  const res = await fetch(`${BASE_URL}/api/ball/bank-transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      quantity,
      buyerFirstName: "Ada",
      buyerSurname: "Transfer",
      buyerEmail: BUYER,
      termsAccepted: true,
      ...extra,
    }),
  });
  world.transferStatus = res.status;
  world.transferBody = await res.json().catch(() => ({}));
  if (res.status === 201) world.transferRef = world.transferBody.reference;
}

When("a buyer books {int} {word} to pay by bank transfer", async function (quantity, what) {
  await book(this, quantity, what);
});

When("the same buyer books {int} {word} to pay by bank transfer", async function (quantity, what) {
  await book(this, quantity, what);
});

Then("the transfer booking answer is {int}", function (status) {
  assert.equal(this.transferStatus, status, JSON.stringify(this.transferBody));
});

Then(
  "the transfer booking answer is {int} with the bank details and a pay-by date {int} days away",
  function (status, days) {
    assert.equal(this.transferStatus, status, JSON.stringify(this.transferBody));
    assert.match(this.transferBody.reference, /^BALL-[A-Z2-9]{6}$/);
    assert.equal(this.transferBody.accountName, BANK.accountName);
    assert.equal(this.transferBody.sortCode, BANK.sortCode);
    assert.equal(this.transferBody.accountNumber, BANK.accountNumber);
    // The UK date and UTC can differ by a day around midnight; either is seven days on.
    const allowed = [daysFromToday(days), daysFromToday(days - 1), daysFromToday(days + 1)];
    assert.ok(allowed.includes(this.transferBody.payBy), `pay by ${this.transferBody.payBy}`);
  },
);

Then("the ball availability should not offer bank transfer", function () {
  assert.equal(this.ballBody.transferOpen, false);
});

Then("the ball availability should offer bank transfer without giving the bank details", function () {
  assert.equal(this.ballBody.transferOpen, true);
  const text = JSON.stringify(this.ballBody);
  assert.ok(!text.includes(BANK.accountNumber) && !text.includes(BANK.sortCode), text);
});

When("{string} sets the bank details and switches transfer on", async function (email) {
  await asStaff(this, email, "PUT", "/api/admin/ball/transfer-settings", { ...BANK, on: true });
});

Then("the admin answer is {int}", function (status) {
  assert.equal(this.adminStatus, status, JSON.stringify(this.adminBody));
});

async function markPaid(world, email, pence) {
  await asStaff(world, email, "POST", `/api/admin/ball/bookings/${world.transferRef}/mark-paid`, {
    confirmTotalPence: pence,
  });
}

When("{string} marks it paid confirming the right amount", async function (email) {
  const row = await pool.query("SELECT total_pence FROM ball_bookings WHERE reference = $1", [this.transferRef]);
  await markPaid(this, email, row.rows[0].total_pence);
});

When("{string} marks it paid confirming the wrong amount", async function (email) {
  const row = await pool.query("SELECT total_pence FROM ball_bookings WHERE reference = $1", [this.transferRef]);
  await markPaid(this, email, row.rows[0].total_pence + 100);
});

Then("the booking is paid with a guest link, marked paid by {string}", async function (email) {
  const row = await pool.query(
    "SELECT status, paid_at, guest_token, marked_paid_by, payment_method FROM ball_bookings WHERE reference = $1",
    [this.transferRef],
  );
  const b = row.rows[0];
  assert.equal(b.status, "paid");
  assert.equal(b.payment_method, "transfer");
  assert.ok(b.paid_at, "paid_at is set");
  assert.ok(b.guest_token, "a guest link was made");
  assert.equal(b.marked_paid_by, `admin:${email}`);
});

When("{string} cancels it", async function (email) {
  await asStaff(this, email, "POST", `/api/admin/ball/bookings/${this.transferRef}/cancel`, { note: "BDD" });
});

When("{string} gives it until {int} days from today", async function (email, days) {
  this.payByGiven = daysFromToday(days);
  await asStaff(this, email, "POST", `/api/admin/ball/bookings/${this.transferRef}/pay-by`, { payBy: this.payByGiven });
});

Then("the booking's pay-by date is {int} days from today", async function (days) {
  const row = await pool.query("SELECT to_char(pay_by, 'YYYY-MM-DD') AS pay_by FROM ball_bookings WHERE reference = $1", [
    this.transferRef,
  ]);
  assert.equal(row.rows[0].pay_by, daysFromToday(days));
});

async function insertBooking({ reference, method, status, agoInterval }) {
  await pool.query(
    `INSERT INTO ball_bookings
       (reference, kind, quantity, seats, buyer_name, buyer_email, tickets_pence, donation_pence,
        fee_cover_pence, total_pence, gift_aid, newsletter_opt_in, stripe_session_id, status,
        created_at, payment_method, pay_by)
     VALUES ($1, 'table', 1, 10, 'Old Transfer', $2, 100000, 0, 0, 100000, false, false, $3, $4,
             now() - $5::interval, $6, $7)`,
    [
      reference,
      BUYER,
      method === "card" ? `cs_old_${reference}` : null,
      status,
      agoInterval,
      method,
      method === "transfer" ? daysFromToday(4) : null,
    ],
  );
}

Given("a card checkout for {int} table was started {int} hours ago and never finished", async function (_n, hours) {
  await insertBooking({ reference: "BALL-OLDCRD", method: "card", status: "pending", agoInterval: `${hours} hours` });
});

Given("a bank transfer booking for {int} table was made {int} days ago", async function (_n, days) {
  await insertBooking({ reference: "BALL-OLDTRF", method: "transfer", status: "pending", agoInterval: `${days} days` });
});

// A signed checkout.session.completed for the two-hour-old card checkout above, as Stripe would send
// it after a long delay. Signed the way features/steps/ball.steps.js signs, offline.
When("Stripe confirms the old card checkout was paid", async function () {
  const Stripe = require("stripe");
  const signer = new Stripe("sk_test_bdd");
  const payload = JSON.stringify({
    id: `evt_ball_late_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_old_BALL-OLDCRD",
        object: "checkout.session",
        customer_details: { email: BUYER },
        metadata: {
          product: "ball", reference: "BALL-OLDCRD", kind: "table", quantity: "1", seats: "10",
          buyerName: "Old Transfer", ticketsPence: "100000", donationPence: "0", feeCoverPence: "0",
          totalPence: "100000", giftAid: "false", newsletterOptIn: "false",
        },
      },
    },
  });
  const signature = signer.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy",
  });
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  assert.equal(res.status, 200);
});

Then(
  "the old card checkout is paid and flagged as paid after its seats were released, overbooking the room",
  async function () {
    const booking = await pool.query("SELECT id, status FROM ball_bookings WHERE reference = 'BALL-OLDCRD'");
    assert.equal(booking.rows[0].status, "paid");
    const audit = await pool.query(
      `SELECT data FROM audit_log WHERE action = 'ball.paid_after_seats_released' AND entity_id = $1`,
      [booking.rows[0].id],
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].data.overbooked, true);
  },
);

// --- TASK-485: deadlines --------------------------------------------------------------------------

Then("the transfer booking answer is {int} saying {string}", function (status, words) {
  assert.equal(this.transferStatus, status, JSON.stringify(this.transferBody));
  assert.ok(String(this.transferBody.error || "").includes(words), JSON.stringify(this.transferBody));
});

When("its reminder has gone", async function () {
  await pool.query("UPDATE ball_bookings SET transfer_reminder_sent_at = now() WHERE reference = $1", [this.transferRef]);
});

Then("it will be reminded again before the new date", async function () {
  const row = await pool.query("SELECT transfer_reminder_sent_at FROM ball_bookings WHERE reference = $1", [this.transferRef]);
  assert.equal(row.rows[0].transfer_reminder_sent_at, null);
});

const LONDON_TODAY = "(now() AT TIME ZONE 'Europe/London')::date";

Given("the last day for transfers was yesterday", async function () {
  await pool.query(`UPDATE ball_settings SET transfer_last_day = ${LONDON_TODAY} - 1 WHERE id = 1`);
});

Given("the last day for transfers is {int} days from today", async function (days) {
  const res = await pool.query(
    `UPDATE ball_settings SET transfer_last_day = ${LONDON_TODAY} + $1::int WHERE id = 1
     RETURNING to_char(transfer_last_day, 'YYYY-MM-DD') AS last_day`,
    [days],
  );
  this.lastDay = res.rows[0].last_day;
});

Then("the booking must be paid by the last day for transfers", function () {
  assert.equal(this.transferStatus, 201, JSON.stringify(this.transferBody));
  assert.equal(this.transferBody.payBy, this.lastDay);
});

Given("a bank transfer booking for {int} table was due to be paid {int} days ago", async function (_n, days) {
  await pool.query(
    `INSERT INTO ball_bookings
       (reference, kind, quantity, seats, buyer_name, buyer_email, tickets_pence, donation_pence,
        fee_cover_pence, total_pence, gift_aid, newsletter_opt_in, status, created_at, payment_method, pay_by)
     VALUES ('BALL-DUEAGO', 'table', 1, 10, 'Late Payer', $1, 100000, 0, 0, 100000, false, false, 'pending',
             now() - interval '9 days', 'transfer', ${LONDON_TODAY} - $2::int)`,
    [BUYER, days],
  );
});

When("{string} lists the bookings awaiting a transfer", async function (email) {
  await asStaff(this, email, "GET", "/api/admin/ball/transfers");
});

Then("that booking is listed as overdue", function () {
  assert.equal(this.adminStatus, 200, JSON.stringify(this.adminBody));
  const row = (this.adminBody.results || []).find((r) => r.reference === "BALL-DUEAGO");
  assert.ok(row, JSON.stringify(this.adminBody));
  assert.equal(row.overdue, true);
});

Then("it is still holding its seats", async function () {
  const row = await pool.query("SELECT status FROM ball_bookings WHERE reference = 'BALL-DUEAGO'");
  assert.equal(row.rows[0].status, "pending");
  const res = await fetch(`${BASE_URL}/api/ball/availability`);
  assert.equal((await res.json()).tablesRemaining, 9);
});

When("the buyer falls back to Stripe's own page for the same order", async function () {
  const first = this.ballCheckout;
  assert.ok(first && first.reference && first.clientSecret, "an inline checkout was started first");
  const res = await fetch(`${BASE_URL}/api/ball/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "seat",
      quantity: 1,
      buyerFirstName: "BDD",
      buyerSurname: "Buyer",
      buyerEmail: "checkout.ball.bdd@example.com",
      termsAccepted: true,
      uiMode: "hosted",
      replaces: { reference: first.reference, clientSecret: first.clientSecret },
    }),
  });
  assert.equal(res.status, 201);
  this.replacedReference = first.reference;
});

Then("exactly one pending card booking should hold seats", async function () {
  const rows = await pool.query(
    `SELECT reference, status FROM ball_bookings
      WHERE buyer_email = 'checkout.ball.bdd@example.com' AND payment_method = 'card'`,
  );
  const pending = rows.rows.filter((r) => r.status === "pending");
  assert.equal(pending.length, 1, JSON.stringify(rows.rows));
  const replaced = rows.rows.find((r) => r.reference === this.replacedReference);
  assert.equal(replaced && replaced.status, "cancelled");
});

// --- TASK-486: invoices ---------------------------------------------------------------------------

// Invented, like every fixture in this public repo.
const INVOICE = {
  company: "Example Widgets Ltd",
  address: "1 Test Street\nTestville\nTE1 1ST",
  po: "PO-0001",
  accountsEmail: "accounts.transfer.bdd@example.com",
  phone: "",
};

When("a company books {int} {word} to pay by bank transfer with an invoice", async function (quantity, what) {
  // Gift Aid ticked on the way in: a company cannot declare it, so it must not survive.
  await book(this, quantity, what, { donationPence: 1000, giftAid: true, invoice: INVOICE });
});

When("a company books {int} {word} to pay by bank transfer with an invoice but no address", async function (quantity, what) {
  await book(this, quantity, what, { invoice: { ...INVOICE, address: "" } });
});

Then("the booking keeps the company's invoice details, without Gift Aid", async function () {
  const row = await pool.query(
    `SELECT gift_aid, invoice_company, invoice_address, invoice_po, invoice_accounts_email, invoice_phone
       FROM ball_bookings WHERE reference = $1`,
    [this.transferRef],
  );
  const b = row.rows[0];
  assert.equal(b.gift_aid, false);
  assert.equal(b.invoice_company, INVOICE.company);
  assert.equal(b.invoice_address, INVOICE.address);
  assert.equal(b.invoice_po, INVOICE.po);
  assert.equal(b.invoice_accounts_email, INVOICE.accountsEmail);
  assert.equal(b.invoice_phone, null);
  assert.match(this.transferBody.invoiceUrl || "", /\/ball\/invoice\/\d+\.[A-Za-z0-9_-]+$/);
});

// The link is built on BALL_BASE_URL (the public site); open its path on the server under test.
async function openInvoice(world, path) {
  const res = await fetch(`${BASE_URL}${path}`);
  world.invoiceStatus = res.status;
  world.invoiceHeaders = res.headers;
  world.invoiceHtml = await res.text();
}
const invoicePath = (world) => new URL(world.transferBody.invoiceUrl).pathname;

When("I open the invoice link", async function () {
  await openInvoice(this, invoicePath(this));
});

When("I open the invoice link with its signature altered", async function () {
  const path = invoicePath(this);
  const last = path.slice(-1);
  await openInvoice(this, path.slice(0, -1) + (last === "A" ? "B" : "A"));
});

Then("the invoice page shows the company, the reference and the bank details", function () {
  assert.equal(this.invoiceStatus, 200, this.invoiceHtml.slice(0, 300));
  for (const part of [INVOICE.company, this.transferRef, BANK.accountNumber, "PO-0001"]) {
    assert.ok(this.invoiceHtml.includes(part), `the invoice shows ${part}`);
  }
});

Then("the invoice page is private and kept out of search engines", function () {
  assert.equal(this.invoiceHeaders.get("cache-control"), "private, no-store");
  assert.match(this.invoiceHeaders.get("x-robots-tag") || "", /noindex/);
});

Then("the booking is listed with its company and a link to its invoice", function () {
  assert.equal(this.adminStatus, 200, JSON.stringify(this.adminBody));
  const row = (this.adminBody.results || []).find((r) => r.reference === this.transferRef);
  assert.ok(row, JSON.stringify(this.adminBody));
  assert.equal(row.company, INVOICE.company);
  assert.equal(row.invoiceUrl, this.transferBody.invoiceUrl);
});

Then("the invoice page says it is paid", function () {
  assert.equal(this.invoiceStatus, 200);
  assert.match(this.invoiceHtml, /class="stamp paid">Paid/);
});

Then("the invoice page is not found", function () {
  assert.equal(this.invoiceStatus, 404);
});

// --- TASK-488: staff add a booking ----------------------------------------------------------------

Given("the bank details are entered but bank transfer is switched off", async function () {
  await pool.query(
    `UPDATE ball_settings SET transfer_on = false, transfer_account_name = $1,
            transfer_sort_code = $2, transfer_account_number = $3 WHERE id = 1`,
    [BANK.accountName, BANK.sortCode, BANK.accountNumber],
  );
});

When("{string} adds a bank transfer booking for {int} {word}", async function (email, quantity, what) {
  await asStaff(this, email, "POST", "/api/admin/ball/transfer-bookings", {
    kind: what.startsWith("table") ? "table" : "seat",
    quantity,
    buyerFirstName: "Ada",
    buyerSurname: "Phoned",
    buyerEmail: BUYER,
    donationPence: 1000,
    // Sent ticked: a staff booking must still carry no Gift Aid and no newsletter sign-up.
    giftAid: true,
    newsletterOptIn: true,
    termsAccepted: true,
  });
  if (this.adminStatus === 201) this.transferRef = this.adminBody.reference;
});

Then(
  "the added booking holds its seats with no Gift Aid, recorded as added by {string}",
  async function (email) {
    const row = await pool.query(
      `SELECT id, status, payment_method, gift_aid, newsletter_opt_in, terms_accepted_at
         FROM ball_bookings WHERE reference = $1`,
      [this.transferRef],
    );
    const b = row.rows[0];
    assert.ok(b, `no booking ${this.transferRef}`);
    assert.equal(b.status, "pending");
    assert.equal(b.payment_method, "transfer");
    assert.equal(b.gift_aid, false);
    assert.equal(b.newsletter_opt_in, false);
    assert.ok(b.terms_accepted_at, "the terms are recorded as agreed");
    const audit = await pool.query(
      `SELECT actor FROM audit_log WHERE action = 'ball.transfer_booking_added' AND entity_id = $1`,
      [b.id],
    );
    assert.deepEqual(audit.rows.map((r) => r.actor), [`admin:${email}`]);
  },
);

// --- TASK-487: telling the team -------------------------------------------------------------------

Given("{string} has just opened Festive Ball", async function (email) {
  await asStaff(this, email, "POST", "/api/admin/whats-new/seen", { area: "ball" });
  assert.equal(this.adminStatus, 200, JSON.stringify(this.adminBody));
});

async function ballIsNewTo(world, email) {
  await asStaff(world, email, "GET", "/api/admin/whats-new");
  assert.equal(world.adminStatus, 200, JSON.stringify(world.adminBody));
  const ball = (world.adminBody.areas || []).find((a) => a.area === "ball");
  assert.ok(ball, JSON.stringify(world.adminBody));
  return ball.new;
}

Then("Festive Ball is not new to {string}", async function (email) {
  assert.equal(await ballIsNewTo(this, email), false);
});

Then("Festive Ball is new to {string}", async function (email) {
  assert.equal(await ballIsNewTo(this, email), true);
});
