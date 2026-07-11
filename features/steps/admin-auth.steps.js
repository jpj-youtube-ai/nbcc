const { Given, When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for admin-auth.feature (REQ-062). Seeds a users row directly with a scrypt password hash
// (same `scrypt$saltHex$keyHex` format as src/admin/password.ts), then hits POST /api/admin/login on
// the running app. The pool uses the same DATABASE_URL the app reads; BASE_URL is the app under test.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Produce the storable scrypt hash for a password, matching src/admin/password.ts (KEY_LEN 64).
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Fresh start: remove any admin users seeded by a previous run.
Before({ tags: "@admin" }, async function () {
  await pool.query("DELETE FROM users WHERE email LIKE '%admin.bdd@example.com'");
});

Given("an admin user {string} with password {string}", async function (email, password) {
  await pool.query(
    "INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'Kenny Admin', 'admin', $2)",
    [email, hashPassword(password)],
  );
});

When(
  "I POST to admin login with email {string} and password {string}",
  async function (email, password) {
    const res = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
    // Admin management Phase 3 (TASK-188): stash a mandatory-2FA devCode separately from
    // adminBody, which a later step-2 attempt (e.g. a deliberate wrong code) will overwrite —
    // admin-2fa.steps.js reads this stable field instead of adminBody.devCode so "the code from
    // the login response" step still works after an intervening wrong-code attempt.
    if (typeof this.adminBody.devCode === "string") {
      this.adminLoginDevCode = this.adminBody.devCode;
    }
  },
);

Then("the admin response status should be {int}", function (code) {
  assert.equal(this.adminStatus, code);
});

Then("the admin response has a session token", function () {
  assert.ok(this.adminBody.token && this.adminBody.token.length > 0, "expected a session token");
});

Then("the admin response has no session token", function () {
  assert.ok(!this.adminBody.token, "expected no session token");
});

AfterAll(async function () {
  await pool.end();
});
