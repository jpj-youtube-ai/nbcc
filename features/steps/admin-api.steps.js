const { Given, When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for admin-api.feature (REQ-062 · TASK-106). Seeds a donor + staff users (each with a scrypt
// password hash, same format as src/admin/password.ts), logs in through POST /api/admin/login to get
// a real session token, then calls the role-gated /api/admin/donors/:id endpoints on the running app.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return body.token;
}

Before({ tags: "@admin" }, async function () {
  await pool.query("DELETE FROM users WHERE email LIKE '%admin.bdd@example.com'");
  await pool.query("DELETE FROM donors WHERE email LIKE '%admin.bdd@example.com'");
});

Given("a donor {string} with email {string}", async function (fullName, email) {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', $1, $2, true) RETURNING id",
    [fullName, email],
  );
  this.adminDonorId = donor.rows[0].id;
});

Given(
  "an admin user {string} with role {string} and password {string}",
  async function (email, role, password) {
    await pool.query(
      "INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'Staff User', $2, $3)",
      [email, role, hashPassword(password)],
    );
  },
);

When("I GET the admin donor without a token", async function () {
  const res = await fetch(`${BASE_URL}/api/admin/donors/${this.adminDonorId}`);
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

When(
  "I GET the admin donor as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/donors/${this.adminDonorId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I PATCH the admin donor full name to {string} as {string} with password {string}",
  async function (fullName, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/donors/${this.adminDonorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fullName }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

// "the admin response status should be {int}" is defined in admin-auth.steps.js (shared @admin).

Then("the admin response field {string} should be {string}", function (field, value) {
  assert.equal(String(this.adminBody[field]), value);
});

AfterAll(async function () {
  await pool.end();
});
