const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const Stripe = require("stripe");
const { randomBytes } = require("node:crypto");

// Steps for event-tickets.feature: NBCC selling an event's tickets. The switches, staff, the
// organiser's signed in session, "the fundraising answer is", a visitor's request and "the page
// shows" are fundraising.steps.js's, fundraising-private.steps.js's, event-pages.steps.js's and
// events.steps.js's (whose hooks also clean up: the feature carries their tags, the event names end
// "(bdd-fr)" and every ticket row goes with its event). Stripe is the app's offline stub in CI, so
// a payment is confirmed by posting the webhook Stripe would send, signed with the same secret, as
// stripe-webhook.steps.js and fundraising.steps.js do. Every name and address here is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const EVENTS_INBOX = process.env.BALL_FROM_EMAIL || "events@nbcc.scot";
const PASSWORD = "pw-fundraising-bdd";
const COOKIE = "nbcc_fr_session";
const stripe = new Stripe("sk_test_bdd"); // unused key: generateTestHeaderString is pure HMAC
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORIGIN = new URL(BASE_URL).origin;

function slugFor(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base}-${randomBytes(3).toString("hex")}`;
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

// A staff call: the answer is kept where "the fundraising answer is" reads it, and as text for a page.
async function adminCall(world, email, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await login(email)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.etText = await res.text();
  try {
    world.frBody = JSON.parse(world.etText);
  } catch {
    world.frBody = {};
  }
  return world.frBody;
}

async function eventOf(title) {
  const r = await pool.query("SELECT id, slug, organiser_email FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no event called ${title}`);
  return r.rows[0];
}

async function typeOf(title, name) {
  const e = await eventOf(title);
  const r = await pool.query("SELECT id, status, price_pence FROM event_ticket_types WHERE fundraiser_id = $1 AND name = $2 ORDER BY id DESC LIMIT 1", [e.id, name]);
  assert.ok(r.rows[0], `no ${name} ticket for ${title}`);
  return { ...r.rows[0], eventId: e.id };
}

async function orderOf(email) {
  const r = await pool.query(
    `SELECT o.id, o.reference, o.status, o.fundraiser_id, o.stripe_session_id, o.total_pence, o.refunded_pence,
            (SELECT COALESCE(SUM(l.quantity - l.refunded_quantity), 0) FROM event_ticket_order_lines l WHERE l.order_id = o.id)::int AS tickets
       FROM event_ticket_orders o WHERE lower(o.buyer_email) = lower($1) ORDER BY o.id DESC LIMIT 1`,
    [email],
  );
  assert.ok(r.rows[0], `no booking for ${email}`);
  return r.rows[0];
}

let seq = 0;
async function postSignedWebhook(world, type, object, id) {
  seq += 1;
  const payload = JSON.stringify({ id: id || `evt_fr_bdd_et_${Date.now()}_${seq}`, object: "event", type, data: { object } });
  world.etLastWebhook = payload;
  return sendWebhook(payload);
}
async function sendWebhook(payload) {
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  assert.equal(res.status, 200, `the webhook answered ${res.status}`);
  return res;
}

