const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");
const Stripe = require("stripe");

// Steps for sponsor-pledges.feature ("Sponsor now, pay after"). The shared fundraising steps (staff,
// switching fundraising on, "the fundraising answer is", the page and its meter, the emails that
// went, signing the organiser in) are in fundraising.steps.js, fundraising-private.steps.js and
// fundraising-touch.steps.js; fundraising.steps.js clears fundraisers (their pledges go with them)
// and the donations paid as "pi_fr_bdd_..." before and after every @fundraising scenario, and
// fundraising-touch.steps.js puts the Automatic emails switch back off and the wording approvals
// back as they ship (the two pledge wordings unapproved) around every @fundraising-touch scenario.
//
// The daily passes run from the compiled app (dist/, built before the BDD step in CI) in this
// process, against the same database, exactly as the 8am task runs them. Paying a pledge posts the
// pay page's own form, takes the session the offline Stripe stub echoes, and replays it as Stripe's
// signed webhook, as giving on a page does. Everything made here is marked like the rest: titles
// carry "(bdd-fr)", addresses end "fr.bdd@example.com". Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "pw-fundraising-bdd";
const COOKIE = "nbcc_fr_session";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const SECRET = process.env.ADMIN_SESSION_SECRET || "ci-admin-session-secret";
const stripe = new Stripe("sk_test_bdd"); // unused key: generateTestHeaderString is pure HMAC
const ORIGIN = new URL(BASE_URL).origin;

