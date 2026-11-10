const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for admin-sleigh.feature. Drives /api/admin/sleigh over HTTP against the real database, so the
// card machine window and the re-sort (src/db/sleigh.ts) run in Postgres itself. The staff come from
// the shared @admin steps. Card machine taps are written straight into donations, as the Stripe
// webhook leaves them, under one invented donor and removed again by that donor's address. The nights
// and the switch off day this changes are put back as the migration seeded them.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "sleigh-pw-123";
const DONOR = "tam.sleigh.admin.bdd@example.com";
const SEEDED = {
  "2026-12-15": "New Farm",
  "2026-12-16": "Wardneuk, Onthank & Altonhill",
};

async function reset() {
  await pool.query("DELETE FROM donations WHERE donor_id IN (SELECT id FROM donors WHERE email = $1)", [DONOR]);
  await pool.query("DELETE FROM donors WHERE email = $1", [DONOR]);
  for (const [on, areas] of Object.entries(SEEDED)) {
    await pool.query("UPDATE sleigh_nights SET areas = $2, starts_at = NULL, ends_at = NULL, bucket_pence = 0 WHERE night_on = $1", [on, areas]);
  }
  await pool.query("UPDATE sleigh_settings SET off_on = '2027-01-31' WHERE id = 1");
}
Before({ tags: "@admin-sleigh" }, reset);
After({ tags: "@admin-sleigh" }, reset);
AfterAll(async () => {
  await pool.end();
});

async function donorId() {
  const found = await pool.query("SELECT id FROM donors WHERE email = $1", [DONOR]);
  if (found.rows[0]) return found.rows[0].id;
  const made = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'In-person donor', $1, false) RETURNING id",
    [DONOR],
  );
  return made.rows[0].id;
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

async function send(world, method, path, email, body) {
  const headers = email ? { Authorization: `Bearer ${await login(email)}` } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.slStatus = res.status;
  world.slBody = await res.json().catch(() => ({}));
}

async function nightId(nightOn) {
  const r = await pool.query("SELECT id FROM sleigh_nights WHERE night_on = $1", [nightOn]);
  assert.ok(r.rows[0], `no sleigh night on ${nightOn}`);
  return r.rows[0].id;
}

const saveNight = async (world, email, nightOn, body) => send(world, "PATCH", `/api/admin/sleigh/nights/${await nightId(nightOn)}`, email, body);

When("the Santa Sleigh section is read without a session", async function () {
  await send(this, "GET", "/api/admin/sleigh", null);
});

When("{string} reads the Santa Sleigh section", async function (email) {
  await send(this, "GET", "/api/admin/sleigh", email);
});

Then("the Santa Sleigh answer is {int}", function (status) {
  assert.equal(this.slStatus, status, JSON.stringify(this.slBody));
});

Then("the Santa Sleigh answer says {string}", function (words) {
  assert.equal(this.slBody.error, words);
});

Then("the Santa Sleigh nights are the seven 2026 nights in date order, Timings TBC", function () {
  const nights = this.slBody.nights.filter((n) => n.nightOn.startsWith("2026-12"));
  assert.deepEqual(
    nights.map((n) => [n.nightOn, n.areas]),
    [
      ["2026-12-15", "New Farm"],
      ["2026-12-16", "Wardneuk, Onthank & Altonhill"],
      ["2026-12-17", "Bellfield & Shortlees"],
      ["2026-12-18", "Fardalehill, Margaret Parker, Whisky"],
      ["2026-12-20", "Southcraig & surrounding"],
      ["2026-12-21", "Gargieston & Moorfield"],
      ["2026-12-22", "Caprington & Grange"],
    ],
  );
  for (const n of nights) {
    assert.equal(n.startsAt, null);
    assert.equal(n.endsAt, null);
  }
});

Then("the Santa Sleigh page switches off on {string}", function (day) {
  assert.equal(this.slBody.settings.offOn, day, JSON.stringify(this.slBody.settings));
});

Then("the Santa Sleigh section says they may not change it", function () {
  assert.equal(this.slBody.mayEdit, false);
});

When("{string} saves the areas {string} for the sleigh night of {string}", async function (email, areas, nightOn) {
  await saveNight(this, email, nightOn, { areas });
});

Given("{string} has noted the Santa Sleigh total", async function (email) {
  await send(this, "GET", "/api/admin/sleigh", email);
  assert.equal(this.slStatus, 200, JSON.stringify(this.slBody));
  this.slBefore = this.slBody.totals;
});

When("{string} saves £{float} of bucket cash for the sleigh night of {string}", async function (email, pounds, nightOn) {
  await saveNight(this, email, nightOn, { bucketPence: Math.round(pounds * 100) });
});

Then("the Santa Sleigh bucket cash has gone up by £{float}, and the total with it", function (pounds) {
  const pence = Math.round(pounds * 100);
  assert.equal(this.slBody.totals.bucketPence - this.slBefore.bucketPence, pence, JSON.stringify(this.slBody.totals));
  assert.equal(this.slBody.totals.totalPence - this.slBefore.totalPence, pence, JSON.stringify(this.slBody.totals));
});

When("{string} saves the sleigh night of {string} from {string} to {string}", async function (email, nightOn, startsAt, endsAt) {
  await saveNight(this, email, nightOn, { startsAt, endsAt });
});

When("{string} saves the sleigh night of {string} with its times to be confirmed", async function (email, nightOn) {
  await saveNight(this, email, nightOn, { startsAt: null, endsAt: null });
  assert.equal(this.slStatus, 200, JSON.stringify(this.slBody));
});

Given("a card machine tap of £{int} was stored at {string} UK time on {string}", async function (pounds, at, day) {
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status, payment_channel,
                            refunded_amount_pence, source, created_at)
     VALUES ($1, 'once', $2, false, 'not_eligible', 'paid', 'in_person', 0, NULL, ($3::timestamp AT TIME ZONE 'Europe/London'))`,
    [await donorId(), pounds * 100, `${day} ${at}`],
  );
});

async function sourceOf(pounds) {
  const r = await pool.query("SELECT source FROM donations WHERE donor_id = $1 AND amount_pence = $2", [await donorId(), pounds * 100]);
  assert.equal(r.rows.length, 1, `one £${pounds} tap`);
  return r.rows[0].source;
}

Then("the £{int} tap is a Santa Sleigh gift", async function (pounds) {
  assert.equal(await sourceOf(pounds), "santa_sleigh");
});

Then("the £{int} tap is not a Santa Sleigh gift", async function (pounds) {
  assert.equal(await sourceOf(pounds), null);
});

Then("the sleigh night of {string} shows £{int} from {int} card machine tap(s)", function (nightOn, pounds, taps) {
  const night = this.slBody.nights.find((n) => n.nightOn === nightOn);
  assert.ok(night, JSON.stringify(this.slBody.nights));
  assert.equal(night.cardPence, pounds * 100, JSON.stringify(night));
  assert.equal(night.cardGifts, taps, JSON.stringify(night));
});

When("{string} moves the Santa Sleigh switch off day to {string}", async function (email, offOn) {
  await send(this, "PATCH", "/api/admin/sleigh/settings", email, { offOn });
});