async function buy(world, email, quantity, name, title) {
  const type = await typeOf(title, name);
  const res = await fetch(`${BASE_URL}/api/event-tickets/${type.eventId}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    // With the price the page showed, as the page's script sends it.
    body: JSON.stringify({ lines: [{ typeId: type.id, quantity, pricePence: type.price_pence }], firstName: "Buyer", lastName: "Testperson", email, phone: "", coverFee: false }),
  });
  const body = await res.json().catch(() => ({}));
  world.etStatus = res.status;
  world.etBody = body;
  return { status: res.status, body };
}

async function confirm(world, email, paymentIntent) {
  const o = await orderOf(email);
  await postSignedWebhook(world, "checkout.session.completed", {
    id: o.stripe_session_id,
    object: "checkout.session",
    payment_status: "paid",
    payment_intent: paymentIntent,
    amount_total: o.total_pence,
    currency: "gbp",
    customer_details: { email },
    metadata: { product: "event_tickets", orderReference: o.reference, eventId: String(o.fundraiser_id) },
  });
}

const signUpBody = (title, over) => ({
  path: "event",
  kind: "quiz",
  title,
  description: "A ceilidh in the village hall, with a raffle at half time.",
  eventDate: "2099-11-21",
  startTime: "19:30",
  venue: "Example Village Hall",
  town: "Exampleton",
  targetPence: null,
  public: true,
  firstName: "Kim",
  lastName: "Testperson",
  email: "kim.et.fr.bdd@example.com",
  phone: "07700 900123",
  socialOk: false,
  over18: true,
  sharesWithOther: false,
  // As the rebuilt sign up form sends it (the sign up tidy): it says so, and answers what that form asks.
  formVersion: 2,
  listed: true,
  inMemory: false,
  forOrganisation: false,
  instagram: "",
  facebook: "",
  postLine1: "1 Example Road",
  postLine2: "",
  postTown: "Exampleton",
  postPostcode: "EX1 1EX",
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false },
  newsletterOk: false,
  cardLine: "A ceilidh for NBCC (bdd-fr).",
  endTime: "22:30",
  timeTbc: false,
  venueAddress: "Main Street, Exampleton",
  venuePostcode: "KA1 1AA",
  access: [],
  price: "",
  booking: "nbcc",
  ticketUrl: "",
  company: "",
  ...over,
});

async function signUp(world, body) {
  const res = await fetch(`${BASE_URL}/api/fundraise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
}

// ---- arranging ----

When("someone signs up the event {string} with NBCC selling {string} tickets at {int} pence", async function (title, name, pence) {
  await signUp(this, signUpBody(title, { ticketTypes: [{ name, pricePence: pence, quantity: 80 }], ticketLimit: 100 }));
});

When("someone sharing with another cause signs up the event {string} with NBCC selling the tickets", async function (title) {
  await signUp(
    this,
    signUpBody(title, { sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder", ticketTypes: [{ name: "Adult", pricePence: 1000 }] }),
  );
});

Then("the sign up is refused because the ticket money must all come to NBCC", function () {
  assert.match(String(this.frBody.fields && this.frBody.fields.booking), /all the ticket money comes to NBCC/);
});

Given("an approved event {string} selling {int} {string} tickets at {int} pence through NBCC", async function (title, quantity, name, pence) {
  const r = await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, event_date, start_time, venue, town, public, status, booking, card_line,
                              organiser_name, organiser_email, organiser_phone, approved_at, approved_by, updated_by, slug_set_at)
     VALUES ($1, 'event', 'quiz', $2, 'Eight rounds and a raffle.', '2099-11-22', '19:30', 'Example Church Hall', 'Exampleton', true,
             'approved', 'nbcc', 'A quiz for NBCC.', 'Kim Testperson', 'kim.et.fr.bdd@example.com', '07700 900124', now(), 'bdd', 'bdd', now())
     RETURNING id`,
    [slugFor(title), title],
  );
  const id = r.rows[0].id;
  await pool.query("INSERT INTO event_ticket_settings (fundraiser_id) VALUES ($1)", [id]);
  await pool.query(
    `INSERT INTO event_ticket_types (fundraiser_id, name, price_pence, quantity, status, proposed_by, approved_at, approved_by)
     VALUES ($1, $2, $3, $4, 'approved', 'bdd', now(), 'bdd')`,
    [id, name, pence, quantity],
  );
});

Given("{string} has bought {int} {string} tickets for {string}, paid as {string}", async function (email, quantity, name, title, paymentIntent) {
  await buy(this, email, quantity, name, title);
  assert.equal(this.etStatus, 200, `the checkout answered ${this.etStatus}: ${JSON.stringify(this.etBody)}`);
  await confirm(this, email, paymentIntent);
  assert.equal((await orderOf(email)).status, "paid");
});

// ---- staff approve tickets ----

Then("the {string} ticket for {string} is stored as {string}", async function (name, title, status) {
  assert.equal((await typeOf(title, name)).status, status);
});

When("{string} approves the {string} ticket for {string}", async function (email, name, title) {
  const t = await typeOf(title, name);
  await adminCall(this, email, "POST", `/api/admin/event-tickets/${t.eventId}/types/${t.id}/approve`);
  assert.equal(this.frStatus, 200, `could not approve the ticket: ${JSON.stringify(this.frBody)}`);
});

// ---- buying ----

When("{string} tries to buy {int} {string} ticket(s) for {string}", async function (email, quantity, name, title) {
  await buy(this, email, quantity, name, title);
});

Then("the ticket answer is {int}", function (status) {
  assert.equal(this.etStatus, status, JSON.stringify(this.etBody));
});

Then("the ticket answer says {string}", function (words) {
  assert.equal(this.etBody.error, words);
});

Then("the ticket answer gives a Stripe checkout address", function () {
  assert.match(String(this.etBody.url), /^https:\/\/checkout\.stripe\.com\//);
});

Then("{string} has a {string} booking for {int} ticket(s)", async function (email, status, tickets) {
  const o = await orderOf(email);
  assert.equal(o.status, status);
  assert.equal(o.tickets, tickets);
  assert.match(o.reference, /^TIX-[A-Z2-9]{6}$/);
});

When("Stripe confirms the ticket checkout of {string}, paid as {string}", async function (email, paymentIntent) {
  await confirm(this, email, paymentIntent);
});

When("Stripe sends the same confirmation again", async function () {
  await sendWebhook(this.etLastWebhook);
});

When("Stripe expires the ticket checkout of {string}", async function (email) {
  const o = await orderOf(email);
  await postSignedWebhook(this, "checkout.session.expired", {
    id: o.stripe_session_id,
    object: "checkout.session",
    metadata: { product: "event_tickets", orderReference: o.reference, eventId: String(o.fundraiser_id) },
  });
  assert.equal((await orderOf(email)).status, "expired");
});

Then("no donation was recorded for the payment {string}", async function (paymentIntent) {
  const r = await pool.query("SELECT 1 FROM donations WHERE stripe_payment_intent_id = $1", [paymentIntent]);
  assert.equal(r.rows.length, 0, "a ticket payment was recorded as a donation");
});

// ---- emails ----

async function emailsTo(kind, email) {
  const r = await pool.query(
    "SELECT 1 FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2) AND created_at > now() - interval '10 minutes'",
    [kind, email],
  );
  return r.rows.length;
}

Then("an {string} email went to {string}", async function (kind, email) {
  assert.ok((await emailsTo(kind, email)) > 0, `no ${kind} email to ${email}`);
});

// "exactly {int} {string} email went to {string}" is fundraising-touch.steps.js's.

Then("an {string} email went to the events inbox", async function (kind) {
  assert.ok((await emailsTo(kind, EVENTS_INBOX)) > 0, `no ${kind} email to ${EVENTS_INBOX}`);
});

// ---- refunds ----

When("the signed in organiser asks for a refund of the booking of {string} because {string}", async function (email, reason) {
  const o = await orderOf(email);
  const res = await fetch(`${BASE_URL}/api/fundraise/manage/fundraisers/${o.fundraiser_id}/tickets/refund-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `${COOKIE}=${this.frSession}` },
    body: JSON.stringify({ orderId: o.id, reason }),
  });
  this.frStatus = res.status;
  this.frBody = await res.json().catch(() => ({}));
});

