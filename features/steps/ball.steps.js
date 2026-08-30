const { Given, When, Then, Before } = require("@cucumber/cucumber");
const assert = require("node:assert");
const { Client } = require("pg");
const Stripe = require("stripe");
const { randomBytes, scryptSync } = require("node:crypto");

// Signed-webhook helpers, mirroring features/steps/donation-journey.steps.js: the app verifies
// against STRIPE_WEBHOOK_SECRET and generateTestHeaderString is pure HMAC, so the whole path
// runs offline with no Stripe account.
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripeSigner = new Stripe("sk_test_bdd");
let ballSeq = 0;

function signedEvent(type, object) {
  ballSeq += 1;
  const payload = JSON.stringify({
    id: `evt_ball_${Date.now()}_${ballSeq}`,
    object: "event",
    type,
    data: { object },
  });
  const signature = stripeSigner.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

// TASK-313: BDD steps for the public Festive Ball availability feed. Talks to the database
// directly to arrange capacity (there is no admin write endpoint until plan 4), then reads
// the public JSON endpoint over HTTP, like the other @db features do.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function withDb(fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

Given(
  "the ball is reset to {int} tables of {int} with {int} held back",
  async function (tables, seats, held) {
    await withDb(async (db) => {
      await db.query("DELETE FROM ball_reservations");
      await db.query("DELETE FROM ball_bookings");
      await db.query(
        `UPDATE ball_settings
            SET total_tables = $1, seats_per_table = $2, held_seats = $3,
                sales_closed = false, sales_close_at = NULL
          WHERE id = 1`,
        [tables, seats, held],
      );
    });
  },
);

Given("ball sales are closed by hand", async function () {
  await withDb((db) => db.query("UPDATE ball_settings SET sales_closed = true WHERE id = 1"));
});

When("I request the ball availability", async function () {
  const res = await fetch(`${BASE_URL}/api/ball/availability`);
  this.ballStatus = res.status;
  this.ballBody = await res.json();
});

Then("the ball response status should be {int}", function (expected) {
  assert.strictEqual(this.ballStatus, expected);
});

Then("the ball availability should show {int} seats remaining", function (n) {
  assert.strictEqual(this.ballBody.seatsRemaining, n);
});

Then("the ball availability should show {int} tables remaining", function (n) {
  assert.strictEqual(this.ballBody.tablesRemaining, n);
});

Then("the ball availability should say sales are open", function () {
  assert.strictEqual(this.ballBody.salesOpen, true);
});

Then("the ball availability should say sales are closed", function () {
  assert.strictEqual(this.ballBody.salesOpen, false);
});

Then("the ball availability should not contain buyer details", function () {
  const body = JSON.stringify(this.ballBody).toLowerCase();
  assert.ok(!body.includes("email"), "availability must not leak buyer emails");
  assert.ok(!body.includes("buyer"), "availability must not leak buyer names");
  assert.ok(!body.includes("reference"), "availability must not leak booking references");
});

// --- purchase path ----------------------------------------------------------

function ballSessionObject(sessionId, kind, quantity, seats) {
  return {
    id: sessionId,
    object: "checkout.session",
    customer_details: { email: "buyer.ball.bdd@example.com" },
    metadata: {
      product: "ball",
      reference: `BALL-${sessionId.slice(-6).toUpperCase()}`,
      kind,
      quantity: String(quantity),
      seats: String(seats),
      buyerName: "Ball Buyer",
      ticketsPence: String(kind === "table" ? quantity * 100000 : quantity * 10000),
      donationPence: "0",
      feeCoverPence: "0",
      totalPence: String(kind === "table" ? quantity * 100000 : quantity * 10000),
      giftAid: "false",
      newsletterOptIn: "false",
    },
  };
}

async function post(payload, signature) {
  return fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
}

When("a paid ball checkout completes for {int} table", async function (tables) {
  this.ballSessionId = `cs_ball_bdd_${Date.now()}`;
  const object = ballSessionObject(this.ballSessionId, "table", tables, tables * 10);
  this.ballEvent = signedEvent("checkout.session.completed", object);
  const res = await post(this.ballEvent.payload, this.ballEvent.signature);
  this.ballStatus = res.status;
});

When("that same ball event is delivered again", async function () {
  const res = await post(this.ballEvent.payload, this.ballEvent.signature);
  this.ballStatus = res.status;
});

Given("a pending ball booking exists for {int} table", async function (tables) {
  this.ballSessionId = `cs_ball_pending_${Date.now()}`;
  await withDb((db) =>
    db.query(
      `INSERT INTO ball_bookings
         (reference, kind, quantity, seats, buyer_name, buyer_email,
          tickets_pence, donation_pence, fee_cover_pence, total_pence, stripe_session_id, status)
       VALUES ('BALL-PEND01','table',$1,$2,'Pending Buyer','pending.ball.bdd@example.com',
               $3,0,0,$3,$4,'pending')`,
      [tables, tables * 10, tables * 100000, this.ballSessionId],
    ),
  );
});

When("that ball checkout session expires", async function () {
  const object = { id: this.ballSessionId, object: "checkout.session", metadata: { product: "ball" } };
  const { payload, signature } = signedEvent("checkout.session.expired", object);
  const res = await post(payload, signature);
  this.ballStatus = res.status;
});

When("a donation checkout completes", async function () {
  const object = {
    id: `cs_donation_bdd_${Date.now()}`,
    object: "checkout.session",
    amount_total: 2500,
    currency: "gbp",
    payment_status: "paid",
    customer_details: { email: "donor.ball.bdd@example.com", name: "Donor Person" },
    metadata: { mode: "once", donorType: "individual", giftAid: "false" },
  };
  const { payload, signature } = signedEvent("checkout.session.completed", object);
  const res = await post(payload, signature);
  this.ballStatus = res.status;
});

Then("a ball booking should exist with status {string}", async function (status) {
  const rows = await withDb((db) =>
    db.query("SELECT status FROM ball_bookings WHERE stripe_session_id = $1", [this.ballSessionId]),
  );
  assert.strictEqual(rows.rowCount, 1, "expected exactly one booking for this session");
  assert.strictEqual(rows.rows[0].status, status);
});

Then("no ball booking should have been created", async function () {
  const rows = await withDb((db) => db.query("SELECT count(*)::int AS n FROM ball_bookings"));
  assert.strictEqual(rows.rows[0].n, 0, "a donation must never create a ball booking");
});

// --- checkout endpoint ------------------------------------------------------

async function startCheckout(ctx, body) {
  const res = await fetch(`${BASE_URL}/api/ball/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      buyerName: "BDD Buyer",
      buyerEmail: "checkout.ball.bdd@example.com",
      ...body,
    }),
  });
  ctx.ballStatus = res.status;
  ctx.ballCheckout = await res.json().catch(() => ({}));
}

When("I start a ball checkout for {int} seats", async function (n) {
  await startCheckout(this, { kind: "seat", quantity: n });
});

When("I start a ball checkout for {int} seat", async function (n) {
  await startCheckout(this, { kind: "seat", quantity: n });
});

When("I start a ball checkout for {int} table", async function (n) {
  await startCheckout(this, { kind: "table", quantity: n });
});

When(
  "I start a ball checkout for {int} seat with a {int} donation covering the fee",
  async function (n, donationPence) {
    await startCheckout(this, { kind: "seat", quantity: n, donationPence, coverFee: true });
  },
);

When("I start a ball checkout for {int} seat claiming Gift Aid with no donation", async function (n) {
  await startCheckout(this, { kind: "seat", quantity: n, giftAid: true, donationPence: 0 });
});

Then("the ball checkout should return a booking reference", function () {
  assert.match(String(this.ballCheckout.reference), /^BALL-[A-Z2-9]{6}$/);
});

Then("the ball checkout total should be {int} pence", function (pence) {
  assert.strictEqual(this.ballCheckout.totalPence, pence);
});

// --- the password gate ------------------------------------------------------

const PREVIEW_PASSWORD = process.env.BALL_PREVIEW_PASSWORD || "bdd-ball-preview";

async function setGate(sql, params) {
  await withDb((db) => db.query(sql, params));
}

Given("the ball gate is closed", async function () {
  this.ballCookie = null;
  await setGate("UPDATE ball_settings SET gate_open = false, gate_opens_at = NULL WHERE id = 1");
});

Given("the ball gate is open", async function () {
  this.ballCookie = null;
  await setGate("UPDATE ball_settings SET gate_open = true, gate_opens_at = NULL WHERE id = 1");
});

Given("the ball gate is closed but scheduled to open in the past", async function () {
  this.ballCookie = null;
  await setGate(
    "UPDATE ball_settings SET gate_open = false, gate_opens_at = now() - interval '1 hour' WHERE id = 1",
  );
});

Given("the ball gate is closed but scheduled to open in the future", async function () {
  this.ballCookie = null;
  await setGate(
    "UPDATE ball_settings SET gate_open = false, gate_opens_at = now() + interval '7 days' WHERE id = 1",
  );
});

Given("the ball arrival time is set to {string}", async function (value) {
  await setGate("UPDATE ball_settings SET arrival_time = $1 WHERE id = 1", [value]);
});

async function getBall(ctx, path) {
  const headers = {};
  if (ctx.ballCookie) headers.Cookie = ctx.ballCookie;
  const res = await fetch(`${BASE_URL}${path}`, { headers, redirect: "manual" });
  ctx.ballPageStatus = res.status;
  ctx.ballPageBody = await res.text();
}

When("I request the ball page", async function () {
  await getBall(this, "/ball");
});

When("I request {string}", async function (path) {
  await getBall(this, path);
});

When("I unlock the ball page with {string}", async function (password) {
  const res = await fetch(`${BASE_URL}/ball/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }).toString(),
    redirect: "manual",
  });
  this.ballPageStatus = res.status;
  this.ballPageBody = await res.text();
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    this.ballCookie = setCookie.split(";")[0];
    await getBall(this, "/ball");
  }
});

