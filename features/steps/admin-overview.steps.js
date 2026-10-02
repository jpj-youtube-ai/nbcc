const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");

// Steps for admin-overview.feature (TASK-508). Drives GET /api/admin/overview over HTTP against the
// real database. The staff come from the shared @admin steps (addresses ending admin.bdd@example.com,
// which the @admin hooks remove). The sign up is written straight into fundraisers, as the public form
// leaves it, and removed again by its organiser's invented address.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "overview-pw-123";
const ORGANISER = "ola.overview.fr.bdd@example.com";

// TASK-509: the invented donor behind the money scenario (the @admin hooks clear it before, too).
const DONOR = "dee.overview.admin.bdd@example.com";

async function reset() {
  await pool.query("DELETE FROM donations WHERE donor_id IN (SELECT id FROM donors WHERE email = $1)", [DONOR]);
  await pool.query("DELETE FROM donors WHERE email = $1", [DONOR]);
  await pool.query("DELETE FROM fundraisers WHERE organiser_email = $1", [ORGANISER]);
}

async function donorId() {
  const found = await pool.query("SELECT id FROM donors WHERE email = $1", [DONOR]);
  if (found.rows[0]) return found.rows[0].id;
  const made = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'Dee Testperson', $1, false) RETURNING id",
    [DONOR],
  );
  return made.rows[0].id;
}
Before({ tags: "@admin-overview" }, reset);
After({ tags: "@admin-overview" }, reset);
AfterAll(async () => {
  await pool.end();
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

async function read(world, email) {
  const headers = email ? { Authorization: `Bearer ${await login(email)}` } : {};
  const res = await fetch(`${BASE_URL}/api/admin/overview`, { headers });
  world.ovStatus = res.status;
  world.ovBody = await res.json().catch(() => ({}));
}

// A stored map is a complete statement of access: the contact form, and nothing else.
Given("{string} can see only the contact form", async function (email) {
  await pool.query("UPDATE users SET permissions = $2::jsonb WHERE email = $1", [email, JSON.stringify({ contact: "view" })]);
});

Given("a new fundraising sign up {string} waiting for approval", async function (title) {
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${randomBytes(3).toString("hex")}`;
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, target_pence, public, status, organiser_name,
                              organiser_email, organiser_phone, wants, post_line1, post_town, post_postcode,
                              event_date, updated_by)
     VALUES ($1, 'raising', 'bake_sale', $2, 'A test fundraiser.', 50000, true, 'new', 'Ola Testperson',
             $3, '07700 900123', '{}'::jsonb, '1 Example Road', 'Exampleton', 'KA1 1AA',
             (now() AT TIME ZONE 'Europe/London')::date + 30, 'bdd')`,
    [slug, title, ORGANISER],
  );
});

// TASK-509: cash on the sign up just made (its organiser's address finds it); removed with it.
Given("£{float} in cash was paid in for it today", async function (pounds) {
  await pool.query(
    `INSERT INTO fundraiser_cash (fundraiser_id, amount_pence, paid_in_on, note, created_by)
     SELECT id, $2, (now() AT TIME ZONE 'Europe/London')::date, 'Bucket', 'bdd'
       FROM fundraisers WHERE organiser_email = $1 ORDER BY id DESC LIMIT 1`,
    [ORGANISER, Math.round(pounds * 100)],
  );
});

When("I read the overview without a session", async function () {
  await read(this, null);
});

When("{string} reads the overview", async function (email) {
  await read(this, email);
});

Then("the overview answer is {int}", function (status) {
  assert.equal(this.ovStatus, status, JSON.stringify(this.ovBody));
});

Then("it says fundraising sign ups are waiting, with a button to {string}", function (button) {
  const line = (this.ovBody.needs || []).find((n) => n.key === "fundraisingNew");
  assert.ok(line, JSON.stringify(this.ovBody));
  assert.match(line.text, /^\d+ fundraising sign ups? (is|are) waiting for approval$/);
  assert.equal(line.button, button);
  assert.equal(line.view, "fundraising");
  assert.deepEqual(this.ovBody.failed, []);
});

// A real answer, checked in full (not an empty one that would pass by accident), with nothing from a
// screen this person cannot open: their only access is the contact form.
Then("it says nothing about Fundraising", function () {
  assert.ok(Array.isArray(this.ovBody.needs), JSON.stringify(this.ovBody));
  assert.deepEqual(this.ovBody.failed, []);
  assert.ok(this.ovBody.updatedAt, "the answer says when it was read");
  const others = this.ovBody.needs.filter((n) => n.view !== "contact");
  assert.deepEqual(others, [], JSON.stringify(this.ovBody));
});

// TASK-509: the numbers. Other scenarios may leave money of their own, so totals are "at least".
const number = (world, key) => (world.ovBody.numbers || []).find((n) => n.key === key);

Then("every number could be checked", function () {
  assert.deepEqual(this.ovBody.failed, [], JSON.stringify(this.ovBody));
  assert.ok(Array.isArray(this.ovBody.numbers), JSON.stringify(this.ovBody));
});

Then("this month's money from fundraising pages is at least £{int}", function (pounds) {
  const money = number(this, "money");
  assert.ok(money, JSON.stringify(this.ovBody));
  const m = /fundraising pages £([\d,]+)\./.exec(money.detail);
  assert.ok(m, money.detail);
  assert.ok(Number(m[1].replace(/,/g, "")) >= pounds, money.detail);
  assert.match(money.headline, /^£[\d,]+ this month so far$/);
});

Then("it says how the Festive Ball and the monthly givers are doing", function () {
  assert.match(number(this, "ball")?.headline || "", /^[\d,]+ of [\d,]+ seats sold$/, JSON.stringify(this.ovBody));
  assert.match(number(this, "monthly")?.headline || "", /^[\d,]+ (person gives|people give) £[\d,]+ a month$/, JSON.stringify(this.ovBody));
});

// The three figures the money scenario watches, in whole pounds, read from the Money in line.
function moneyFigures(body) {
  const money = (body.numbers || []).find((n) => n.key === "money");
  assert.ok(money, JSON.stringify(body));
  const grab = (re) => {
    const m = re.exec(money.detail);
    assert.ok(m, `${re} in "${money.detail}"`);
    return Number(m[1].replace(/,/g, ""));
  };
  return {
    donations: grab(/Donations £([\d,]+)/),
    pages: grab(/fundraising pages £([\d,]+)\./),
    lastMonth: grab(/^£([\d,]+) by this time last month\./),
  };
}

Given("{string} has noted the overview's money", async function (email) {
  await read(this, email);
  assert.deepEqual(this.ovBody.failed, [], JSON.stringify(this.ovBody));
  this.ovMoneyBefore = moneyFigures(this.ovBody);
});

Given("a £{int} gift was made on its page today, with £{int} of it refunded", async function (gift, refunded) {
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, refunded_amount_pence, gift_aid, claim_status, payment_status, fundraiser_id)
     SELECT $1, 'once', $2, $3, false, 'not_eligible', 'paid', id
       FROM fundraisers WHERE organiser_email = $4 ORDER BY id DESC LIMIT 1`,
    [await donorId(), gift * 100, refunded * 100, ORGANISER],
  );
});

// UK midnight on the 1st of last month: the first moment of last month, before any "same time".
Given("a £{int} donation was made at the very start of last month", async function (pounds) {
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status, created_at)
     VALUES ($1, 'once', $2, false, 'not_eligible', 'paid',
             (date_trunc('month', now() AT TIME ZONE 'Europe/London') - interval '1 month') AT TIME ZONE 'Europe/London')`,
    [await donorId(), pounds * 100],
  );
});

Then("this month's money from fundraising pages has gone up by £{int}", function (pounds) {
  assert.equal(moneyFigures(this.ovBody).pages - this.ovMoneyBefore.pages, pounds, JSON.stringify(this.ovBody));
});

Then("this month's donations have not changed", function () {
  assert.equal(moneyFigures(this.ovBody).donations, this.ovMoneyBefore.donations, JSON.stringify(this.ovBody));
});

Then("last month's money has gone up by £{int}", function (pounds) {
  assert.equal(moneyFigures(this.ovBody).lastMonth - this.ovMoneyBefore.lastMonth, pounds, JSON.stringify(this.ovBody));
});

Then("it shows no numbers", function () {
  assert.deepEqual(this.ovBody.numbers, [], JSON.stringify(this.ovBody));
  assert.deepEqual(this.ovBody.failed, []);
});