When("{string} refunds {int} ticket on the booking of {string}", async function (staff, quantity, email) {
  const o = await orderOf(email);
  // The booking as the admin's screen shows it now: what the refund is checked against.
  const line = (await pool.query("SELECT id, refunded_quantity FROM event_ticket_order_lines WHERE order_id = $1 ORDER BY id LIMIT 1", [o.id])).rows[0];
  const request = (await pool.query("SELECT id FROM event_ticket_refund_requests WHERE order_id = $1 AND status = 'open' LIMIT 1", [o.id])).rows[0];
  this.etRefund = {
    path: `/api/admin/event-tickets/${o.fundraiser_id}/orders/${o.id}/refund`,
    body: { lines: [{ lineId: line.id, quantity, refundedQuantity: line.refunded_quantity }], refundedPence: o.refunded_pence, requestId: request ? request.id : null, note: "bdd" },
  };
  await adminCall(this, staff, "POST", this.etRefund.path, this.etRefund.body);
});

// The same click twice (or a screen left open): the very same request, with the booking as it WAS.
When("{string} sends that same refund again", async function (staff) {
  await adminCall(this, staff, "POST", this.etRefund.path, this.etRefund.body);
});

// A fresh look at the booking, but against the request that has already been refunded.
When("{string} refunds {int} ticket on the booking of {string} against the request already refunded", async function (staff, quantity, email) {
  const o = await orderOf(email);
  const line = (await pool.query("SELECT id, refunded_quantity FROM event_ticket_order_lines WHERE order_id = $1 ORDER BY id LIMIT 1", [o.id])).rows[0];
  const request = (await pool.query("SELECT id FROM event_ticket_refund_requests WHERE order_id = $1 AND status = 'refunded' ORDER BY id DESC LIMIT 1", [o.id])).rows[0];
  assert.ok(request, "no refunded request on that booking");
  await adminCall(this, staff, "POST", `/api/admin/event-tickets/${o.fundraiser_id}/orders/${o.id}/refund`, {
    lines: [{ lineId: line.id, quantity, refundedQuantity: line.refunded_quantity }],
    refundedPence: o.refunded_pence,
    requestId: request.id,
    note: "bdd",
  });
});

