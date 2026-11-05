const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for features/elf-admin.feature: Head Elf HQ, the Elf Detective School's own admin section
// (docs/superpowers/specs/2026-11-05-elf-admin-design.md). The families come from the elf join steps
// (features/steps/elf-join.steps.js, whose @elf-school hooks clear them) and the staff from "an admin
// user {string} with role {string} and password {string}" (features/steps/admin-api.steps.js, whose
// @admin hooks clear them). Every family and person here is invented.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** The newest test detective with this first name (the elf join steps' families all end .elf.bdd). */
async function detectiveCalled(firstName) {
  const r = await pool.query(
    `SELECT d.id, d.name_approved FROM elf_detectives d JOIN elf_families f ON f.id = d.family_id
      WHERE d.first_name = $1 AND f.email LIKE '%.elf.bdd@example.com' ORDER BY d.id DESC LIMIT 1`,
    [firstName],
  );
  assert.ok(r.rows[0], `no test detective called ${firstName}`);
  return r.rows[0];
}

async function familyOf(email) {
  const r = await pool.query("SELECT id FROM elf_families WHERE email = $1", [email]);
  assert.ok(r.rows[0], `no test family ${email}`);
  return r.rows[0].id;
}

/** A head elf's request to Head Elf HQ's API, signed in as `email`. */
async function asHeadElf(world, email, password, method, path, body) {
  const token = await login(email, password);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  world.hqStatus = res.status;
  world.hqBody = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, JSON.stringify(world.hqBody));
}

/** A real admin session, through the sign in and its emailed code (the code is handed back here,
 *  outside production), as features/steps/admin-api.steps.js signs in. */
async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
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

When("{string} with password {string} reads Head Elf HQ", async function (email, password) {
  const token = await login(email, password);
  const res = await fetch(`${BASE_URL}/api/admin/elf/hq`, { headers: { Authorization: `Bearer ${token}` } });
  this.hqStatus = res.status;
  this.hqBody = await res.json().catch(() => ({}));
});

Then("Head Elf HQ answers {int}", function (status) {
  assert.equal(this.hqStatus, status, JSON.stringify(this.hqBody));
});

When("{string} with password {string} ticks {string} to show in public", async function (email, password, firstName) {
  const d = await detectiveCalled(firstName);
  await asHeadElf(this, email, password, "PATCH", `/api/admin/elf/detectives/${d.id}`, { approved: true });
});

When("{string} with password {string} renames {string} to {string}", async function (email, password, from, to) {
  const d = await detectiveCalled(from);
  await asHeadElf(this, email, password, "PATCH", `/api/admin/elf/detectives/${d.id}`, { firstName: to });
});

Then("{string} shows in public", async function (firstName) {
  assert.equal((await detectiveCalled(firstName)).name_approved, true);
});

Then("{string} waits for a tick", async function (firstName) {
  assert.equal((await detectiveCalled(firstName)).name_approved, false);
});

When("{string} with password {string} removes the family of {string}", async function (email, password, family) {
  await asHeadElf(this, email, password, "POST", `/api/admin/elf/families/${await familyOf(family)}/remove`);
});

When("{string} with password {string} puts back the family of {string}", async function (email, password, family) {
  await asHeadElf(this, email, password, "POST", `/api/admin/elf/families/${await familyOf(family)}/restore`);
});

When("a sign in code is asked for {string}", async function (email) {
  const res = await fetch(`${BASE_URL}/api/elf/sign-in/request`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ email }).toString(),
  });
  assert.ok(res.status < 500, `the sign in request answered ${res.status}`);
});

Then("Head Elf HQ counts {int} family and {int} name to check", function (families, names) {
  assert.equal(this.hqStatus, 200, JSON.stringify(this.hqBody));
  assert.equal(this.hqBody.numbers.families, families);
  assert.equal(this.hqBody.numbers.namesToCheck, names);
  assert.ok(this.hqBody.quests.some((q) => q.id === "names"), JSON.stringify(this.hqBody.quests));
});
