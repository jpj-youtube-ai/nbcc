const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for admin-account.feature (Admin Phase 4, TASK-197's My account panel). Reuses the shared
// @admin Before hook (admin-auth.steps.js) that clears '%admin.bdd@example.com' before every
// @admin scenario, plus the "an admin user {string} with password {string}" Given and "the admin
// response status/field" Thens already defined there. This file adds only the two genuinely new
// actions (PATCH /api/admin/me, POST /api/admin/me/password) and an audit_log lookup, mirroring
// login()'s local-helper style used by every other *.steps.js file (each file rebuilds its own
// login() rather than sharing one, per the existing convention).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

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

When(
  "I PATCH my own admin name to {string} as {string} with password {string}",
  async function (fullName, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fullName }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

// {currentPassword} is what's SENT IN THE BODY (may be deliberately wrong); the trailing
// "with password {string}" is what's used to LOG IN (always the account's real password, so the
// caller can reach the endpoint even when testing a wrong current-password rejection).
When(
  "I POST an admin password change with current password {string} and new password {string} as {string} with password {string}",
  async function (currentPassword, newPassword, email, loginPassword) {
    const token = await login(email, loginPassword);
    const res = await fetch(`${BASE_URL}/api/admin/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

Then("an audit_log row for action {string} by actor {string} exists", async function (action, actor) {
  const res = await pool.query(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1 AND actor = $2",
    [action, actor],
  );
  assert.ok(res.rows[0].n > 0, `expected an audit_log row for action "${action}" by actor "${actor}"`);
});
