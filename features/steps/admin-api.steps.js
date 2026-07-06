const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
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
  // declarations FK to donors is ON DELETE RESTRICT (TASK-130 seeds one for the donor), so clear the
  // test donors' declarations before the donors themselves.
  await pool.query(
    "DELETE FROM declarations WHERE donor_id IN (SELECT id FROM donors WHERE email LIKE '%admin.bdd@example.com')",
  );
  await pool.query("DELETE FROM donors WHERE email LIKE '%admin.bdd@example.com'");
});

// Remove the claim batch a scenario created (the "an open claim batch" Given and the create-batch
// step both stamp this.claimBatchId). Without this, every run left a stray batch behind — empty
// ones piled up on the admin Claims screen. Delete the batch's donations first (a claims-pipeline
// scenario assigns a seeded eligible gift to it) so the FK from donations → claim_batches is clear.
// this.claimBatchId is only ever a batch the test just created, never real/seed data.
After({ tags: "@admin" }, async function () {
  if (this.claimBatchId == null) return;
  await pool.query("DELETE FROM donations WHERE claim_batch_id = $1", [this.claimBatchId]);
  await pool.query("DELETE FROM claim_batches WHERE id = $1", [this.claimBatchId]);
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

When(
  "I search admin {string} for {string} as {string} with password {string}",
  async function (kind, q, email, password) {
    const token = await login(email, password);
    const res = await fetch(
      `${BASE_URL}/api/admin/search/${kind}?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

// Seed an active (revoked_at NULL) declaration for the admin's donor (TASK-130). Keyed to
// this.adminDonorId; stores this.declarationId so the shared portal Then steps can assert on it.
Given("the admin donor has an active Gift Aid declaration", async function () {
  const decl = await pool.query(
    `INSERT INTO declarations
       (donor_id, first_name, last_name, house_name_number, address, non_uk, scope,
        wording_version, wording_snapshot, confirmed_taxpayer)
     VALUES ($1, 'Ada', 'Behalf', '12', 'Old Ave, London', false, 'all_donations',
             'v1', 'I want to Gift Aid my donations.', true)
     RETURNING id`,
    [this.adminDonorId],
  );
  this.declarationId = decl.rows[0].id;
});

When(
  "I PATCH the admin donor declaration as {string} with password {string}:",
  async function (email, password, docString) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/donors/${this.adminDonorId}/declaration`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: docString,
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

Given("an open claim batch", async function () {
  const batch = await pool.query(
    "INSERT INTO claim_batches (status) VALUES ('open') RETURNING id",
  );
  this.claimBatchId = batch.rows[0].id;
});

When(
  "I submit the claim batch as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(
      `${BASE_URL}/api/admin/claim-batches/${this.claimBatchId}/submit`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I GET the admin adjustment-due queue as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/claims/adjustment-due`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I GET the admin queue {string} as {string} with password {string}",
  async function (queue, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/queues/${queue}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When("I GET the admin queue {string} without a token", async function (queue) {
  const res = await fetch(`${BASE_URL}/api/admin/queues/${queue}`);
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

When("I search admin {string} for {string} without a token", async function (kind, q) {
  const res = await fetch(`${BASE_URL}/api/admin/search/${kind}?q=${encodeURIComponent(q)}`);
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

Then("the admin search results are not empty", function () {
  assert.ok(Array.isArray(this.adminBody.results), "expected a results array");
  assert.ok(this.adminBody.results.length > 0, "expected at least one search result");
});

Then("the admin response field {string} should be {string}", function (field, value) {
  assert.equal(String(this.adminBody[field]), value);
});

// --- Admin dashboard read lists (REQ-066 · TASK-114) ---
When("I GET the admin path {string} without a token", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`);
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

When(
  "I GET the admin path {string} as {string} with password {string}",
  async function (path, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I export the claim batch as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(
      `${BASE_URL}/api/admin/claim-batches/${this.claimBatchId}/export`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    this.adminStatus = res.status;
    this.adminContentType = res.headers.get("content-type") || "";
  },
);

Then("the admin response content type should contain {string}", function (expected) {
  assert.ok(
    (this.adminContentType || "").includes(expected),
    `expected content-type to contain ${expected}, got ${this.adminContentType}`,
  );
});

// --- Claims pipeline (create batch → assign eligible → export non-empty CSV) ---
// Clean this scenario's seeded gift in FK order (donations → declarations → donors). The eligible
// donor uses a distinct '%claims.pipeline@example.test' email so the @admin Before (which deletes donors
// by '%admin.bdd@example.com' and would hit an FK on a donor that has a donation) never touches it.
Before({ tags: "@claims-pipeline" }, async function () {
  await pool.query(
    "DELETE FROM donations WHERE donor_id IN (SELECT id FROM donors WHERE email LIKE '%claims.pipeline@example.test')",
  );
  await pool.query(
    "DELETE FROM declarations WHERE donor_id IN (SELECT id FROM donors WHERE email LIKE '%claims.pipeline@example.test')",
  );
  await pool.query("DELETE FROM donors WHERE email LIKE '%claims.pipeline@example.test'");
});

Given("an eligible Gift-Aided donation", async function () {
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email, email_consent) VALUES ('individual', 'Ada Claims', 'ada.claims.pipeline@example.test', true) RETURNING id",
  );
  const donorId = donor.rows[0].id;
  const decl = await pool.query(
    `INSERT INTO declarations
       (donor_id, first_name, last_name, house_name_number, address, postcode, non_uk,
        scope, wording_version, wording_snapshot, confirmed_taxpayer)
     VALUES ($1, 'Ada', 'Claims', '12', 'Analytical Avenue, London', 'KA1 1AA', false,
        'this_donation', 'hmrc-single-2024-01', 'I want to Gift Aid my donation ...', true)
     RETURNING id`,
    [donorId],
  );
  const donation = await pool.query(
    `INSERT INTO donations (donor_id, declaration_id, mode, amount_pence, gift_aid, claim_status)
     VALUES ($1, $2, 'once', 5000, true, 'eligible') RETURNING id`,
    [donorId, decl.rows[0].id],
  );
  this.eligibleDonationId = donation.rows[0].id;
});

When("I create a claim batch as {string} with password {string}", async function (email, password) {
  const token = await login(email, password);
  const res = await fetch(`${BASE_URL}/api/admin/claim-batches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}",
  });
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
  if (this.adminBody && this.adminBody.batchId != null) this.claimBatchId = this.adminBody.batchId;
});

Then("the created claim batch id is returned", function () {
  assert.ok(Number.isInteger(this.claimBatchId), `expected a numeric batch id, got ${this.claimBatchId}`);
});

When(
  "I add the eligible donation to the batch as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/claim-batches/${this.claimBatchId}/donations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ donationIds: [this.eligibleDonationId] }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I export the claim batch to CSV as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/claim-batches/${this.claimBatchId}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminCsv = await res.text();
  },
);

Then("the exported CSV has at least {int} data row", function (n) {
  const lines = String(this.adminCsv || "").split("\r\n").filter(function (l) { return l.length > 0; });
  // First line is the header; the rest are donation rows.
  assert.ok(lines.length - 1 >= n, `expected >= ${n} data rows, got ${lines.length - 1} (csv: ${JSON.stringify(this.adminCsv)})`);
});

AfterAll(async function () {
  await pool.end();
});