// Today in the UK, as the daily pass reads it, and a day so many on (or back).
function ukDayPlus(days) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fundraiser(title) {
  const r = await pool.query("SELECT id, slug FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

async function findPledge(email, title) {
  const f = await fundraiser(title);
  const r = await pool.query("SELECT * FROM sponsor_pledges WHERE fundraiser_id = $1 AND lower(email) = lower($2) ORDER BY id DESC LIMIT 1", [f.id, email]);
  return r.rows[0] || null;
}

// The pledge, remembered on the world so a later step can find it once its email has been removed.
async function pledgeOf(world, email, title) {
  const p = await findPledge(email, title);
  assert.ok(p, `no pledge by ${email} on ${title}`);
  world.pledgeId = p.id;
  return p;
}

async function rememberedPledge(world) {
  assert.ok(world.pledgeId, "no pledge has been looked at yet");
  const r = await pool.query("SELECT * FROM sponsor_pledges WHERE id = $1", [world.pledgeId]);
  assert.ok(r.rows[0], "that pledge is no longer there");
  return r.rows[0];
}

// The signed links the emails carry for this pledge, made exactly as the app makes them.
function tokenFor(pledge, purpose) {
  const { signPledgeToken } = require(path.resolve(__dirname, "../../dist/pledges/token.js"));
  return signPledgeToken(Number(pledge.id), pledge.token_nonce, SECRET, purpose || "pay");
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

async function adminPost(world, email, urlPath) {
  const token = await login(email);
  const res = await fetch(`${BASE_URL}${urlPath}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
}

const form = (fields) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
  body: new URLSearchParams(fields).toString(),
});

// ---- arranging ----

Given("a sponsorship fundraiser {string} in {int} days, organised by {string}", async function (title, days, email) {
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${randomBytes(3).toString("hex")}`;
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, event_date, target_pence, public, status, organiser_name,
                              organiser_email, organiser_phone, approved_at, approved_by, updated_by)
     VALUES ($1, 'raising', 'run_walk', $2, 'A test fundraiser.', $3::date, 50000, true, 'approved', 'Robin Testperson', $4,
             '07700 900123', now() - interval '30 days', 'bdd', 'bdd')`,
    [slug, title, ukDayPlus(days), email],
  );
});

Given("the pledge email wordings are approved", async function () {
  await pool.query(
    "INSERT INTO touch_wording_approvals (key, approved_by) SELECT k, 'bdd' FROM unnest($1::text[]) AS k ON CONFLICT (key) DO NOTHING",
    [["pledge_pay", "pledge_reminder"]],
  );
});

Given("the event for {string} was yesterday", async function (title) {
  await pool.query("UPDATE fundraisers SET event_date = $2::date WHERE id = $1", [(await fundraiser(title)).id, ukDayPlus(-1)]);
});

Given("the event for {string} was {int} days ago, and the pay email to {string} went {int} days ago", async function (title, eventDays, email, sentDays) {
  const f = await fundraiser(title);
  await pool.query("UPDATE fundraisers SET event_date = $2::date WHERE id = $1", [f.id, ukDayPlus(-eventDays)]);
  const p = await pledgeOf(this, email, title);
  await pool.query(
    "UPDATE sponsor_pledges SET pay_email_claimed_at = now() - make_interval(days => $2::int), pay_email_sent_at = now() - make_interval(days => $2::int) WHERE id = $1",
    [p.id, sentDays],
  );
});

Given("the pay email for the pledge by {string} on {string} went {int} days ago", async function (email, title, days) {
  const p = await pledgeOf(this, email, title);
  await pool.query(
    "UPDATE sponsor_pledges SET pay_email_claimed_at = now() - make_interval(days => $2::int), pay_email_sent_at = now() - make_interval(days => $2::int) WHERE id = $1",
    [p.id, days],
  );
});

Given("the pledge by {string} on {string} was made {int} days ago", async function (email, title, days) {
  const p = await pledgeOf(this, email, title);
  await pool.query("UPDATE sponsor_pledges SET created_at = now() - make_interval(days => $2::int) WHERE id = $1", [p.id, days]);
});

// ---- pledging and confirming ----

async function pledgeOnPage(world, email, amount, title) {
  const f = await fundraiser(title);
  const res = await fetch(`${BASE_URL}/api/fundraisers/${f.slug}/pledges`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      amountPence: amount,
      firstName: "Alex",
      surname: "Example",
      email,
      message: "Go on (bdd-fr)",
      showName: true,
      showAmount: true,
      giftAid: true,
      house: "12",
      address: "Example Street, Exampleton",
      postcode: "KA1 1AA",
      nonUk: false,
      company: "",
    }),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
}

async function confirmFromEmail(world, email, title) {
  const p = await pledgeOf(world, email, title);
  const res = await fetch(`${BASE_URL}/pledge/confirm`, form({ t: tokenFor(p, "confirm") }));
  world.frStatus = res.status;
  assert.match(await res.text(), /Your pledge is confirmed/);
}

When("{string} pledges {int} pence with Gift Aid on the page for {string}", async function (email, amount, title) {
  await pledgeOnPage(this, email, amount, title);
});

When("{string} opens the confirm link for their pledge on {string}", async function (email, title) {
  const p = await pledgeOf(this, email, title);
  const res = await fetch(`${BASE_URL}/pledge/confirm?t=${encodeURIComponent(tokenFor(p, "confirm"))}`);
  this.frStatus = res.status;
  assert.match(await res.text(), /Confirm my £10 pledge/);
});

When("{string} confirms their pledge on {string}", async function (email, title) {
  await confirmFromEmail(this, email, title);
});

Given("{string} has pledged {int} pence with Gift Aid on the page for {string}, and confirmed it", async function (email, amount, title) {
  await pledgeOnPage(this, email, amount, title);
  assert.equal(this.frStatus, 201, JSON.stringify(this.frBody));
  await confirmFromEmail(this, email, title);
  assert.equal((await pledgeOf(this, email, title)).status, "open");
});

// ---- the daily task, and staff ----

When("the daily pledge emails run", async function () {
  const { runPledgeEmails } = require(path.resolve(__dirname, "../../dist/pledges/runner.js"));
  this.pledgeRun = await runPledgeEmails(new Date());
});

When("the daily pledge tidy up runs", async function () {
  const { runPledgeRetention } = require(path.resolve(__dirname, "../../dist/pledges/runner.js"));
  this.pledgeTidy = await runPledgeRetention(new Date());
});

When("{string} approves the {string} pledge email wording", async function (email, key) {
  await adminPost(this, email, `/api/admin/fundraising/pledges/approvals/${key}`);
});

When("{string} sends the pay link by hand for the pledge by {string} on {string}", async function (staff, email, title) {
  const p = await pledgeOf(this, email, title);
  await adminPost(this, staff, `/api/admin/pledges/${p.id}/send-pay-link`);
});

// ---- paying ----

// The pay page's own form, as JSON so the offline stub's echo comes back instead of a redirect.
async function startPayment(world, email, title, pounds) {
  const p = await pledgeOf(world, email, title);
  const res = await fetch(`${BASE_URL}/pledge/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: ORIGIN },
    body: JSON.stringify({ t: tokenFor(p), amount: pounds, giftAid: "yes" }),
    redirect: "manual",
  });
  world.frStatus = res.status;
  return res;
}

