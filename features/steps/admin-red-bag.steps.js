const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for admin-red-bag.feature. Drives GET /api/admin/donations/source-totals and
// GET /api/admin/donations over HTTP against the real database. The staff come from the shared
// @admin steps, and the Overview is read with admin-overview.steps.js's own steps (hence its
// password). Gifts are written straight into donations, as the Stripe webhook leaves them, under one
// invented donor and removed again by that donor's address.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "overview-pw-123";
const DONOR = "rowan.redbag.admin.bdd@example.com";

async function reset() {
  await pool.query("DELETE FROM donations WHERE donor_id IN (SELECT id FROM donors WHERE email = $1)", [DONOR]);
  await pool.query("DELETE FROM donors WHERE email = $1", [DONOR]);
}
Before({ tags: "@admin-red-bag" }, reset);
After({ tags: "@admin-red-bag" }, reset);
AfterAll(async () => {
  await pool.end();
});

async function donorId() {
  const found = await pool.query("SELECT id FROM donors WHERE email = $1", [DONOR]);
  if (found.rows[0]) return found.rows[0].id;
  const made = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'Rowan Testperson', $1, false) RETURNING id",
    [DONOR],
  );
  return made.rows[0].id;
}

// One paid gift today. `source` and `channel` are the two columns the totals tell gifts apart by.
async function gift({ pounds, source = null, channel = "online", refunded = 0 }) {
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status,
                            payment_channel, refunded_amount_pence, source)
     VALUES ($1, 'once', $2, false, 'not_eligible', 'paid', $3, $4, $5)`,
    [await donorId(), pounds * 100, channel, refunded * 100, source],
  );
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

async function get(path, email) {
  const headers = email ? { Authorization: `Bearer ${await login(email)}` } : {};
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function readTotals(world, email) {
  const { status, body } = await get("/api/admin/donations/source-totals", email);
  world.rbStatus = status;
  world.rbBody = body;
}

Given("a £{int} Fill a Red Bag gift was made today", async function (pounds) {
  await gift({ pounds, source: "red_bag" });
});

Given("a £{int} gift was made on the Donate page today", async function (pounds) {
  await gift({ pounds });
});

Given("a £{int} gift was taken in person today", async function (pounds) {
  await gift({ pounds, channel: "in_person" });
});

Given("a £{int} Fill a Red Bag gift was made today and refunded in full", async function (pounds) {
  await gift({ pounds, source: "red_bag", refunded: pounds });
});

Given("a £{int} Fill a Red Bag gift was made today, with £{int} of it refunded", async function (pounds, refunded) {
  await gift({ pounds, source: "red_bag", refunded });
});

Given("{string} has noted the Red Bag totals", async function (email) {
  await readTotals(this, email);
  assert.equal(this.rbStatus, 200, JSON.stringify(this.rbBody));
  this.rbBefore = this.rbBody.totals;
});

When("I read the Red Bag totals without a session", async function () {
  await readTotals(this, null);
});

When("{string} reads the Red Bag totals", async function (email) {
  await readTotals(this, email);
});

Then("the Red Bag totals answer is {int}", function (status) {
  assert.equal(this.rbStatus, status, JSON.stringify(this.rbBody));
});

function wentUpBy(world, key, pounds, gifts) {
  for (const span of ["month", "all"]) {
    const now = world.rbBody.totals[key][span];
    const before = world.rbBefore[key][span];
    assert.equal(now.pence - before.pence, pounds * 100, `${key} ${span}: ${JSON.stringify(world.rbBody.totals)}`);
    assert.equal(now.gifts - before.gifts, gifts, `${key} ${span}: ${JSON.stringify(world.rbBody.totals)}`);
  }
}

Then("Fill a Red Bag has gone up by £{int} from {int} gift(s), this month and in all", function (pounds, gifts) {
  wentUpBy(this, "redBag", pounds, gifts);
});

Then("the Donate page has gone up by £{int} from {int} gift(s), this month and in all", function (pounds, gifts) {
  wentUpBy(this, "donatePage", pounds, gifts);
});

Then("the totals say when Fill a Red Bag gifts are counted from", function () {
  assert.equal(this.rbBody.note, "Fill a Red Bag gifts are counted from 5 October 2026.");
  assert.deepEqual(this.rbBody.lines.map((l) => l.name), ["Fill a Red Bag", "Donate page"]);
});

// The newest gifts first, so the ones just made are on the first page.
When("{string} lists donations", async function (email) {
  const { status, body } = await get("/api/admin/donations?limit=100", email);
  assert.equal(status, 200, JSON.stringify(body));
  this.rbList = body.results;
});

When("{string} lists Fill a Red Bag donations only", async function (email) {
  const { status, body } = await get("/api/admin/donations?limit=100&source=red_bag", email);
  assert.equal(status, 200, JSON.stringify(body));
  this.rbList = body.results;
});

async function listed(world, pounds) {
  const id = await donorId();
  const row = world.rbList.find((r) => r.donor_id === id && r.amount_pence === pounds * 100);
  assert.ok(row, `no £${pounds} gift in the list`);
  return row;
}

Then("the £{int} gift is listed as a Fill a Red Bag gift", async function (pounds) {
  assert.equal((await listed(this, pounds)).source, "red_bag");
});

Then("the £{int} gift is listed with no source", async function (pounds) {
  assert.equal((await listed(this, pounds)).source, null);
});

Then("every gift listed is a Fill a Red Bag gift", function () {
  assert.ok(this.rbList.length > 0);
  assert.ok(this.rbList.every((r) => r.source === "red_bag"), JSON.stringify(this.rbList.map((r) => r.source)));
});

// this.ovBody is the Overview's answer, read by admin-overview.steps.js.
Then("the overview says what Fill a Red Bag brought in this month, with a button to {string}", function (button) {
  const line = (this.ovBody.numbers || []).find((n) => n.key === "redBag");
  assert.ok(line, JSON.stringify(this.ovBody));
  assert.equal(line.title, "Fill a Red Bag");
  assert.match(line.headline, /^£[\d,]+ from [\d,]+ gifts? this month$/);
  assert.match(line.detail, /^Donate page: £[\d,]+ from [\d,]+ gifts? this month\.$/);
  assert.equal(line.button, button);
});
