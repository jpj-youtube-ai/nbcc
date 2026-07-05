const { Given, When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const crypto = require("node:crypto");

// Steps for portal.feature (REQ-061). Seeds a donor + a portal_access_tokens row directly (the
// magic-link issue write is unit-tested), then hits GET/PATCH /api/portal/:token on the running app.
// The pool uses the same DATABASE_URL the app writes to; BASE_URL is the app under test.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Fresh start: remove any donors/tokens seeded by a previous run (tokens first — they reference the
// donor, though the FK is ON DELETE CASCADE anyway).
Before({ tags: "@portal" }, async function () {
  const donorFilter =
    "donor_id IN (SELECT id FROM donors WHERE email LIKE '%portal.bdd@example.com')";
  await pool.query(`DELETE FROM portal_access_tokens WHERE ${donorFilter}`);
  // declarations FK to donors is ON DELETE RESTRICT, so clear the donor's declarations first (TASK-103).
  await pool.query(`DELETE FROM declarations WHERE ${donorFilter}`);
  await pool.query(`DELETE FROM donations WHERE ${donorFilter}`);
  await pool.query("DELETE FROM donors WHERE email LIKE '%portal.bdd@example.com'");
});

async function seedDonorWithToken(fullName, email, expiresAt) {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, true) RETURNING id",
    [fullName, email],
  );
  const token = crypto.randomUUID();
  await pool.query(
    "INSERT INTO portal_access_tokens (donor_id, token, expires_at) VALUES ($1, $2, $3)",
    [donor.rows[0].id, token, expiresAt],
  );
  return token;
}

Given(
  "a donor {string} with email {string} and a valid portal token",
  async function (name, email) {
    this.portalToken = await seedDonorWithToken(name, email, new Date(Date.now() + 600000));
  },
);

Given(
  "a donor {string} with email {string} and an expired portal token",
  async function (name, email) {
    this.portalToken = await seedDonorWithToken(name, email, new Date(Date.now() - 1000));
  },
);

When("I GET the donor portal", async function () {
  const res = await fetch(`${BASE_URL}/api/portal/${this.portalToken}`);
  this.portalStatus = res.status;
  this.portalBody = await res.json().catch(() => ({}));
});

When("I PATCH the donor portal:", async function (docString) {
  const res = await fetch(`${BASE_URL}/api/portal/${this.portalToken}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: docString,
  });
  this.portalStatus = res.status;
  this.portalBody = await res.json().catch(() => ({}));
});

When("I POST to cancel the donor subscription:", async function (docString) {
  const res = await fetch(`${BASE_URL}/api/portal/${this.portalToken}/subscription/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: docString,
  });
  this.portalStatus = res.status;
  this.portalBody = await res.json().catch(() => ({}));
});

// Seed an active (revoked_at NULL) Gift Aid declaration for the token's donor (REQ-061 · TASK-103),
// with the minimal NOT NULL columns. The donor is resolved from the seeded token.
Given("the donor has an active Gift Aid declaration", async function () {
  const donor = await pool.query(
    "SELECT donor_id FROM portal_access_tokens WHERE token = $1",
    [this.portalToken],
  );
  this.portalDonorId = donor.rows[0].donor_id;
  const decl = await pool.query(
    `INSERT INTO declarations
       (donor_id, first_name, last_name, house_name_number, address, non_uk, scope,
        wording_version, wording_snapshot, confirmed_taxpayer)
     VALUES ($1, 'Cara', 'Portal', '1', 'Test Street, London', false, 'all_donations',
             'v1', 'I want to Gift Aid my donations.', true)
     RETURNING id`,
    [this.portalDonorId],
  );
  this.declarationId = decl.rows[0].id;
});

When("I POST to cancel the donor's Gift Aid", async function () {
  const res = await fetch(`${BASE_URL}/api/portal/${this.portalToken}/gift-aid/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  this.portalStatus = res.status;
  this.portalBody = await res.json().catch(() => ({}));
});

Then("the donor's active declaration is revoked", async function () {
  const row = await pool.query("SELECT revoked_at FROM declarations WHERE id = $1", [
    this.declarationId,
  ]);
  assert.ok(row.rows[0].revoked_at != null, "expected revoked_at to be set");
});

Then("the portal response status should be {int}", function (code) {
  assert.equal(this.portalStatus, code);
});

Then("the portal response field {string} should be {string}", function (field, value) {
  assert.equal(String(this.portalBody[field]), value);
});

// Seed a subscription donor: a donor row (no stored marketing email needed for the lookup) plus a
// 'monthly' donation whose stripe_subscription_id equals the deterministic stub id for this email
// (Task 2: email e -> "sub_stub_" + e), so the route's Stripe->donor mapping resolves offline.
Given("a subscription donor {string} with email {string}", async function (name, email) {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, true) RETURNING id",
    [name, email],
  );
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, stripe_subscription_id)
     VALUES ($1, 'monthly', 1000, false, 'not_eligible', $2)`,
    [donor.rows[0].id, `sub_stub_${email}`],
  );
});

// Seed a one-off donor: a donor row with a stored email and a one-off donation, NO subscription id
// (REQ-061 revised — reached via the stored donors.email, not Stripe).
Given("a one-off donor {string} with email {string}", async function (name, email) {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, false) RETURNING id",
    [name, email],
  );
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status)
     VALUES ($1, 'once', 2500, false, 'not_eligible')`,
    [donor.rows[0].id],
  );
});

When("I POST a portal access request for {string}", async function (email) {
  const res = await fetch(`${BASE_URL}/api/portal/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  this.portalStatus = res.status;
  this.portalBody = await res.json().catch(() => ({}));
});

Then("a portal token exists for {string}", async function (email) {
  const row = await pool.query(
    `SELECT 1 FROM portal_access_tokens t JOIN donors d ON d.id = t.donor_id WHERE d.email = $1`,
    [email],
  );
  assert.ok(row.rowCount > 0, "expected a portal token for the donor");
});

Then("no portal token exists for {string}", async function (email) {
  const row = await pool.query(
    `SELECT 1 FROM portal_access_tokens t JOIN donors d ON d.id = t.donor_id WHERE d.email = $1`,
    [email],
  );
  assert.equal(row.rowCount, 0, "expected no portal token for an unknown email");
});

AfterAll(async function () {
  await pool.end();
});
