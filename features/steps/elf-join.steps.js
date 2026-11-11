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

/** The practice door (year 0, door 0): everything played at it in the four game tables, and its row. */
async function clearPracticeDoor() {
  for (const table of ["elf_guesses", "elf_word_tries", "elf_visits", "elf_photos"]) {
    await pool.query(`DELETE FROM ${table} WHERE year = 0`);
  }
  await pool.query("DELETE FROM elf_practice");
}

// No date bombs: every @elf-school scenario plays in next year's December, so a real door is always
// still to come, with December's doors switched off; the practice door, whose times are absolute, is
// what plays an evening. The row's own year and doors_on are kept in this scenario's world and put back
// after. Plan 1's @elf-doors hooks (elf-admin-doors.steps.js) move the year too and put it back from
// their own variables: cucumber runs Before hooks in the order they are defined and After hooks in the
// reverse order, so the two nest whichever runs first, as long as each puts back only what it kept.
Before({ tags: "@elf-school" }, async function () {
  await cleanUp();
  await clearPracticeDoor();
  const r = await pool.query("SELECT year, doors_on FROM elf_settings WHERE id = 1");
  this.elfSettingsBefore = r.rows[0] ? { year: r.rows[0].year, doorsOn: r.rows[0].doors_on } : null;
  await pool.query("UPDATE elf_settings SET year = $1, doors_on = false WHERE id = 1", [new Date().getFullYear() + 1]);
});
After({ tags: "@elf-school" }, async function () {
  await cleanUp();
  await clearPracticeDoor();
  await pool.query("UPDATE elf_settings SET school_on = false WHERE id = 1");
  const kept = this.elfSettingsBefore;
  if (kept) await pool.query("UPDATE elf_settings SET year = $1, doors_on = $2 WHERE id = 1", [kept.year, kept.doorsOn]);
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

// TASK-613: every enrolment gives the grown up's mobile, as the form asks; `mobile: null` leaves it out.
async function enrol(world, email, names, entryPence, mobile = "07700 900 123") {
  const detectives = names.map((n) => {
    const [firstName, surname] = n.split(" ");
    return { firstName, surname };
  });
  const body = { grownUpName: "Sam Example", email, detectives, entryPence, donationPence: 0, giftAid: false, coverFee: false, newsletter: false, agreed: true };
  if (mobile !== null) body.mobile = mobile;
  const res = await fetch(`${BASE_URL}/api/elf/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  world.elfPending = cookieFrom(res, "nbcc_elf_pending");
  await keep(world, res);
  if (world.elfBody && world.elfBody.session) world.elfSession = world.elfBody.session;
}

When("{string} enrols {string} and {string} paying {int} pence", async function (email, a, b, pence) {
  await enrol(this, email, [a, b], pence);
});

When("{string} enrols {string} paying {int} pence with no mobile number", async function (email, name, pence) {
  await enrol(this, email, [name], pence, null);
});

When("{string} enrols {string} paying {int} pence with the mobile number {string}", async function (email, name, pence, mobile) {
  await enrol(this, email, [name], pence, mobile);
});

Then("no family was saved for {string}", async function (email) {
  const r = await pool.query("SELECT count(*)::int AS n FROM elf_families WHERE email = $1", [email]);
  assert.equal(r.rows[0].n, 0);
});

Then("the family of {string} keeps the mobile number {string}", async function (email, mobile) {
  const r = await pool.query("SELECT mobile FROM elf_families WHERE email = $1", [email]);
  assert.equal(r.rows[0] && r.rows[0].mobile, mobile);
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

When("I save a look for {string} in a costume that is not unlocked yet, with a favourite", async function (first) {
  const id = await detectiveId(first);
  // The Santa suit comes with door 24, and no door has been done yet.
  const look = { sibling: "brother", skin: "s2", hair: "ginger", hairStyle: "bunches", costume: "santa", scene: "ayr", friend: "robin", frame: null, glasses: "specs-gold", bow: null };
  const favourites = [{ ...look, costume: "tree", scene: "loch" }];
  await keep(
    this,
    await fetch(`${BASE_URL}/api/elf/look`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `nbcc_elf_session=${this.elfSignedIn}` },
      body: JSON.stringify({ detectiveId: id, look, tried: [], favourites }),
    }),
  );
  assert.equal(this.elfStatus, 200, this.elfText);
});

Then("the look kept for {string} has no costume, and keeps its scene and friend", async function (first) {
  const r = await pool.query("SELECT look FROM elf_detectives WHERE id = $1", [await detectiveId(first)]);
  for (const kept of [r.rows[0].look, this.elfBody.look]) {
    assert.equal(kept.costume, null);
    assert.equal(kept.scene, "ayr");
    assert.equal(kept.friend, "robin");
    assert.equal(kept.sibling, "brother");
    assert.equal(kept.glasses, "specs-gold");
  }
});

Then("the favourite kept for {string} is made safe too", async function (first) {
  const r = await pool.query("SELECT favourites FROM elf_detectives WHERE id = $1", [await detectiveId(first)]);
  for (const kept of [r.rows[0].favourites, this.elfBody.favourites]) {
    assert.equal(kept.length, 1);
    assert.equal(kept[0].costume, null);
    assert.equal(kept[0].scene, "loch");
  }
});

Given("{string} has already enrolled {string} and paid", async function (email, name) {
  const [firstName, surname] = name.split(" ");
  await enrol(this, email, [`${firstName} ${surname}`], 100);
  await paid(this.elfSession);
});