Then("exactly {int} refund has been made on the booking of {string}", async function (count, email) {
  const o = await orderOf(email);
  const r = await pool.query("SELECT status FROM event_ticket_refunds WHERE order_id = $1", [o.id]);
  assert.equal(r.rows.filter((x) => x.status === "done").length, count);
  assert.equal(r.rows.filter((x) => x.status === "pending").length, 0, "a refund is still waiting on Stripe");
});

Then("the booking of {string} has {int} pence refunded and {int} ticket left", async function (email, pence, tickets) {
  const o = await orderOf(email);
  assert.equal(o.refunded_pence, pence);
  assert.equal(o.tickets, tickets);
});

Then("the refund asked for on the booking of {string} is {string}", async function (email, status) {
  const o = await orderOf(email);
  const r = await pool.query("SELECT status FROM event_ticket_refund_requests WHERE order_id = $1 ORDER BY id DESC LIMIT 1", [o.id]);
  assert.equal(r.rows[0] && r.rows[0].status, status);
});

When("Stripe reports {int} pence refunded on the payment {string}", async function (pence, paymentIntent) {
  await postSignedWebhook(this, "charge.refunded", { id: `ch_${paymentIntent}`, object: "charge", payment_intent: paymentIntent, amount_refunded: pence });
});

// ---- the guest list and the CSV ----

When("{string} opens the guest list for {string}", async function (staff, title) {
  await adminCall(this, staff, "GET", `/api/admin/event-tickets/${(await eventOf(title)).id}/guest-list`);
});

When("{string} downloads the ticket CSV for {string}", async function (staff, title) {
  await adminCall(this, staff, "GET", `/api/admin/event-tickets/${(await eventOf(title)).id}/orders.csv`);
});

When("the signed in organiser opens the guest list for {string}", async function (title) {
  const res = await fetch(`${BASE_URL}/api/fundraise/manage/fundraisers/${(await eventOf(title)).id}/tickets/guest-list`, {
    headers: { Cookie: `${COOKIE}=${this.frSession}` },
  });
  this.frStatus = res.status;
  this.etText = await res.text();
});