async function openCheckout(world, email, title) {
  const p = await pledgeOf(world, email, title);
  const res = await startPayment(world, email, title, String(Number(p.amount_pence) / 100));
  const checkout = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, JSON.stringify(checkout));
  assert.ok(checkout.session, "no session echoed from the pay page: is the Stripe stub active?");
  assert.equal(checkout.session.metadata.pledgeId, String(p.id));
  return { session: checkout.session, amount: Number(p.amount_pence) };
}

let seq = 0;
async function paid(world, email, checkout, paymentIntent) {
  seq += 1;
  const payload = JSON.stringify({
    id: `evt_fr_bdd_pledge_${Date.now()}_${seq}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `${checkout.session.id}_${seq}`,
        object: "checkout.session",
        metadata: checkout.session.metadata,
        mode: checkout.session.mode,
        amount_total: checkout.amount,
        currency: "gbp",
        payment_status: "paid",
        payment_intent: paymentIntent,
        subscription: null,
        customer_details: { name: "Alex Example", email },
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

When("{string} pays their pledge on {string} from the pay link, paid as {string}", async function (email, title, paymentIntent) {
  await paid(this, email, await openCheckout(this, email, title), paymentIntent);
});

// Two checkouts opened before either is paid (two tabs), then both paid: what the one checkout at a
// time rule and the webhook's own check are there for.
When(
  "{string} opens two checkouts for their pledge on {string} and both are paid, as {string} and {string}",
  async function (email, title, firstIntent, secondIntent) {
    const one = await openCheckout(this, email, title);
    const two = await openCheckout(this, email, title);
    await paid(this, email, two, firstIntent);
    await paid(this, email, one, secondIntent);
  },
);

When("{string} tries to pay {int} pence for their pledge on {string}", async function (email, pence, title) {
  await startPayment(this, email, title, String(pence / 100));
});

Then("{string} cannot start another payment for that pledge", async function (email) {
  const p = await rememberedPledge(this);
  const res = await fetch(`${BASE_URL}/pledge/pay`, form({ t: tokenFor(p), amount: "10" }));
  const text = await res.text();
  assert.match(text, /Your pledge is paid/, `expected the paid notice for ${email}`);
  assert.doesNotMatch(text, /checkout\.stripe\.com/);
});

// ---- cancelling ----

When("{string} opens the cancel link for their pledge on {string}", async function (email, title) {
  const p = await pledgeOf(this, email, title);
  const res = await fetch(`${BASE_URL}/pledge/cancel?t=${encodeURIComponent(tokenFor(p))}`);
  this.frStatus = res.status;
  assert.match(await res.text(), /Cancel my £10 pledge/);
});

When("{string} confirms they cannot pay their pledge on {string}", async function (email, title) {
  const p = await pledgeOf(this, email, title);
  const res = await fetch(`${BASE_URL}/pledge/cancel`, form({ t: tokenFor(p) }));
  this.frStatus = res.status;
  assert.match(await res.text(), /Your pledge is cancelled/);
});

// ---- the organiser ----

async function organiserCall(world, method, urlPath, body) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN };
  if (world.frSession) headers.Cookie = `${COOKIE}=${world.frSession}`;
  const res = await fetch(`${BASE_URL}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

When("the signed in organiser reads the pledges for {string}", async function (title) {
  const f = await fundraiser(title);
  const body = await organiserCall(this, "GET", "/api/fundraise/manage/pledges");
  this.pledgeList = (body.fundraisers || []).find((x) => x.id === f.id);
  this.pledgeListText = JSON.stringify(body);
  if (this.pledgeList && this.pledgeList.pledges[0]) this.pledgeId = this.pledgeList.pledges[0].id;
});

When("the signed in organiser marks that pledge on {string} as paid in cash", async function (title) {
  const f = await fundraiser(title);
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${f.id}/pledges/${this.pledgeId}/cash`, { paid: true });
});

When("the signed in organiser says that pledge on {string} was not paid in cash after all", async function (title) {
  const f = await fundraiser(title);
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${f.id}/pledges/${this.pledgeId}/cash`, { paid: false });
});

When("the signed in organiser hides that pledge on {string} from their page", async function (title) {
  const f = await fundraiser(title);
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${f.id}/pledges/${this.pledgeId}/hide`, { hidden: true });
});

// ---- checking ----

Then("the pledge by {string} on {string} is {string}", async function (email, title, status) {
  assert.equal((await pledgeOf(this, email, title)).status, status);
});

Then("there is no pledge by {string} on {string}", async function (email, title) {
  assert.equal(await findPledge(email, title), null);
});

Then("the pledge by {string} on {string} is {string}, with its Gift Aid declaration kept", async function (email, title, status) {
  const p = await pledgeOf(this, email, title);
  assert.equal(p.status, status);
  assert.equal(p.gift_aid, true);
  assert.equal(p.ga_wording_version, "nbcc-pledge-single-2026-10");
  assert.match(p.ga_wording_snapshot, /^I want to Gift Aid my donation of £10 when I pay it, to the Night Before Christmas Campaign\. /);
  assert.match(p.ga_wording_snapshot, /it is my responsibility to pay any difference\.$/);
  assert.ok(p.ga_declared_at, "the declaration has no date");
  assert.equal(p.ga_postcode, "KA1 1AA");
});

Then("the page for {string} does not show {string}", async function (title, words) {
  const f = await fundraiser(title);
  const res = await fetch(`${BASE_URL}/fundraise/${f.slug}`);
  assert.equal(res.status, 200);
  assert.ok(!(await res.text()).includes(words), `the page shows "${words}"`);
});

Then("that pledge is {string}, keeps its {int} pence, and has no name, email, message or address", async function (status, pence) {
  const p = await rememberedPledge(this);
  assert.equal(p.status, status);
  assert.equal(Number(p.amount_pence), pence);
  for (const col of ["first_name", "surname", "email", "message", "ga_house", "ga_address", "ga_postcode"]) assert.equal(p[col], null, col);
  assert.ok(p.anonymised_at, "it has no anonymised date");
});

Then("that pledge has no home address", async function () {
  const p = await rememberedPledge(this);
  for (const col of ["ga_house", "ga_address", "ga_postcode"]) assert.equal(p[col], null, col);
});

Then("that pledge is flagged as paid twice", async function () {
  const p = await rememberedPledge(this);
  assert.ok(p.double_paid_at, "it is not flagged as paid twice");
  assert.equal(p.double_paid_checked_at, null);
  const a = await pool.query("SELECT 1 FROM audit_log WHERE entity = 'sponsor_pledge' AND entity_id = $1 AND action = 'pledge.paid_again'", [p.id]);
  assert.equal(a.rows.length, 1, "no History row for the second payment");
});

Then("the donation paid as {string} has no Gift Aid and no declaration", async function (paymentIntent) {
  const r = await pool.query("SELECT gift_aid, declaration_id, fundraiser_id FROM donations WHERE stripe_payment_intent_id = $1", [paymentIntent]);
  assert.ok(r.rows[0], `no donation paid as ${paymentIntent}`);
  assert.equal(r.rows[0].gift_aid, false);
  assert.equal(r.rows[0].declaration_id, null);
  // It is still money on the page, for staff to refund.
  assert.ok(r.rows[0].fundraiser_id);
});

Then(
  "the donation paid as {string} is on {string} with Gift Aid, claimable, under the declaration made with the pledge",
  async function (paymentIntent, title) {
    const f = await fundraiser(title);
    const r = await pool.query(
      `SELECT d.id, d.fundraiser_id, d.amount_pence, d.gift_aid, d.claim_status, d.payment_status, d.declaration_id,
              dc.wording_version, dc.wording_snapshot, dc.postcode, dc.scope
         FROM donations d LEFT JOIN declarations dc ON dc.id = d.declaration_id
        WHERE d.stripe_payment_intent_id = $1`,
      [paymentIntent],
    );
    const d = r.rows[0];
    assert.ok(d, `no donation paid as ${paymentIntent}`);
    assert.equal(Number(d.fundraiser_id), Number(f.id));
    assert.equal(Number(d.amount_pence), 1000);
    assert.equal(d.gift_aid, true);
    assert.equal(d.payment_status, "paid");
    assert.equal(d.claim_status, "eligible");
    assert.equal(d.wording_version, "nbcc-pledge-single-2026-10");
    assert.match(d.wording_snapshot, /^I want to Gift Aid my donation of £10 when I pay it/);
    assert.equal(d.postcode, "KA1 1AA");
    assert.equal(d.scope, "this_donation");
    // The pledge points at that donation and declaration, and has dropped the address (the
    // declaration has it now).
    const p = await pool.query("SELECT * FROM sponsor_pledges WHERE donation_id = $1", [d.id]);
    assert.equal(p.rows.length, 1);
    assert.equal(Number(p.rows[0].declaration_id), Number(d.declaration_id));
    assert.equal(Number(p.rows[0].paid_amount_pence), 1000);
    assert.equal(p.rows[0].ga_address, null);
    // When the declaration was made is kept beside the donation, where deleting the pledge cannot
    // reach it: made with the pledge, before the payment.
    const kept = await pool.query("SELECT * FROM sponsor_pledge_declarations WHERE donation_id = $1", [d.id]);
    assert.equal(kept.rows.length, 1, "the declaration's date was not kept");
    assert.equal(Number(kept.rows[0].declaration_id), Number(d.declaration_id));
    assert.equal(Number(kept.rows[0].pledge_id), Number(p.rows[0].id));
    assert.ok(new Date(kept.rows[0].declared_at) <= new Date(p.rows[0].paid_at));
    assert.equal(new Date(kept.rows[0].declared_at).getTime(), new Date(p.rows[0].ga_declared_at).getTime());
    const a = await pool.query("SELECT data FROM audit_log WHERE entity = 'sponsor_pledge' AND entity_id = $1 AND action = 'pledge.paid'", [p.rows[0].id]);
    assert.equal(a.rows.length, 1, "no History row for the pledge being paid");
    assert.ok(a.rows[0].data.giftAidDeclaredAt, "History does not keep when the declaration was made");
  },
);

Then("the organiser sees {int} pledge of {int} pence by {string}, and no email address", function (count, pence, name) {
  assert.ok(this.pledgeList, "the private area does not list that fundraiser's pledges");
  // Only confirmed pledges: the second sponsor never confirmed theirs.
  assert.equal(this.pledgeList.pledges.length, count);
  assert.equal(this.pledgeList.pledges[0].name, name);
  assert.equal(this.pledgeList.pledges[0].amountPence, pence);
  assert.equal(this.pledgeList.totals.pledgedPence, pence);
  assert.equal(this.pledgeList.totals.paidPence, 0);
  assert.doesNotMatch(this.pledgeListText, /@/);
  assert.doesNotMatch(this.pledgeListText, /Example Street/);
});
