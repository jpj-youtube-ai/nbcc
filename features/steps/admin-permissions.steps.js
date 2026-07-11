const { Given, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for admin-permissions.feature (admin-management Phase 2, Task 7). Reuses the shared @admin
// Before hook (admin-auth.steps.js) that clears '%admin.bdd@example.com' before every @admin
// scenario, the donor cleanup in admin-api.steps.js's @admin Before, and the login/step helpers
// already defined for Phase 1 (admin-users.steps.js) and the donor/story routes (admin-api.steps.js
// / admin-stories.steps.js) — this file only adds the steps that are genuinely new: seeding a user
// with an explicit per-section permission matrix (rather than a role default) and driving
// PATCH /api/admin/users/:id/permissions.
//
// The 13 sections mirror SECTIONS in src/admin/permissions.ts. Kept as a local literal (not
// imported) for the same reason admin-users.steps.js rebuilds the action-token shape locally
// instead of importing the compiled TS.
const SECTIONS = [
  "overview",
  "search",
  "donations",
  "claims",
  "gasds",
  "subscriptions",
  "stories",
  "ticker",
  "contact",
  "newsletter",
  "thank-you",
  "audit",
  "team",
];

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

// Builds a complete 13-section matrix with every section "none" except the one given, e.g.
// "stories:view" -> { overview: "none", ..., stories: "view", ..., team: "none" }.
function matrixWithOnly(sectionLevel) {
  const [section, level] = sectionLevel.split(":");
  if (!SECTIONS.includes(section)) {
    throw new Error(`unknown section "${section}" in "${sectionLevel}"`);
  }
  const matrix = {};
  for (const s of SECTIONS) matrix[s] = s === section ? level : "none";
  return matrix;
}

// Seeds a staff user directly with a STORED permissions matrix (rather than relying on a role
// default), so effectivePermissions (src/admin/permissions.ts) uses the stored map verbatim. Role
// is set to "viewer" — irrelevant here since a non-empty stored matrix always wins over the role
// fallback.
Given(
  "a staff user {string} with password {string} and only {string} permission",
  async function (email, password, sectionLevel) {
    const matrix = matrixWithOnly(sectionLevel);
    await pool.query(
      "INSERT INTO users (email, full_name, role, password_hash, permissions) VALUES ($1, 'Staff User', 'viewer', $2, $3)",
      [email, hashPassword(password), JSON.stringify(matrix)],
    );
  },
);

// PATCH /api/admin/users/:id/permissions — merges one section:level override into the target's
// CURRENT stored matrix (read fresh from the DB) and submits the complete matrix, matching what the
// real Team matrix editor always sends (permissionsSchema requires all 13 sections).
When(
  "I PATCH the admin user {string} permissions to add {string} as {string} with password {string}",
  async function (targetEmail, sectionLevel, actorEmail, actorPassword) {
    const [section, level] = sectionLevel.split(":");
    const token = await login(actorEmail, actorPassword);
    const target = await pool.query("SELECT id, permissions FROM users WHERE email = $1", [targetEmail]);
    const targetId = target.rows[0].id;
    const current = target.rows[0].permissions || {};
    const merged = {};
    for (const s of SECTIONS) merged[s] = current[s] || "none";
    merged[section] = level;
    const res = await fetch(`${BASE_URL}/api/admin/users/${targetId}/permissions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ permissions: merged }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

// PATCH /api/admin/users/:id/permissions with a full edit-everywhere matrix EXCEPT team, which is
// lowered to "view" — used to drive the last-admin guard: the target (self, in the last-guard
// scenario) currently holds effective team:edit via the "admin" role default (an empty stored
// matrix), and this submits the first-ever stored matrix for them with team below "edit".
When(
  "I PATCH the admin user {string} permissions to remove team edit as {string} with password {string}",
  async function (targetEmail, actorEmail, actorPassword) {
    const token = await login(actorEmail, actorPassword);
    const target = await pool.query("SELECT id FROM users WHERE email = $1", [targetEmail]);
    const targetId = target.rows[0].id;
    const matrix = {};
    for (const s of SECTIONS) matrix[s] = s === "team" ? "view" : "edit";
    const res = await fetch(`${BASE_URL}/api/admin/users/${targetId}/permissions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ permissions: matrix }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

Then("the admin response permissions field {string} should be {string}", function (field, value) {
  const permissions = (this.adminBody && this.adminBody.permissions) || {};
  assert.equal(String(permissions[field]), value);
});

// "an admin user {string} with password {string}" / "... with role {string} and password {string}"
// (admin-auth.steps.js / admin-api.steps.js), "a donor {string} with email {string}" +
// "I PATCH the admin donor full name to {string} as {string} with password {string}"
// (admin-api.steps.js), "a submitted story with text {string}" +
// "I PATCH the admin story status to {string} as {string} with password {string}"
// (admin-stories.steps.js), "I GET the admin path {string} as {string} with password {string}"
// (admin-api.steps.js), "every other enabled admin is temporarily disabled, leaving only {string}"
// + its @admin-last-guard After restore (admin-users.steps.js), and "the admin response status
// should be {int}" / "the admin response field {string} should be {string}" (admin-auth.steps.js /
// admin-api.steps.js) are all reused unchanged from the existing Phase 1 / admin-api step files.

AfterAll(async function () {
  await pool.end();
});