Then("the ticket page shows {string}", function (text) {
  assert.ok((this.etText || "").includes(text), `"${text}" is not on the page`);
});

Then("the ticket page does not show {string}", function (text) {
  assert.ok(!(this.etText || "").includes(text), `"${text}" is on the page`);
});

// ---- two buyers at once, a late payment, and the staff paths (the money review) ----

When("{string} and {string} both try to buy {int} {string} ticket for {string} at the same moment", async function (a, b, quantity, name, title) {
  const one = {};
  const two = {};
  this.etBoth = await Promise.all([buy(one, a, quantity, name, title), buy(two, b, quantity, name, title)]);
});

Then("exactly one of them is given a checkout, and the other is told the tickets have sold out", function () {
  const statuses = this.etBoth.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(this.etBoth));
  const refused = this.etBoth.find((r) => r.status === 409);
  assert.equal(refused.body.error, "Sorry, these tickets have sold out.");
});

Then("only {int} ticket is held or sold for {string}", async function (count, title) {
  const e = await eventOf(title);
  const r = await pool.query(
    `SELECT COALESCE(SUM(l.quantity - l.refunded_quantity), 0)::int AS n FROM event_ticket_order_lines l
       JOIN event_ticket_orders o ON o.id = l.order_id
      WHERE o.fundraiser_id = $1 AND (o.status = 'paid' OR (o.status = 'pending' AND o.hold_expires_at > now()))`,
    [e.id],
  );
  assert.equal(r.rows[0].n, count);
});

Then("the booking of {string} is paid, and flagged as paid late with the event {int} over its limit", async function (email, over) {
  const o = await orderOf(email);
  assert.equal(o.status, "paid");
  const r = await pool.query("SELECT flags FROM event_ticket_orders WHERE id = $1", [o.id]);
  assert.equal(r.rows[0].flags.paidLate && r.rows[0].flags.paidLate.overBy, over, JSON.stringify(r.rows[0].flags));
});

Then("{string} sees the booking of {string} flagged {string}", async function (staff, email, words) {
  const o = await orderOf(email);
  await adminCall(this, staff, "GET", `/api/admin/event-tickets/${o.fundraiser_id}`);
  const shown = (this.frBody.orders || []).find((x) => x.id === o.id);
  assert.ok(shown, "the booking is not on the admin's list");
  assert.deepEqual(shown.flagWords, [words]);
});

Given("an approved event {string} that shares with another cause, with pay on the door", async function (title) {
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, event_date, start_time, venue, town, public, status, booking, card_line,
                              organiser_name, organiser_email, organiser_phone, approved_at, approved_by, updated_by, slug_set_at,
                              shares_with_other, nbcc_share_percent, other_cause_name)
     VALUES ($1, 'event', 'quiz', $2, 'Eight rounds and a raffle.', '2099-11-22', '19:30', 'Example Church Hall', 'Exampleton', true,
             'approved', 'door', 'A quiz for NBCC.', 'Kim Testperson', 'kim.et.fr.bdd@example.com', '07700 900124', now(), 'bdd', 'bdd', now(),
             true, 50, 'Exampleton Food Larder')`,
    [slugFor(title), title],
  );
});

When("{string} changes how people get in to {string} to NBCC selling the tickets", async function (staff, title) {
  await adminCall(this, staff, "PATCH", `/api/admin/fundraisers/${(await eventOf(title)).id}`, { booking: "nbcc" });
});

When("{string} makes {string} share with another cause", async function (staff, title) {
  await adminCall(this, staff, "PUT", `/api/admin/fundraisers/${(await eventOf(title)).id}/split`, {
    sharesWithOther: true,
    nbccSharePercent: 50,
    otherCauseName: "Exampleton Food Larder",
  });
});

When("{string} sets the ticket limit for {string} to {int}", async function (staff, title, limit) {
  await adminCall(this, staff, "PUT", `/api/admin/event-tickets/${(await eventOf(title)).id}/limit`, { limit });
});

// ---- free tickets, and when sales close (Jaimie's answers) ----

Then("the ticket answer sends them straight to the thank you, with no Stripe checkout", function () {
  assert.equal(this.etBody.free, true);
  assert.match(String(this.etBody.url), /^\/event\/[a-z0-9-]+\?tickets=thanks&ticket_session=cs_free_[0-9a-f]{32}$/);
});

When("the signed in organiser cancels the booking of {string}", async function (email) {
  const o = await orderOf(email);
  const res = await fetch(`${BASE_URL}/api/fundraise/manage/fundraisers/${o.fundraiser_id}/tickets/bookings/${o.id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `${COOKIE}=${this.frSession}` },
    body: "{}",
  });
  this.frStatus = res.status;
  this.frBody = await res.json().catch(() => ({}));
});

