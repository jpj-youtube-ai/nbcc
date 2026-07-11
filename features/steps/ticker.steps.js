const { Given, When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for ticker.feature (REQ-003 · TASK-178). Seeds a staff user + logs in for a real session
// token, then drives the admin CRUD and the public feed on the running app. Mirrors the newsletter
// steps' seed-and-login pattern; unique step phrasing avoids clashing with the global steps.
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
  if (body.token) return body.token;
  // Admin management Phase 3 (TASK-188): mandatory email 2FA. In this non-production test
  // environment the email client is stubbed, so step 1 returns the code as devCode — complete
  // step 2 here so this helper still yields a real session token for the caller.
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    const body2 = await res2.json().catch(() => ({}));
    return body2.token;
  }
  return undefined;
}

Before({ tags: "@ticker" }, async function () {
  await pool.query(
    "DELETE FROM supporter_ticker WHERE name IN ('Ayrshire Bakery','Troon Toys','Gone Soon Ltd','Not Allowed Co')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE '%ticker.bdd@example.com'");
});

Given(
  "a ticker admin {string} with role {string} and password {string}",
  async function (email, role, password) {
    await pool.query(
      "INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4)",
      [email, "Ticker Tester", role, hashPassword(password)],
    );
    this.tickerTokens = this.tickerTokens || {};
    this.tickerTokens[email] = await login(email, password);
    assert.ok(this.tickerTokens[email], "expected a session token");
  },
);

When("I add the supporter {string} as {string}", async function (name, email) {
  const res = await fetch(`${BASE_URL}/api/admin/ticker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.tickerTokens[email] },
    body: JSON.stringify({ name }),
  });
  this.tickerStatus = res.status;
  const body = await res.json().catch(() => ({}));
  if (body && body.id) this.lastSupporterId = body.id;
});

When("I hide that supporter as {string}", async function (email) {
  const res = await fetch(`${BASE_URL}/api/admin/ticker/${this.lastSupporterId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.tickerTokens[email] },
    body: JSON.stringify({ active: false }),
  });
  this.tickerStatus = res.status;
});

When("I delete that supporter as {string}", async function (email) {
  const res = await fetch(`${BASE_URL}/api/admin/ticker/${this.lastSupporterId}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + this.tickerTokens[email] },
  });
  this.tickerStatus = res.status;
});

Then("the ticker response status should be {int}", function (expected) {
  assert.equal(this.tickerStatus, expected);
});

async function publicFeed() {
  const res = await fetch(`${BASE_URL}/api/supporters/ticker`);
  const body = await res.json().catch(() => ({}));
  return body.supporters || [];
}

Then("the public ticker feed should include {string}", async function (name) {
  const names = await publicFeed();
  assert.ok(names.includes(name), `expected public feed to include ${name}`);
});

Then("the public ticker feed should not include {string}", async function (name) {
  const names = await publicFeed();
  assert.ok(!names.includes(name), `expected public feed NOT to include ${name}`);
});

AfterAll(async function () {
  await pool.end();
});