When("I unlock the ball page with the real password", async function () {
  const res = await fetch(`${BASE_URL}/ball/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: PREVIEW_PASSWORD }).toString(),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "unlocking with the real password should set a cookie");
  this.ballCookie = setCookie.split(";")[0];
  await getBall(this, "/ball");
});

Then("the ball page status should be {int}", function (expected) {
  assert.strictEqual(this.ballPageStatus, expected);
});

Then("the ball page should ask for a password", function () {
  assert.match(this.ballPageBody, /name="password"/);
});

Then("the ball page should not reveal the event", function () {
  const body = this.ballPageBody;
  for (const secret of ["Michelle McManus", "Clanadonia", "The Park Hotel", "Book tickets"]) {
    assert.ok(!body.includes(secret), `the locked page leaked "${secret}"`);
  }
});

Then("the ball page should show the event", function () {
  assert.ok(this.ballPageBody.includes("Michelle McManus"), "expected the real page");
});

// Assert against the robots META TAG, not the whole document. A plain string search for
// "noindex" also matches the explanatory HTML comment in ball.html, which fails the scenario
// while the actual directive is correct — a test bug that looks exactly like a product bug.
function robotsTag(body) {
  const match = /<meta[^>]*name="robots"[^>]*>/i.exec(body);
  assert.ok(match, "expected a robots meta tag on the page");
  return match[0];
}

Then("the ball page should be hidden from search engines", function () {
  assert.match(robotsTag(this.ballPageBody), /content="noindex, nofollow"/);
});

Then("the ball page should be visible to search engines", function () {
  const tag = robotsTag(this.ballPageBody);
  assert.match(tag, /content="index, follow"/);
  assert.ok(!tag.includes("noindex"), "the robots directive must not still say noindex");
});

Then("the ball page should contain {string}", function (text) {
  assert.ok(this.ballPageBody.includes(text), `expected the page to contain "${text}"`);
});

Then("the ball page should not contain {string}", function (text) {
  assert.ok(!this.ballPageBody.includes(text), `expected the page NOT to contain "${text}"`);
});

// --- admin ------------------------------------------------------------------
//
// Seeds a staff user with a scrypt hash in the same format as src/admin/password.ts, logs in
// through the real endpoint (completing the mandatory email 2FA, which returns devCode while
// the email client is stubbed), then calls the role-gated ball endpoints.

function hashBallPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function ballLogin(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    const body2 = await res2.json().catch(() => ({}));
    return body2.token;
  }
  return undefined;
}

Before({ tags: "@ball" }, async function () {
  await withDb((db) =>
    db.query("DELETE FROM users WHERE email LIKE '%admin.bdd@example.com'"),
  );
});

Given(
  "a ball admin {string} with role {string} and password {string}",
  async function (email, role, password) {
    await withDb((db) =>
      db.query(
        "INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'Ball Staff', $2, $3)",
        [email, role, hashBallPassword(password)],
      ),
    );
  },
);

When("I GET the ball admin without a token", async function () {
  const res = await fetch(`${BASE_URL}/api/admin/ball`);
  this.ballAdminStatus = res.status;
  this.ballAdminBody = await res.json().catch(() => ({}));
});

When(
  "I GET the ball admin as {string} with password {string}",
  async function (email, password) {
    const token = await ballLogin(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/ball`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.ballAdminStatus = res.status;
    this.ballAdminBody = await res.json().catch(() => ({}));
  },
);

// The body arrives as a Cucumber DocString (the triple-quoted block under the step). Passing
// raw JSON through a {string} parameter does not work: Gherkin's {string} only matches
// double-quoted text, so an unquoted {"gateOpen": true} leaves the step UNDEFINED — which
// cucumber reports as a skip, not a failure, and quietly passes the build.
When(
  "I PATCH the ball admin as {string} with password {string}:",
  async function (email, password, docString) {
    const token = await ballLogin(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/ball`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: docString,
    });
    this.ballAdminStatus = res.status;
    this.ballAdminBody = await res.json().catch(() => ({}));
  },
);

Then("the ball admin status should be {int}", function (expected) {
  assert.strictEqual(this.ballAdminStatus, expected);
});

Then("the ball admin should report {int} seats remaining", function (n) {
  assert.strictEqual(this.ballAdminBody.availability.seatsRemaining, n);
});

// --- guest details ----------------------------------------------------------

async function seedBooking(token, status, kind, quantity, seats) {
  await withDb((db) =>
    db.query(
      `INSERT INTO ball_bookings
         (reference, kind, quantity, seats, buyer_name, buyer_email,
          tickets_pence, donation_pence, fee_cover_pence, total_pence,
          stripe_session_id, status, guest_token)
       VALUES ($1,$2,$3,$4,'Guest Buyer','guest.ball.bdd@example.com',
               $5,0,0,$5,$6,$7,$8)`,
      [
        "BALL-" + token.slice(-6).toUpperCase(),
        kind, quantity, seats,
        kind === "table" ? quantity * 100000 : quantity * 10000,
        "cs_guest_" + token,
        status,
        token,
      ],
    ),
  );
}

Given("a paid ball booking for {int} table with guest token {string}", async function (n, token) {
  await withDb((db) => db.query("DELETE FROM ball_bookings WHERE guest_token = $1", [token]));
  await seedBooking(token, "paid", "table", n, n * 10);
});

Given("a pending ball booking with guest token {string}", async function (token) {
  await withDb((db) => db.query("DELETE FROM ball_bookings WHERE guest_token = $1", [token]));
  await seedBooking(token, "pending", "table", 1, 10);
});

When("I open the guest link {string}", async function (token) {
  const res = await fetch(`${BASE_URL}/ball/guests/${token}`);
  this.guestStatus = res.status;
  this.guestBody = await res.text();
});

async function postGuests(ctx, token, form) {
  const res = await fetch(`${BASE_URL}/ball/guests/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    redirect: "follow",
  });
  ctx.guestStatus = res.status;
  ctx.guestBody = await res.text();
}

When("I save guests {string} on {string}", async function (names, token) {
  const form = {};
  names.split(",").forEach(function (name, i) { form["fullName" + (i + 1)] = name.trim(); });
  await postGuests(this, token, form);
});

When("I save a guest {string} with dietary {string} on {string}", async function (name, diet, token) {
  await postGuests(this, token, { fullName1: name, dietary1: diet });
});

Then("the guest page status should be {int}", function (expected) {
  assert.strictEqual(this.guestStatus, expected);
});

Then("the guest page should have {int} guest name fields", function (n) {
  const count = (this.guestBody.match(/name="fullName\d+"/g) || []).length;
  assert.strictEqual(count, n);
});

Then("the guest page should work without JavaScript", function () {
  assert.match(this.guestBody, /method="post"/);
  assert.ok(!this.guestBody.includes("<script"), "the guest form must not depend on JavaScript");
});

Then("the guest page should show {string}", function (text) {
  assert.ok(this.guestBody.includes(text), `expected the page to show "${text}"`);
});

Then("the guest page should not reveal any booking", function () {
  assert.ok(!/BALL-[A-Z2-9]{6}/.test(this.guestBody), "the not-found page must not leak a reference");
});

// --- exports ----------------------------------------------------------------

When(
  "I download the ball {string} list as {string} with password {string}",
  async function (which, email, password) {
    const token = await ballLogin(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/ball/${which}.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.ballExportStatus = res.status;
    this.ballExportBody = await res.text();
  },
);

When("I download the ball {string} list without a token", async function (which) {
  const res = await fetch(`${BASE_URL}/api/admin/ball/${which}.csv`);
  this.ballExportStatus = res.status;
  this.ballExportBody = await res.text();
});

Then("the ball export status should be {int}", function (expected) {
  assert.strictEqual(this.ballExportStatus, expected);
});

Then("the ball export should contain {string}", function (text) {
  assert.ok(this.ballExportBody.includes(text), `expected the export to contain "${text}"`);
});

Then("the ball export should not contain an email address", function () {
  assert.ok(!this.ballExportBody.includes("@"), "this export must carry no email addresses");
});

Then("the ball export should not contain a booking reference", function () {
  assert.ok(
    !/BALL-[A-Z2-9]{6}/.test(this.ballExportBody),
    "the venue's list must carry no booking references",
  );
});

// --- reminders --------------------------------------------------------------

When(
  "I send the ball reminders as {string} with password {string}",
  async function (email, password) {
    const token = await ballLogin(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/ball/reminders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    this.ballReminderStatus = res.status;
    this.ballReminderBody = await res.json().catch(() => ({}));
  },
);

Then("the ball reminder status should be {int}", function (expected) {
  assert.strictEqual(this.ballReminderStatus, expected);
});

Then("the ball reminder should report {int} sent", function (n) {
  assert.strictEqual(this.ballReminderBody.sent, n);
});

// --- waiting list -----------------------------------------------------------

Given("the ball waiting list is empty", async function () {
  await withDb((db) => db.query("DELETE FROM ball_waiting_list"));
});

When(
  "I join the ball waiting list as {string} with email {string}",
  async function (name, email) {
    const res = await fetch(`${BASE_URL}/api/ball/waiting-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, seatsWanted: 2 }),
    });
    this.waitingStatus = res.status;
    this.waitingBody = await res.json().catch(() => ({}));
  },
);

When(
  "I read the ball waiting list as {string} with password {string}",
  async function (email, password) {
    const token = await ballLogin(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/ball/waiting-list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.waitingStatus = res.status;
    this.waitingBody = await res.json().catch(() => ({}));
  },
);

When("I read the ball waiting list without a token", async function () {
  const res = await fetch(`${BASE_URL}/api/admin/ball/waiting-list`);
  this.waitingStatus = res.status;
  this.waitingBody = await res.json().catch(() => ({}));
});

Then("the waiting list response status should be {int}", function (expected) {
  assert.strictEqual(this.waitingStatus, expected);
});

Then("the waiting list should say I am on it", function () {
  assert.strictEqual(this.waitingBody.added, true);
  assert.match(this.waitingBody.message, /on the list/i);
});

Then("the waiting list should say I am already on it", function () {
  assert.strictEqual(this.waitingBody.added, false);
  assert.match(this.waitingBody.message, /already on the list/i);
});

Then("the ball waiting list should hold {int} person", async function (n) {
  const rows = await withDb((db) => db.query("SELECT count(*)::int AS n FROM ball_waiting_list"));
  assert.strictEqual(rows.rows[0].n, n);
});

Then("the ball waiting list should hold {int} people", function (n) {
  assert.strictEqual((this.waitingBody.results || []).length, n);
});

Then("the first person waiting should be {string}", function (name) {
  assert.strictEqual(this.waitingBody.results[0].name, name);
});
