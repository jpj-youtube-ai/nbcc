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
  assert.equal(res.status, 200, `the sign in request answered ${res.status}`);
});

// The sign in request answers before it looks anyone up, so the answer never tells who is enrolled,
// and sends any code just after. So count once that has had time to finish: wait for the emails
// expected, then a moment more for any still on their way, and only then count.
Then("once the request has finished, {int} {string} email(s) went to {string}", async function (n, kind, email) {
  const count = async () =>
    (await pool.query("SELECT count(*)::int AS n FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2)", [kind, email])).rows[0].n;
  for (let i = 0; i < 30 && (await count()) < n; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 750));
  assert.equal(await count(), n);
});

// Elf payments in Admin > Donations, beside the gifts (decision 8 of the design).
When("{string} with password {string} reads the donations list", async function (email, password) {
  await asHeadElf(this, email, password, "GET", "/api/admin/donations?limit=100");
});

When("{string} with password {string} reads the donations list with source {string}", async function (email, password, source) {
  await asHeadElf(this, email, password, "GET", `/api/admin/donations?limit=100&source=${encodeURIComponent(source)}`);
});

const elfPaymentFrom = (world, email) => (world.hqBody.results || []).find((r) => r.source === "elf_school" && r.donor_email === email);

Then("it lists an Elf Detective School payment from {string}", function (email) {
  const row = elfPaymentFrom(this, email);
  assert.ok(row, JSON.stringify((this.hqBody.results || []).slice(0, 3)));
  assert.equal(row.kind, "elf");
  assert.equal(row.payment_status, "paid");
  assert.equal(row.donor_id, null);
  assert.equal(row.amount_pence, row.entry_pence + row.gift_pence);
  assert.ok(String(row.elf_reference).startsWith("EDS-"), row.elf_reference);
});

Then("it lists no Elf Detective School payment from {string}", function (email) {
  assert.equal(elfPaymentFrom(this, email), undefined);
});

Then("every row it lists is an Elf Detective School payment", function () {
  const rows = this.hqBody.results || [];
  assert.ok(rows.length > 0, "the list is empty");
  for (const r of rows) assert.equal(r.source, "elf_school", JSON.stringify(r));
});

Then("Head Elf HQ counts {int} family and {int} name to check", function (families, names) {
  assert.equal(this.hqStatus, 200, JSON.stringify(this.hqBody));
  assert.equal(this.hqBody.numbers.families, families);
  assert.equal(this.hqBody.numbers.namesToCheck, names);
  assert.ok(this.hqBody.quests.some((q) => q.id === "names"), JSON.stringify(this.hqBody.quests));
});
