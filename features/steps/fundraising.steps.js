const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const Stripe = require("stripe");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for fundraising.feature (TASK-493). Talks to the public and admin APIs over HTTP like the
// other @db features, arranges fundraisers directly in the database where a scenario only needs one
// to exist, and replays a signed checkout.session.completed built from the checkout's own (stub
// echoed) metadata, the way donation-journey.steps.js does.
//
// Everything made here is marked: fundraisers carry "(bdd-fr)" in their title, staff accounts end
// "fr.bdd@example.com", payment intents start "pi_fr_bdd_", webhook events "evt_fr_bdd_". Each
// scenario starts and ends clean, with the fundraising switch put back OFF, as it ships. Every name
// and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // unused key: generateTestHeaderString is pure HMAC
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MARK = "%(bdd-fr)%";
const STAFF = "%fr.bdd@example.com";
const PASSWORD = "pw-fundraising-bdd";
const EVENTS_INBOX = process.env.BALL_FROM_EMAIL || "events@nbcc.scot";

function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}

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

async function call(world, method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

const adminCall = async (world, email, method, path, body) => call(world, method, path, body, await login(email));

async function fundraiser(title) {
  const r = await pool.query("SELECT id, slug, status FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

async function insertFundraiser({ title, status, targetPence = 50000, email = "organiser.fr.bdd@example.com" }) {
  const r = await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, target_pence, public, status, organiser_name,
                              organiser_email, organiser_phone, approved_at, approved_by, updated_by)
     VALUES ($1, 'raising', 'run_walk', $2, 'A test fundraiser.', $3, true, $4, 'Robin Testperson', $5, '07700 900123',
             CASE WHEN $4 = 'approved' THEN now() END, CASE WHEN $4 = 'approved' THEN 'bdd' END, 'bdd')
     RETURNING id, slug`,
    [slugFor(title), title, targetPence, status, email],
  );
  return r.rows[0];
}

async function setSwitch(on) {
  await pool.query("UPDATE fundraising_settings SET page_on = $1 WHERE id = 1", [on]);
}

async function clean() {
  const { rows } = await pool.query(
    `SELECT id, donor_id FROM donations
      WHERE stripe_payment_intent_id LIKE 'pi_fr_bdd_%'
         OR fundraiser_id IN (SELECT id FROM fundraisers WHERE title LIKE $1)`,
    [MARK],
  );
  const donationIds = rows.map((r) => r.id);
  const donorIds = [...new Set(rows.map((r) => r.donor_id).filter((id) => id != null))];
  if (donationIds.length) await pool.query("DELETE FROM donations WHERE id = ANY($1)", [donationIds]);
  if (donorIds.length) {
    await pool.query("DELETE FROM declarations WHERE donor_id = ANY($1)", [donorIds]);
    await pool.query("DELETE FROM donors WHERE id = ANY($1)", [donorIds]);
  }
  await pool.query("DELETE FROM stripe_webhook_events WHERE id LIKE 'evt_fr_bdd_%'");
  // Edits, manage links and cash go with their fundraiser (ON DELETE CASCADE).
  await pool.query("DELETE FROM fundraisers WHERE title LIKE $1", [MARK]);
  // TASK-501: the private area's codes and sessions, by the organisers' invented addresses.
  await pool.query("DELETE FROM fundraiser_sign_in_codes WHERE email LIKE $1", [STAFF]);
  await pool.query("DELETE FROM fundraiser_sessions WHERE email LIKE $1", [STAFF]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [STAFF]);
  await pool.query("DELETE FROM list_subscribers WHERE email LIKE $1", [STAFF]);
  await setSwitch(false);
}

Before({ tags: "@fundraising" }, clean);
After({ tags: "@fundraising" }, clean);

let seq = 0;
async function postSignedWebhook(type, object) {
  seq += 1;
  const payload = JSON.stringify({ id: `evt_fr_bdd_${Date.now()}_${seq}`, object: "event", type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
}

// ---- arranging ----

Given("fundraising is switched on", async function () {
  await setSwitch(true);
});

Given("fundraising is switched off", async function () {
  await setSwitch(false);
});

Given("a fundraising staff member {string} with role {string}", async function (email, role) {
  await pool.query("INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'Fundraising Staff', $2, $3)", [
    email,
    role,
    hashPassword(PASSWORD),
  ]);
});

Given("an approved fundraiser {string} raising {int} pence", async function (title, target) {
  await insertFundraiser({ title, status: "approved", targetPence: target });
});

Given(
  "an approved fundraiser {string} raising {int} pence, organised by {string}",
  async function (title, target, email) {
    await insertFundraiser({ title, status: "approved", targetPence: target, email });
  },
);

Given("a fundraiser {string} that is still new", async function (title) {
  await insertFundraiser({ title, status: "new" });
});

Given("a fundraiser {string} that is still new, organised by {string}", async function (title, email) {
  await insertFundraiser({ title, status: "new", email });
});

// ---- the public side ----

When(
  "someone signs up {string} to raise {int} pence, to be shown on the website",
  async function (title, target) {
    await signUp(this, title, target, { email: "robin.fr.bdd@example.com", newsletterOk: false });
  },
);

When(
  "someone signs up {string} to raise {int} pence, ticking the newsletter box",
  async function (title, target) {
    await signUp(this, title, target, { name: "Jo Sample", email: "jo.fr.bdd@example.com", newsletterOk: true });
  },
);

Then("{string} is on the newsletter list as a self signup from the fundraising form", async function (email) {
  const r = await pool.query(
    `SELECT s.consent_source, s.unsubscribed_at, s.added_by FROM list_subscribers s JOIN subscriber_lists l ON l.id = s.list_id
      WHERE l.slug = 'newsletter' AND lower(s.email) = lower($1)`,
    [email],
  );
  assert.equal(r.rows.length, 1, `${email} is not on the newsletter list`);
  assert.equal(r.rows[0].consent_source, "fundraise");
  assert.equal(r.rows[0].unsubscribed_at, null);
  assert.equal(r.rows[0].added_by, null);
});

Then("{string} is not on the newsletter list", async function (email) {
  const r = await pool.query("SELECT 1 FROM list_subscribers WHERE lower(email) = lower($1)", [email]);
  assert.equal(r.rows.length, 0);
});

async function signUp(world, title, target, who) {
    await call(world, "POST", "/api/fundraise", {
      path: "raising",
      kind: "santa_dash",
      title,
      description: "Running round the park in a Santa suit.",
      eventDate: "",
      startTime: "",
      venue: "",
      town: "Exampleton",
      targetPence: target,
      public: true,
      name: who.name || "Robin Testperson",
      email: who.email,
      phone: "07700 900123",
      socialLink: "",
      socialOk: false,
      wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false },
      postAddress: "",
      newsletterOk: who.newsletterOk,
      company: "",
    });
}

Then("the fundraising answer is {int}", function (status) {
  assert.equal(this.frStatus, status, `expected ${status}, got ${this.frStatus}: ${JSON.stringify(this.frBody)}`);
});

Then("the fundraiser {string} is stored with status {string}", async function (title, status) {
  assert.equal((await fundraiser(title)).status, status);
});

Then("the organiser of {string} was sent a {string} email", async function (title, kind) {
  const r = await pool.query(
    `SELECT 1 FROM email_log e JOIN fundraisers f ON lower(f.organiser_email) = lower(e.recipient)
      WHERE f.title = $1 AND e.kind = $2 AND e.created_at > now() - interval '10 minutes'`,
    [title, kind],
  );
  assert.ok(r.rows.length > 0, `no ${kind} email to the organiser of ${title}`);
});

// TASK-497: approved while fundraising is off, so nothing yet.
Then("the organiser of {string} was not sent a {string} email", async function (title, kind) {
  const r = await pool.query(
    `SELECT 1 FROM email_log e JOIN fundraisers f ON lower(f.organiser_email) = lower(e.recipient)
      WHERE f.title = $1 AND e.kind = $2 AND e.created_at > now() - interval '10 minutes'`,
    [title, kind],
  );
  assert.equal(r.rows.length, 0, `a ${kind} email went to the organiser of ${title}`);
});

// TASK-497: "Your page is live" goes in the background after the switch on is answered, so wait a
// little for it rather than expecting it the moment the answer comes back.
Then("the organiser of {string} is soon sent a {string} email", { timeout: 15000 }, async function (title, kind) {
  for (let tries = 0; tries < 40; tries += 1) {
    const r = await pool.query(
      `SELECT 1 FROM email_log e JOIN fundraisers f ON lower(f.organiser_email) = lower(e.recipient)
        WHERE f.title = $1 AND e.kind = $2 AND e.created_at > now() - interval '10 minutes'`,
      [title, kind],
    );
    if (r.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`no ${kind} email to the organiser of ${title} within 10 seconds`);
});

Then("{string} is waiting for its live email", async function (title) {
  const r = await pool.query("SELECT live_email_pending FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.equal(r.rows[0].live_email_pending, true);
});

Then("{string} is not waiting for its live email", async function (title) {
  const r = await pool.query("SELECT live_email_pending FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.equal(r.rows[0].live_email_pending, false);
});

Then("a {string} email went to the events inbox about {string}", async function (kind, title) {
  const r = await pool.query(
    `SELECT 1 FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2) AND subject LIKE $3
        AND created_at > now() - interval '10 minutes'`,
    [kind, EVENTS_INBOX, `%${title}%`],
  );
  assert.ok(r.rows.length > 0, `no ${kind} email to ${EVENTS_INBOX} about ${title}`);
});

async function publicList(world) {
  return call(world, "GET", "/api/fundraisers");
}

Then("Get involved lists {string}", async function (title) {
  const body = await publicList(this);
  assert.equal(body.fundraisingOn, true);
  assert.ok(body.fundraisers.some((f) => f.title === title), `${title} is not listed`);
});

Then("Get involved does not list {string}", async function (title) {
  const body = await publicList(this);
  assert.ok(!body.fundraisers.some((f) => f.title === title), `${title} is listed`);
});

Then("Get involved lists no fundraisers and says fundraising is off", async function () {
  const body = await publicList(this);
  assert.deepEqual(body, { fundraisingOn: false, fundraisers: [] });
});

Then("the page for {string} is not found", async function (title) {
  const f = await fundraiser(title);
  await call(this, "GET", `/api/fundraisers/${f.slug}`);
  assert.equal(this.frStatus, 404);
});

Then("the page for {string} shows {int} pence raised of {int}", async function (title, raised, target) {
  const f = await fundraiser(title);
  const body = await call(this, "GET", `/api/fundraisers/${f.slug}`);
  assert.equal(this.frStatus, 200, JSON.stringify(body));
  assert.equal(body.meter.raisedPence, raised);
  assert.equal(body.meter.targetPence, target);
  this.frPage = body;
});

Then("the wall for {string} shows {string} saying {string}", async function (title, name, message) {
  const f = await fundraiser(title);
  const body = await call(this, "GET", `/api/fundraisers/${f.slug}`);
  assert.ok(
    body.wall.some((w) => w.name === name && w.message === message),
    `wall was ${JSON.stringify(body.wall)}`,
  );
});

Then("the wall for {string} shows {string} with no message", async function (title, name) {
  const f = await fundraiser(title);
  const body = await call(this, "GET", `/api/fundraisers/${f.slug}`);
  assert.deepEqual(body.wall.map((w) => [w.name, w.message]), [[name, null]]);
});

When(
  "a supporter gives {int} pence on the page for {string} with the message {string}, showing their name, paid as {string}",
  async function (amount, title, message, paymentIntent) {
    const f = await fundraiser(title);
    const checkout = await call(this, "POST", "/api/checkout-session", {
      mode: "once",
      plan: null,
      amount,
      giftAid: false,
      donorType: "individual",
      fullName: "Alex Example",
      email: "alex.fr.bdd@example.com",
      fundraiserId: f.id,
      supporterMessage: message,
      showName: true,
    });
    assert.equal(this.frStatus, 200, JSON.stringify(checkout));
    assert.ok(checkout.session, "no session echoed from checkout: is the Stripe stub active?");
    const res = await postSignedWebhook("checkout.session.completed", {
      id: checkout.session.id,
      object: "checkout.session",
      metadata: checkout.session.metadata,
      mode: checkout.session.mode,
      amount_total: amount,
      currency: "gbp",
      payment_status: "paid",
      payment_intent: paymentIntent,
      subscription: null,
      customer_details: { name: "Alex Example", email: "alex.fr.bdd@example.com" },
      created: Math.floor(Date.now() / 1000),
    });
    this.frStatus = res.status;
    this.frBody = await res.text();
  },
);

// TASK-501: the organiser pays in what they collected. The session is built as the server builds it
// (buildPayInSessionParams in src/routes/api.ts) and replayed as Stripe's signed webhook.
When("the organiser of {string} pays in {int} pence, paid as {string}", async function (title, amount, paymentIntent) {
  const r = await pool.query("SELECT id, organiser_name, organiser_email FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  const f = r.rows[0];
  assert.ok(f, `no fundraiser called ${title}`);
  const res = await postSignedWebhook("checkout.session.completed", {
    id: `cs_fr_bdd_${paymentIntent}`,
    object: "checkout.session",
    metadata: {
      mode: "once", plan: "", giftAid: "false", feeCoverPence: "0", donorType: "individual", businessName: "",
      fullName: f.organiser_name, email: f.organiser_email, emailConsent: "false", anonymous: "true", ageConfirmed: "false",
      listOnSupporters: "false", creditName: "", fundraiserId: String(f.id), supporterMessage: "", showName: "false",
      showAmount: "false", declarationScope: "this_donation", paidInByOrganiser: "true",
    },
    mode: "payment",
    amount_total: amount,
    currency: "gbp",
    payment_status: "paid",
    payment_intent: paymentIntent,
    subscription: null,
    customer_details: { name: f.organiser_name, email: f.organiser_email },
    created: Math.floor(Date.now() / 1000),
  });
  this.frStatus = res.status;
  this.frBody = await res.text();
});

Then("the donation paid as {string} is marked as paid in by the organiser, with no Gift Aid", async function (paymentIntent) {
  const r = await pool.query(
    "SELECT paid_in_by_organiser, gift_aid, fundraiser_id FROM donations WHERE stripe_payment_intent_id = $1",
    [paymentIntent],
  );
  assert.equal(r.rows.length, 1, "the pay in was not recorded");
  assert.equal(r.rows[0].paid_in_by_organiser, true);
  assert.equal(r.rows[0].gift_aid, false);
  assert.ok(r.rows[0].fundraiser_id, "the pay in is not on the fundraiser");
});

Then("the wall for {string} is empty", async function (title) {
  const f = await fundraiser(title);
  const body = await call(this, "GET", `/api/fundraisers/${f.slug}`);
  assert.deepEqual(body.wall, []);
});

Then("{string} reads the thank you letter list without {string}", async function (staff, email) {
  const body = await adminCall(this, staff, "GET", "/api/admin/thank-you/eligible?threshold=100");
  assert.equal(this.frStatus, 200, JSON.stringify(body));
  assert.ok(!(body.results || []).some((d) => String(d.email || "").toLowerCase() === email.toLowerCase()), `${email} is on the list`);
});

Given("a finished fundraiser {string} raising {int} pence, organised by {string}", async function (title, target, email) {
  await insertFundraiser({ title, status: "finished", targetPence: target, email });
});

Then("the donation paid as {string} belongs to no fundraiser and carries no message", async function (paymentIntent) {
  const r = await pool.query(
    "SELECT fundraiser_id, supporter_message FROM donations WHERE stripe_payment_intent_id = $1",
    [paymentIntent],
  );
  assert.equal(r.rows.length, 1, "the gift was not recorded as a donation");
  assert.equal(r.rows[0].fundraiser_id, null);
  assert.equal(r.rows[0].supporter_message, null);
});

// The private area's steps (TASK-501) are in fundraising-private.steps.js.

// ---- the admin side ----

When("{string} approves {string}", async function (email, title) {
  const f = await fundraiser(title);
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${f.id}/approve`);
});

