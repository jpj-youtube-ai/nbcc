// NBCC Elf Detective School, wave 1 (features/elf-join.feature). Every family here is invented:
// addresses end ".elf.bdd@example.com" and are cleaned up before and after each scenario.
const { Before, After, Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const Stripe = require("stripe");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
const stripe = new Stripe("sk_test_bdd"); // unused key: generateTestHeaderString is pure HMAC
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function cleanUp() {
  await pool.query("DELETE FROM elf_families WHERE email LIKE '%.elf.bdd@example.com'");
  await pool.query("DELETE FROM elf_sign_in_codes WHERE email LIKE '%.elf.bdd@example.com'");
  await pool.query("DELETE FROM email_log WHERE recipient LIKE '%.elf.bdd@example.com'");
}

Before({ tags: "@elf-school" }, cleanUp);
After({ tags: "@elf-school" }, async () => {
  await cleanUp();
  await pool.query("UPDATE elf_settings SET school_on = false WHERE id = 1");
});

/** A cookie's value from a response's Set-Cookie headers. */
function cookieFrom(res, name) {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  for (const line of all) {
    const m = new RegExp(`(?:^|,\\s*)${name}=([^;]*)`).exec(line);
    if (m) return m[1];
  }
  return null;
}

async function keep(world, res) {
  world.elfStatus = res.status;
  world.elfText = await res.text();
  try {
    world.elfBody = JSON.parse(world.elfText);
  } catch {
    world.elfBody = null;
  }
}

Given("the Elf Detective School is switched {string}", async function (state) {
  await pool.query("INSERT INTO elf_settings (id, school_on) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET school_on = $1", [state === "on"]);
});

When("I request the elf path {string}", async function (path) {
  await keep(this, await fetch(`${BASE_URL}${path}`, { redirect: "manual" }));
});

Then("the elf response status should be {int}", function (status) {
  assert.equal(this.elfStatus, status, this.elfText);
});

Then("the elf response should contain {string}", function (words) {
  assert.ok(this.elfText.includes(words), `expected "${words}" in ${this.elfText.slice(0, 400)}`);
});

async function enrol(world, email, names, entryPence) {
  const detectives = names.map((n) => {
    const [firstName, surname] = n.split(" ");
    return { firstName, surname };
  });
  const res = await fetch(`${BASE_URL}/api/elf/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grownUpName: "Sam Example", email, detectives, entryPence, donationPence: 0, giftAid: false, coverFee: false, newsletter: false, agreed: true }),
  });
  world.elfPending = cookieFrom(res, "nbcc_elf_pending");
  await keep(world, res);
  if (world.elfBody && world.elfBody.session) world.elfSession = world.elfBody.session;
}

When("{string} enrols {string} and {string} paying {int} pence", async function (email, a, b, pence) {
  await enrol(this, email, [a, b], pence);
});

Then("the enrolment is waiting for its payment", async function () {
  assert.ok(this.elfSession && this.elfSession.id, "the stub checkout handed back its session");
  assert.equal(this.elfSession.metadata.product, "elf_school");
  const r = await pool.query("SELECT status FROM elf_orders WHERE stripe_session_id = $1", [this.elfSession.id]);
  assert.equal(r.rows[0] && r.rows[0].status, "pending");
});

async function paid(session) {
  const payload = JSON.stringify({
    id: `evt_elf_${session.id}_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: session.id, object: "checkout.session", metadata: session.metadata, payment_status: "paid", amount_total: 1000, currency: "gbp", created: Math.floor(Date.now() / 1000) } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  assert.equal(res.status, 200, `the webhook answered ${res.status}`);
  // The welcome email goes after the write, best effort: give it a moment.
  await new Promise((r) => setTimeout(r, 300));
}

When("Stripe says the enrolment was paid", async function () {
  await paid(this.elfSession);
});

Then("the enrolment is paid, with a badge for each detective", async function () {
  const o = await pool.query("SELECT status, detective_ids, opened_family FROM elf_orders WHERE stripe_session_id = $1", [this.elfSession.id]);
  assert.equal(o.rows[0].status, "paid");
  assert.equal(o.rows[0].opened_family, true);
  const d = await pool.query("SELECT active, badge_number FROM elf_detectives WHERE id = ANY($1::int[])", [o.rows[0].detective_ids]);
  assert.equal(d.rows.length, 2);
  for (const row of d.rows) {
    assert.equal(row.active, true);
    assert.ok(Number(row.badge_number) > 0);
  }
});

Then("{int} {string} email went to {string}", async function (n, kind, email) {
  const r = await pool.query("SELECT count(*)::int AS n FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2)", [kind, email]);
  assert.equal(r.rows[0].n, n);
});

When("the paying browser comes back from Stripe", async function () {
  const res = await fetch(`${BASE_URL}/elf/welcome?elf_session=${encodeURIComponent(this.elfSession.id)}`, {
    redirect: "manual",
    headers: { Cookie: `nbcc_elf_pending=${this.elfPending}` },
  });
  this.elfSignedIn = cookieFrom(res, "nbcc_elf_session");
  this.elfStatus = res.status;
  this.elfLocation = res.headers.get("location");
});

Then("it is sent to Detective HQ, signed in", function () {
  assert.equal(this.elfStatus, 303);
  assert.equal(this.elfLocation, "/elf/hq");
  assert.ok(this.elfSignedIn, "a session cookie was set");
});

When("I open Detective HQ", async function () {
  await keep(this, await fetch(`${BASE_URL}/elf/hq`, { redirect: "manual", headers: { Cookie: `nbcc_elf_session=${this.elfSignedIn}` } }));
  assert.equal(this.elfStatus, 200, this.elfText.slice(0, 200));
});

async function detectiveId(first) {
  const r = await pool.query(
    "SELECT d.id FROM elf_detectives d JOIN elf_families f ON f.id = d.family_id WHERE f.email LIKE '%.elf.bdd@example.com' AND d.first_name = $1 ORDER BY d.id DESC LIMIT 1",
    [first],
  );
  return r.rows[0].id;
}

When("I save a look for {string} wearing a top that is not earned yet", async function (first) {
  const id = await detectiveId(first);
  const look = {
    skin: "s2",
    hair: "ginger",
    hairStyle: "bunches",
    outfit: null,
    pieces: { hat: ["elf", "red"], face: null, neck: null, top: ["jumper", "red"], feet: ["curly", "maroon"], hand: null, extra: null },
  };
  await keep(
    this,
    await fetch(`${BASE_URL}/api/elf/look`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `nbcc_elf_session=${this.elfSignedIn}` },
      body: JSON.stringify({ detectiveId: id, look, tried: [] }),
    }),
  );
  assert.equal(this.elfStatus, 200, this.elfText);
});

Then("the look kept for {string} has the starter top", async function (first) {
  const r = await pool.query("SELECT look FROM elf_detectives WHERE id = $1", [await detectiveId(first)]);
  assert.deepEqual(r.rows[0].look.pieces.top, ["tunic", "green"]);
  assert.deepEqual(this.elfBody.look.pieces.top, ["tunic", "green"]);
});

Given("{string} has already enrolled {string} and paid", async function (email, name) {
  const [firstName, surname] = name.split(" ");
  await enrol(this, email, [`${firstName} ${surname}`], 100);
  await paid(this.elfSession);
});
