const { When, Then, Before } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const Stripe = require("stripe");

// Steps for fundraising-thanks.feature (TASK-507). The fundraisers, the switch, the staff
// accounts, "the fundraising answer is" and the clean up are fundraising.steps.js's; signing the
// organiser in is fundraising-private.steps.js's (it leaves the session in this.frSession). The
// thank yous and their gifts go with their fundraiser and its donations (ON DELETE CASCADE).
//
// The emails are stubbed in CI and logged as sent in email_log, so "a thank you email soon goes to"
// waits for that row, written by the background sender after staff approve. Every name and address
// is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const COOKIE = "nbcc_fr_session";
const PASSWORD = "pw-fundraising-bdd";
const KIND = "fundraiseSupporterThanks";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // unused key: generateTestHeaderString is pure HMAC

Before({ tags: "@fundraising-thanks" }, function () {
  this.frThanksSince = new Date(Date.now() - 1000);
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

// As the private area sends them: JSON, from our own origin, with the session cookie.
async function organiserCall(world, method, path, body) {
  const headers = { "Content-Type": "application/json", Origin: new URL(BASE_URL).origin };
  if (world.frSession) headers.Cookie = `${COOKIE}=${world.frSession}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function fundraiserId(title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].id;
}

async function theirThanks(world, title) {
  const id = await fundraiserId(title);
  const body = await organiserCall(world, "GET", "/api/fundraise/manage/thanks");
  assert.equal(world.frStatus, 200, JSON.stringify(body));
  const f = (body.fundraisers || []).find((x) => x.id === id);
  assert.ok(f, `the private area does not list ${title}`);
  return f;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A gift on the page as the give form sends it, from the address given, with the newsletter box
// ticked or not (which is what writes the giver's thank you consent), replayed as Stripe's signed
// webhook, as giveOnPage in fundraising.steps.js does. Its payment intent starts "pi_fr_bdd_", so
// the clean up there takes the gift and the giver away.
let seq = 0;
async function giveFrom(world, email, ticked, amount, title, paymentIntent) {
  const id = await fundraiserId(title);
  const res = await fetch(`${BASE_URL}/api/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "once",
      plan: null,
      amount,
      giftAid: false,
      donorType: "individual",
      fullName: "Giver Example",
      email,
      emailConsent: ticked,
      fundraiserId: id,
    }),
  });
  const checkout = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, JSON.stringify(checkout));
  assert.ok(checkout.session, "no session echoed from checkout: is the Stripe stub active?");
  seq += 1;
  const payload = JSON.stringify({
    id: `evt_fr_bdd_thanks_${Date.now()}_${seq}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkout.session.id,
        object: "checkout.session",
        metadata: checkout.session.metadata,
        mode: checkout.session.mode,
        amount_total: amount,
        currency: "gbp",
        payment_status: "paid",
        payment_intent: paymentIntent,
        subscription: null,
        customer_details: { name: "Giver Example", email },
        created: Math.floor(Date.now() / 1000),
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const hook = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  assert.equal(hook.status, 200, await hook.text());
  world.frStatus = hook.status;
}

When(
  "{string}, who ticked the newsletter box, gives {int} pence on the page for {string}, paid as {string}",
  async function (email, amount, title, paymentIntent) {
    await giveFrom(this, email, true, amount, title, paymentIntent);
  },
);

When(
  "{string}, who left the newsletter box unticked, gives {int} pence on the page for {string}, paid as {string}",
  async function (email, amount, title, paymentIntent) {
    await giveFrom(this, email, false, amount, title, paymentIntent);
  },
);

When("the signed in organiser thanks every gift on {string} with {string}", async function (title, message) {
  const f = await theirThanks(this, title);
  const ids = f.gifts.filter((g) => !g.thanked).map((g) => g.donationId);
  assert.ok(ids.length > 0, `no gifts to thank on ${title}`);
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${f.id}/thanks`, { message, donationIds: ids });
});

When("the signed in organiser thanks the gift paid as {string} on {string} with {string}", async function (paymentIntent, title, message) {
  const id = await fundraiserId(title);
  const d = await pool.query("SELECT id FROM donations WHERE stripe_payment_intent_id = $1", [paymentIntent]);
  assert.ok(d.rows[0], "no such gift");
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${id}/thanks`, { message, donationIds: [d.rows[0].id] });
});

Then("the private area shows the thank you on {string} as {string}", async function (title, words) {
  const f = await theirThanks(this, title);
  assert.equal(f.thanks[0] && f.thanks[0].statusWords, words, JSON.stringify(f.thanks));
});

Then("the private area soon shows the thank you on {string} as {string}", { timeout: 20000 }, async function (title, words) {
  let seen = null;
  for (let tries = 0; tries < 60; tries += 1) {
    const f = await theirThanks(this, title);
    seen = f.thanks[0] && f.thanks[0].statusWords;
    if (seen === words) return;
    await pause(250);
  }
  assert.equal(seen, words);
});

When("{string} approves the thank you waiting on {string}", async function (email, title) {
  const id = await fundraiserId(title);
  const t = await pool.query("SELECT id FROM fundraiser_thanks WHERE fundraiser_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1", [id]);
  assert.ok(t.rows[0], "no thank you is waiting");
  const token = await login(email);
  const res = await fetch(`${BASE_URL}/api/admin/fundraisers/${id}/thanks/${t.rows[0].id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}",
  });
  this.frStatus = res.status;
  this.frBody = await res.json().catch(() => ({}));
});

async function thanksEmailsTo(world, email) {
  const r = await pool.query("SELECT status FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2) AND created_at >= $3", [
    KIND,
    email,
    world.frThanksSince,
  ]);
  return r.rows;
}

Then("no thank you email has gone to {string}", async function (email) {
  await pause(300);
  assert.deepEqual(await thanksEmailsTo(this, email), []);
});

Then("a thank you email soon goes to {string}", { timeout: 20000 }, async function (email) {
  for (let tries = 0; tries < 60; tries += 1) {
    const rows = await thanksEmailsTo(this, email);
    if (rows.length) {
      assert.equal(rows.length, 1, "the giver was emailed more than once");
      assert.equal(rows[0].status, "sent");
      return;
    }
    await pause(250);
  }
  assert.fail(`no ${KIND} email went to ${email}`);
});

Then("the organiser's private area never shows {string}", async function (email) {
  const thanks = await organiserCall(this, "GET", "/api/fundraise/manage/thanks");
  const me = await organiserCall(this, "GET", "/api/fundraise/manage/me");
  assert.ok(!JSON.stringify(thanks).toLowerCase().includes(email.toLowerCase()), "the thank you list shows a giver's address");
  assert.ok(!JSON.stringify(me).toLowerCase().includes(email.toLowerCase()), "the private area shows a giver's address");
});

Then("no thank you is stored for {string}", async function (title) {
  const id = await fundraiserId(title);
  const r = await pool.query("SELECT 1 FROM fundraiser_thanks WHERE fundraiser_id = $1", [id]);
  assert.equal(r.rows.length, 0);
});