When("{string} adds {int} pence of cash paid in to {string}", async function (email, amount, title) {
  const f = await fundraiser(title);
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${f.id}/cash`, {
    amountPence: amount,
    paidInOn: new Date().toISOString().slice(0, 10),
    note: "Collection bucket (bdd-fr)",
  });
});

When("{string} hides the message paid as {string} on {string}", async function (email, paymentIntent, title) {
  const f = await fundraiser(title);
  const d = await pool.query("SELECT id FROM donations WHERE stripe_payment_intent_id = $1", [paymentIntent]);
  assert.ok(d.rows[0], "no such gift");
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${f.id}/wall/${d.rows[0].id}/hide`);
});

When("{string} approves the waiting change to {string}", async function (email, title) {
  const f = await fundraiser(title);
  const e = await pool.query("SELECT id FROM fundraiser_edits WHERE fundraiser_id = $1 AND status = 'waiting'", [f.id]);
  assert.ok(e.rows[0], "no change is waiting");
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${f.id}/edits/${e.rows[0].id}/approve`);
});

When("{string} rejects the waiting change to {string}", async function (email, title) {
  const f = await fundraiser(title);
  const e = await pool.query("SELECT id FROM fundraiser_edits WHERE fundraiser_id = $1 AND status = 'waiting'", [f.id]);
  assert.ok(e.rows[0], "no change is waiting");
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${f.id}/edits/${e.rows[0].id}/reject`);
});