When("{string} sets ticket sales for {string} to close at {string}", async function (staff, title, when) {
  await adminCall(this, staff, "PUT", `/api/admin/event-tickets/${(await eventOf(title)).id}/close`, { ticketClose: "custom", ticketCloseAt: when });
});

When("{string} sets ticket sales for {string} to close the day before", async function (staff, title) {
  await adminCall(this, staff, "PUT", `/api/admin/event-tickets/${(await eventOf(title)).id}/close`, { ticketClose: "day_before" });
});

// ---- the second money review ----

Given("the closing time chosen for {string} has now passed", async function (title) {
  const e = await eventOf(title);
  await pool.query("UPDATE event_ticket_settings SET sales_close_mode = 'custom', sales_close_at = now() - interval '1 minute' WHERE fundraiser_id = $1", [e.id]);
});

// An admin's refund whose answer from Stripe was lost: the intent is written down (pending, with its
// key), Stripe made the refund, and nothing more happened here.
// Stripe has the refund (the offline stand-in remembers the ones it made), but our side is put back
// to before it was finished: the intent waiting, no money or tickets moved.
Given("the refund on the booking of {string} was never finished here", async function (email) {
  const o = await orderOf(email);
  await pool.query("UPDATE event_ticket_refunds SET status = 'pending', completed_at = NULL, stripe_refund_id = NULL WHERE order_id = $1", [o.id]);
  await pool.query("UPDATE event_ticket_order_lines SET refunded_quantity = 0 WHERE order_id = $1", [o.id]);
  await pool.query("UPDATE event_ticket_orders SET refunded_pence = 0 WHERE id = $1", [o.id]);
});

When("Stripe says a refund of {int} pence changed on the payment {string}", async function (pence, paymentIntent) {
  await postSignedWebhook(this, "refund.updated", {
    id: `re_bdd_${paymentIntent}_${pence}`,
    object: "refund",
    status: "succeeded",
    amount: pence,
    payment_intent: paymentIntent,
    metadata: { product: "event_tickets" },
  });
});

// ---- a refund that failed at the bank: flagged until an admin marks it as sorted ----

Given("a refund on the booking of {string} has failed at the bank", async function (email) {
  const o = await orderOf(email);
  await pool.query(`UPDATE event_ticket_orders SET flags = flags || '{"refundFailed": {"released": false, "overBy": 0}}'::jsonb WHERE id = $1`, [o.id]);
});

When("{string} marks the failed refund on the booking of {string} as sorted", async function (staff, email) {
  const o = await orderOf(email);
  await adminCall(this, staff, "POST", `/api/admin/event-tickets/${o.fundraiser_id}/orders/${o.id}/refund-failed-sorted`, {});
});

async function refundFailedFlag(email) {
  const o = await orderOf(email);
  const r = await pool.query("SELECT flags ? 'refundFailed' AS flagged FROM event_ticket_orders WHERE id = $1", [o.id]);
  return r.rows[0].flagged;
}

Then("the booking of {string} is flagged for a failed refund", async function (email) {
  assert.equal(await refundFailedFlag(email), true);
});

Then("the booking of {string} is not flagged for a failed refund", async function (email) {
  assert.equal(await refundFailedFlag(email), false);
});
