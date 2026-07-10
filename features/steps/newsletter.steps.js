const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync, createHmac } = require("node:crypto");

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
  await pool.query(
    "DELETE FROM newsletter_images WHERE uploaded_by IN (SELECT id FROM users WHERE email LIKE '%newsletter.bdd@example.com')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE '%newsletter.bdd@example.com'");
  await pool.query("DELETE FROM donors WHERE email LIKE '%newsletter.bdd@example.com'");
  // Remove any newsletters a prior run created (subjects are test-specific).
  await pool.query(
    "DELETE FROM newsletters WHERE subject IN ('Winter update','Winter update v2','Send me','Nope','Blocks update')",
  );
});

After({ tags: "@newsletter" }, async function () {
  await pool.query(
    "DELETE FROM newsletter_images WHERE uploaded_by IN (SELECT id FROM users WHERE email LIKE '%newsletter.bdd@example.com')",
  );
  await pool.query(
    "DELETE FROM newsletters WHERE subject IN ('Winter update','Winter update v2','Send me','Nope','Blocks update')",
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

// The recipient-list preview behind the send-confirmation dialog (admin-only).
When("I fetch the newsletter recipients", async function () {
  const r = await authFetch("/api/admin/newsletters/recipients", "GET", undefined, this.token);
  this.recipStatus = r.status;
  this.recipBody = r.json;
});

Then("the newsletter recipients status should be {int}", function (expected) {
  assert.equal(this.recipStatus, expected);
});

Then("the newsletter recipients should include {string}", function (email) {
  assert.ok((this.recipBody.emails || []).includes(email), `expected ${email} in recipients`);
});

Then("the newsletter recipients should not include {string}", function (email) {
  assert.ok(!(this.recipBody.emails || []).includes(email), `did not expect ${email} in recipients`);
});

function signUnsubscribeToken(donorId, secret) {
  const body = String(donorId);
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

When("I visit the unsubscribe link for {string}", async function (email) {
  const row = await pool.query("SELECT id FROM donors WHERE email = $1", [email]);
  const donorId = row.rows[0].id;
  const token = signUnsubscribeToken(donorId, process.env.ADMIN_SESSION_SECRET);
  const res = await fetch(`${BASE_URL}/unsubscribe/${token}`);
  this.unsubStatus = res.status;
});

When("I visit the unsubscribe link with token {string}", async function (token) {
  const res = await fetch(`${BASE_URL}/unsubscribe/${token}`);
  this.unsubStatus = res.status;
});

Then("the unsubscribe response status should be {int}", function (expected) {
  assert.equal(this.unsubStatus, expected);
});

Then(
  "the donor {string} should have email consent {string}",
  async function (email, expected) {
    const row = await pool.query("SELECT email_consent FROM donors WHERE email = $1", [email]);
    assert.equal(String(row.rows[0].email_consent), expected);
  },
);

// TASK-168 (REQ-069): block-document builder — create/preview a block doc, upload/serve an image.

// A minimal valid block document (greeting merges the recipient first name).
const SAMPLE_DOC = {
  blocks: [
    { type: "masthead", variant: 0, data: { issueTitle: "Blocks update" } },
    { type: "greeting", variant: 0, data: {} },
    { type: "text", variant: 0, data: { text: "Hello from the committee." } },
  ],
};
// 1x1 transparent PNG.
const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

When("I create a block newsletter with subject {string}", async function (subject) {
  const r = await authFetch("/api/admin/newsletters", "POST", { subject, bodyJson: SAMPLE_DOC }, this.token);
  this.nlStatus = r.status;
  this.nlBody = r.json;
  if (r.json && r.json.id) this.newsletterId = r.json.id;
});

When("I preview the current block document", async function () {
  const r = await authFetch("/api/admin/newsletters/preview", "POST", { bodyJson: SAMPLE_DOC }, this.token);
  this.previewStatus = r.status;
  this.previewHtml = r.json.html || "";
});

Then("the preview response status should be {int}", function (expected) {
  assert.equal(this.previewStatus, expected);
});

Then("the preview HTML should contain {string}", function (needle) {
  assert.ok(this.previewHtml.includes(needle), `preview missing ${needle}`);
});

When("I upload a newsletter image", async function () {
  const r = await authFetch(
    "/api/admin/newsletter-images",
    "POST",
    { mime: "image/png", dataBase64: PNG_1PX_B64 },
    this.token,
  );
  this.imgUploadStatus = r.status;
  this.imgId = r.json.id;
});

When("I upload an oversize newsletter image", async function () {
  const big = Buffer.alloc(2 * 1024 * 1024 + 10, 0x41).toString("base64"); // > 2 MB decoded
  const r = await authFetch(
    "/api/admin/newsletter-images",
    "POST",
    { mime: "image/png", dataBase64: big },
    this.token,
  );
  this.imgUploadStatus = r.status;
});

Then("the image upload status should be {int}", function (expected) {
  assert.equal(this.imgUploadStatus, expected);
});

When("I fetch the uploaded image", async function () {
  const res = await fetch(`${BASE_URL}/media/newsletter/${this.imgId}`);
  this.imgFetchStatus = res.status;
  this.imgContentType = res.headers.get("content-type");
});

// A non-uuid id must 404, not crash the process (TASK-168 fix — Postgres throws 22P02 on a
// malformed uuid literal, which an unhandled rejection would otherwise turn into a process crash).
When("I fetch a malformed newsletter image id", async function () {
  const res = await fetch(`${BASE_URL}/media/newsletter/not-a-uuid`);
  this.imgFetchStatus = res.status;
});

Then("the image fetch status should be {int}", function (expected) {
  assert.equal(this.imgFetchStatus, expected);
});

Then("the image content type should be {string}", function (expected) {
  assert.equal(this.imgContentType, expected);
});