Then(
  "the history of {string} records {string} and {string} by {string}",
  async function (title, first, second, email) {
    const f = await fundraiser(title);
    const body = await adminCall(this, email, "GET", `/api/admin/fundraisers/${f.id}/history`);
    for (const action of [first, second]) {
      assert.ok(
        body.history.some((h) => h.action === action && h.actor === `admin:${email}`),
        `${action} by ${email} not in ${JSON.stringify(body.history)}`,
      );
    }
  },
);

When("the fundraising list is read without a session", async function () {
  await call(this, "GET", "/api/admin/fundraisers");
});

When("{string} reads the fundraising list", async function (email) {
  await adminCall(this, email, "GET", "/api/admin/fundraisers");
});

When("{string} switches fundraising on", async function (email) {
  await adminCall(this, email, "PATCH", "/api/admin/fundraising/settings", { pageOn: true });
});

Then("fundraising is on", async function () {
  const r = await pool.query("SELECT page_on FROM fundraising_settings WHERE id = 1");
  assert.equal(r.rows[0].page_on, true);
});

// ---- TASK-499: the event questions ----

When(
  "someone signs up the event {string}, ticketed on another website, to be shown on the website",
  async function (title) {
    await call(this, "POST", "/api/fundraise", {
      path: "event",
      kind: "quiz_party",
      title,
      description: "A quiz night in the village hall, with a raffle at half time.",
      eventDate: "2099-11-21",
      startTime: "19:30",
      venue: "Example Village Hall",
      town: "Exampleton",
      targetPence: null,
      public: true,
      name: "Robin Testperson",
      email: "robin.fr.bdd@example.com",
      phone: "07700 900123",
      socialLink: "",
      socialOk: false,
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, shoutOut: false, attend: false },
      newsletterOk: false,
      cardLine: "Eight rounds and a raffle (bdd-fr).",
      endTime: "22:30",
      timeTbc: false,
      venueAddress: "Main Street, Exampleton",
      venuePostcode: "ka1 1aa",
      access: ["a hearing loop", "step free entry"],
      price: "£5 a head",
      booking: "away",
      ticketUrl: "https://tickets.example.com/bdd-quiz",
      ageLimit: "18 and over",
      dressCode: "",
      included: "",
      creditName: "The BDD Quiz Team",
      company: "",
    });
  },
);

