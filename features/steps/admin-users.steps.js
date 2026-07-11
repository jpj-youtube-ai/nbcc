const { Given, When, Then, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync, createHmac } = require("node:crypto");

// Steps for admin-users.feature (admin-management Phase 1, Task 8). Seeds staff users directly (same
// scrypt hash format as src/admin/password.ts, mirroring admin-auth.steps.js), then drives the
// /api/admin/users* + /api/admin/forgot + /api/admin/set-password endpoints on the running app.
// Reuses the shared @admin Before hook (admin-auth.steps.js / admin-api.steps.js) that clears
// '%admin.bdd@example.com' before every @admin scenario — every email in this file uses that same
// suffix so it is cleaned up automatically; no separate Before/After is needed here except the
// last-admin-guard scenario's restore (see below).
//
// Invite/reset tokens are built locally with the same HMAC shape as src/admin/tokens.ts, rather than
// reading the real invite email (the email client is a best-effort, stubbed-outside-production send —
// see src/clients/email.ts — so the BDD constructs the token itself, exactly as it constructs
// password hashes locally instead of importing the compiled TS).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function b64url(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}
function signBody(body, secret) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}
// Mirrors issueAdminActionToken (src/admin/tokens.ts): base64url(claims).base64url(hmacSha256(claims)).
function buildActionToken(sub, purpose, bind, ttlMs) {
  const iat = Date.now();
  const claims = { sub, purpose, bind, iat, exp: iat + (ttlMs ?? 60 * 60 * 1000) };
  const body = b64url(JSON.stringify(claims));
  return `${body}.${signBody(body, ADMIN_SESSION_SECRET)}`;
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

// "an admin user {string} with password {string}" (role admin, status default active) is defined in
// admin-auth.steps.js; "an admin user {string} with role {string} and password {string}" (any role,
// status default active) is defined in admin-api.steps.js. Both are reused here unchanged.

When(
  "I POST an admin invite for {string} named {string} with role {string} as {string} with password {string}",
  async function (email, fullName, role, actorEmail, actorPassword) {
    const token = await login(actorEmail, actorPassword);
    const res = await fetch(`${BASE_URL}/api/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, fullName, role }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
    if (this.adminBody && Number.isInteger(this.adminBody.id)) {
      this.invitedUserId = this.adminBody.id;
    }
  },
);

Then("the admin invite response has a new user id", function () {
  assert.ok(Number.isInteger(this.invitedUserId), "expected the invite response to carry a numeric id");
});

When("I set the invited user's password to {string} using their invite token", async function (password) {
  const token = buildActionToken(this.invitedUserId, "invite", "", 48 * 60 * 60 * 1000);
  const res = await fetch(`${BASE_URL}/api/admin/set-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

When("I POST an admin forgot-password request for {string}", async function (email) {
  const res = await fetch(`${BASE_URL}/api/admin/forgot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

When(
  "I PATCH the admin user {string} status to {string} as {string} with password {string}",
  async function (targetEmail, status, actorEmail, actorPassword) {
    const token = await login(actorEmail, actorPassword);
    const idRes = await pool.query("SELECT id FROM users WHERE email = $1", [targetEmail]);
    const res = await fetch(`${BASE_URL}/api/admin/users/${idRes.rows[0].id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I PATCH the admin user {string} role to {string} as {string} with password {string}",
  async function (targetEmail, role, actorEmail, actorPassword) {
    const token = await login(actorEmail, actorPassword);
    const idRes = await pool.query("SELECT id FROM users WHERE email = $1", [targetEmail]);
    const res = await fetch(`${BASE_URL}/api/admin/users/${idRes.rows[0].id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

// The anti-lockout guard (isLastEnabledAdmin) counts EVERY enabled admin in the table, including the
// real staff accounts seeded by the grant-*-admin migrations - so proving a 409 needs the scenario to
// own the "only enabled admin" condition for its duration. This step snapshots every other currently
// enabled admin, disables them, and the matching After (tagged @admin-last-guard, so it only ever
// runs for this one scenario) restores their original status afterwards.
Given(
  "every other enabled admin is temporarily disabled, leaving only {string}",
  async function (keepEmail) {
    const rows = await pool.query(
      "SELECT id, status FROM users WHERE role = 'admin' AND status <> 'disabled' AND email <> $1",
      [keepEmail],
    );
    this.suspendedAdmins = rows.rows;
    if (this.suspendedAdmins.length) {
      await pool.query("UPDATE users SET status = 'disabled' WHERE id = ANY($1)", [
        this.suspendedAdmins.map((r) => r.id),
      ]);
    }
  },
);

After({ tags: "@admin-last-guard" }, async function () {
  if (this.suspendedAdmins && this.suspendedAdmins.length) {
    for (const row of this.suspendedAdmins) {
      await pool.query("UPDATE users SET status = $1 WHERE id = $2", [row.status, row.id]);
    }
  }
});
