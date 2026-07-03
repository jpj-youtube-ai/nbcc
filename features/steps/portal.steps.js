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
  await pool.query(
    "DELETE FROM portal_access_tokens WHERE donor_id IN (SELECT id FROM donors WHERE email LIKE '%portal.bdd@example.com')",
  );
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

Then("the portal response status should be {int}", function (code) {
  assert.equal(this.portalStatus, code);
});

Then("the portal response field {string} should be {string}", function (field, value) {
  assert.equal(String(this.portalBody[field]), value);
});

AfterAll(async function () {
  await pool.end();
});