Then("the fundraiser {string} is stored with its event answers", async function (title) {
  const r = await pool.query(
    `SELECT card_line, to_char(end_time, 'HH24:MI') AS end_time, venue_postcode, access, price, booking, ticket_url, credit_name, post_address
       FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1`,
    [title],
  );
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  assert.deepEqual(r.rows[0], {
    card_line: "Eight rounds and a raffle (bdd-fr).",
    end_time: "22:30",
    venue_postcode: "KA1 1AA",
    access: ["step free entry", "a hearing loop"],
    price: "£5 a head",
    booking: "away",
    ticket_url: "https://tickets.example.com/bdd-quiz",
    credit_name: "The BDD Quiz Team",
    post_address: null,
  });
});

Given("an approved event {string} signed up before the event questions", async function (title) {
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, event_date, start_time, venue, town, public, status,
                              organiser_name, organiser_email, organiser_phone, approved_at, approved_by, updated_by)
     VALUES ($1, 'event', 'bake_sale', $2, 'Cakes and coffee.', '2099-11-22', '10:00', 'Example Church Hall', 'Exampleton', true,
             'approved', 'Kim Testperson', 'kim.fr.bdd@example.com', '07700 900124', now(), 'bdd', 'bdd')`,
    [slugFor(title), title],
  );
});

// The one card on the page, from its opening tag to the end of its back.
async function cardOf(world, title) {
  const r = await pool.query("SELECT slug FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  const body = world.visitorBody || "";
  const start = body.indexOf(`id="community-${r.rows[0].slug}"`);
  assert.ok(start !== -1, `no card for ${title} on the page`);
  return body.slice(start, body.indexOf("</article></div></li>", start));
}

Then("the card for {string} shows {string}", async function (title, text) {
  assert.ok((await cardOf(this, title)).includes(text), `"${text}" is not on the card for ${title}`);
});

Then("the card for {string} does not show {string}", async function (title, text) {
  assert.ok(!(await cardOf(this, title)).includes(text), `"${text}" should not be on the card for ${title}`);
});
