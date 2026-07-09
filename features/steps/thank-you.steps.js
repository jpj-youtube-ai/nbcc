const { Given, When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert");
const { Pool } = require("pg");

// TASK-162 (REQ-069): BDD for GET /api/admin/thank-you/eligible. Seeds donors +
// paid donations directly, logs in for a real admin session token, and asserts
// the JSON. The admin-user seeding + status steps are reused from admin-api /
// admin-auth (global step definitions).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return body.token;
}

Before({ tags: "@thankyou" }, async function () {
  // FK-safe order: donations RESTRICT-reference donors, so clear them first;
  // thank_you_sent SET-NULLs on donor delete but is cleared to avoid carryover.
  await pool.query("DELETE FROM thank_you_sent");
  await pool.query("DELETE FROM donations");
  await pool.query("DELETE FROM donors");
  await pool.query("DELETE FROM users");
  this.tyDonorIds = {};
});

async function seedDonor(world, name, email, emailConsent, giftPence) {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, $3) RETURNING id",
    [name, email, emailConsent],
  );
  const id = donor.rows[0].id;
  world.tyDonorIds[name] = id;
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status)
     VALUES ($1, 'once', $2, false, 'not_eligible', 'paid')`,
    [id, giftPence],
  );
  return id;
}

function emailFor(name) {
  return name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com";
}

Given("a donor named {string} who gave a single paid gift of {int} pence", async function (name, pence) {
  await seedDonor(this, name, emailFor(name), true, pence);
});

Given(
  "a donor named {string} with no email who gave a single paid gift of {int} pence",
  async function (name, pence) {
    await seedDonor(this, name, null, false, pence);
  },
);

Given(
  "a donor named {string} who opted out of email gave a single paid gift of {int} pence",
  async function (name, pence) {
    await seedDonor(this, name, emailFor(name), false, pence);
  },
);

Given("the donor {string} has already been thanked", async function (name) {
  const id = this.tyDonorIds[name];
  await pool.query(
    `INSERT INTO thank_you_sent
       (donor_id, thank_you_name, addressed_to, recipient_email, gift_type,
        gift_amount_pence, gift_aided, signed_by_name, sent_by)
     VALUES ($1, $2, $2, 'x@example.com', 'money', 200000, false, 'Jodie McFarlane', 'jon@nbcc.scot')`,
    [id, name],
  );
});

When(
  "I list thank-you eligible donors over {int} pence as {string} with password {string}",
  async function (threshold, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/thank-you/eligible?threshold=${threshold}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When("I list thank-you eligible donors over {int} pence with no token", async function (threshold) {
  const res = await fetch(`${BASE_URL}/api/admin/thank-you/eligible?threshold=${threshold}`);
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

function findByName(world, name) {
  return (world.adminBody.results || []).find((r) => r.name === name);
}

Then("the thank-you eligible results should include {string}", function (name) {
  assert.ok(findByName(this, name), `expected results to include ${name}`);
});

Then("the thank-you eligible results should not include {string}", function (name) {
  assert.ok(!findByName(this, name), `expected results NOT to include ${name}`);
});

Then("the thank-you eligible donor {string} should have send-state {string}", function (name, state) {
  const r = findByName(this, name);
  assert.ok(r, `expected results to include ${name}`);
  assert.equal(r.sendState, state);
});

Then("the thank-you eligible donor {string} should be marked already thanked", function (name) {
  const r = findByName(this, name);
  assert.ok(r, `expected results to include ${name}`);
  assert.equal(r.alreadyThanked, true);
});

AfterAll(async function () {
  await pool.end();
});
