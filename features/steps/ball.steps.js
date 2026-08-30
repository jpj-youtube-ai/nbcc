const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert");
const { Client } = require("pg");
const Stripe = require("stripe");

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
