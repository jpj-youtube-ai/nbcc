const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for newsletter.feature (REQ-069 · TASK-161). Seeds a staff user + logs in through
// POST /api/admin/login to get a real session token, seeds consenting/non-consenting donors, then
// calls the role-gated /api/admin/newsletters endpoints on the running app. Mirrors the pattern in
// features/steps/admin-api.steps.js.
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

Before({ tags: "@newsletter" }, async function () {
  await pool.query("DELETE FROM users WHERE email LIKE '%newsletter.bdd@example.com'");
  await pool.query("DELETE FROM donors WHERE email LIKE '%newsletter.bdd@example.com'");
  // Remove any newsletters a prior run created (subjects are test-specific).
  await pool.query(
    "DELETE FROM newsletters WHERE subject IN ('Winter update','Winter update v2','Send me','Nope')",
  );
});

After({ tags: "@newsletter" }, async function () {
  await pool.query(
    "DELETE FROM newsletters WHERE subject IN ('Winter update','Winter update v2','Send me','Nope')",
  );
});

// Unique phrasing: `an admin user {string} with role {string} and password {string}` is ALREADY
// defined in admin-api.steps.js (it only seeds; it does not log in). Cucumber loads all step files
// globally, so redefining that text is an ambiguous-step error. This step seeds AND logs in, storing
// the token for the newsletter calls.
Given(
  "a newsletter admin {string} with role {string} and password {string}",
  async function (email, role, password) {
    await pool.query(
      "INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4)",
      [email, "Newsletter Tester", role, hashPassword(password)],
    );
    this.token = await login(email, password);
    assert.ok(this.token, "expected a session token");
  },
);

Given("a consenting donor with email {string}", async function (email) {
  await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'Sub', $1, true)",
    [email],
  );
});

Given("a non-consenting donor with email {string}", async function (email) {
  await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'NoSub', $1, false)",
    [email],
  );
});

async function authFetch(path, method, body, token) {
  const opts = { method, headers: { Authorization: "Bearer " + token } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

When(
  "I create a newsletter with subject {string} and body {string}",
  async function (subject, body) {
    const r = await authFetch("/api/admin/newsletters", "POST", { subject, bodyHtml: body }, this.token);
    this.nlStatus = r.status;
    this.nlBody = r.json;
    if (r.json && r.json.id) this.newsletterId = r.json.id;
  },
);

When(
  "I edit that newsletter with subject {string} and body {string}",
  async function (subject, body) {
    const r = await authFetch(
      `/api/admin/newsletters/${this.newsletterId}`,
      "PUT",
      { subject, bodyHtml: body },
      this.token,
    );
    this.nlStatus = r.status;
    this.nlBody = r.json;
  },
);

When("I send that newsletter", async function () {
  const r = await authFetch(`/api/admin/newsletters/${this.newsletterId}/send`, "POST", undefined, this.token);
  this.nlStatus = r.status;
  this.nlBody = r.json;
});

Then("the newsletter response status should be {int}", function (expected) {
  assert.equal(this.nlStatus, expected);
});

Then("the newsletter response field {string} should be {string}", function (field, value) {
  assert.equal(String(this.nlBody[field]), value);
});

Then("the newsletter recipient count should be at least {int}", function (min) {
  assert.ok(this.nlBody.recipientCount >= min, `recipientCount ${this.nlBody.recipientCount} < ${min}`);
});
