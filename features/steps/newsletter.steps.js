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
  // TASK-249: templates OUTLIVE the users deleted above (created_by is ON DELETE SET NULL — a
  // template belongs to the team, not its author), so they must be cleared by name or a re-run would
  // hit the unique-name rule and 409 where it expects 201.
  await pool.query("DELETE FROM newsletter_templates WHERE name LIKE 'Bdd %'");
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

// Manually adding a subscriber (e.g. an email collected verbally).
When("I add the newsletter subscriber {string}", async function (email) {
  const r = await authFetch("/api/admin/newsletters/subscribers", "POST", { email }, this.token);
  this.subStatus = r.status;
  this.subBody = r.json;
});

Then("the subscriber response status should be {int}", function (expected) {
  assert.equal(this.subStatus, expected);
});

Then("the subscriber response field {string} should be {string}", function (field, value) {
  assert.equal(String(this.subBody[field]), value);
});

Then("the newsletter response field {string} should be at least {int}", function (field, min) {
  assert.ok(Number(this.nlBody[field]) >= min, `${field} ${this.nlBody[field]} < ${min}`);
});

// Test-send (feature 1): one copy to the signed-in admin.
When("I test-send the block newsletter with subject {string}", async function (subject) {
  const r = await authFetch("/api/admin/newsletters/test-send", "POST", { subject, bodyJson: SAMPLE_DOC }, this.token);
  this.testStatus = r.status;
  this.testBody = r.json;
});
Then("the test-send response status should be {int}", function (expected) {
  assert.equal(this.testStatus, expected);
});

// Subscriber management (feature 3): list, export, remove.
When("I list the newsletter subscribers", async function () {
  const r = await authFetch("/api/admin/newsletters/subscribers", "GET", undefined, this.token);
  this.subsStatus = r.status;
  this.subsBody = r.json;
});
Then("the subscriber list status should be {int}", function (expected) {
  assert.equal(this.subsStatus, expected);
});
Then("the subscriber list should include {string}", function (email) {
  assert.ok((this.subsBody.subscribers || []).some((s) => s.email === email), `expected ${email} in list`);
});
Then("the subscriber list should not include {string}", function (email) {
  assert.ok(!(this.subsBody.subscribers || []).some((s) => s.email === email), `did not expect ${email} in list`);
});

When("I remove the newsletter subscriber {string}", async function (email) {
  const r = await authFetch("/api/admin/newsletters/subscribers/remove", "POST", { email }, this.token);
  this.removeStatus = r.status;
});
Then("the remove-subscriber response status should be {int}", function (expected) {
  assert.equal(this.removeStatus, expected);
});

When("I export the newsletter subscribers as CSV", async function () {
  const res = await fetch(`${BASE_URL}/api/admin/newsletters/subscribers.csv`, {
    headers: { Authorization: "Bearer " + this.token },
  });
  this.csvStatus = res.status;
  this.csvText = await res.text();
});
Then("the CSV status should be {int}", function (expected) {
  assert.equal(this.csvStatus, expected);
});
Then("the CSV should contain {string}", function (needle) {
  assert.ok((this.csvText || "").includes(needle), `expected CSV to contain ${needle}`);
});

// Attachments (feature: add an attachment).
When("I attach a {string} file named {string} to that newsletter", async function (mime, filename) {
  const dataBase64 = Buffer.from("hello attachment " + filename).toString("base64");
  const r = await authFetch(
    `/api/admin/newsletters/${this.newsletterId}/attachments`,
    "POST",
    { filename, mime, dataBase64 },
    this.token,
  );
  this.attStatus = r.status;
  this.attBody = r.json;
});
Then("the attachment response status should be {int}", function (expected) {
  assert.equal(this.attStatus, expected);
});
When("I list the attachments for that newsletter", async function () {
  const r = await authFetch(`/api/admin/newsletters/${this.newsletterId}/attachments`, "GET", undefined, this.token);
  this.attList = r.json;
});
Then("the attachment list should include {string}", function (name) {
  assert.ok((this.attList.attachments || []).some((a) => a.filename === name), `expected ${name}`);
});
Then("the attachment list should not include {string}", function (name) {
  assert.ok(!(this.attList.attachments || []).some((a) => a.filename === name), `did not expect ${name}`);
});
When("I delete that attachment", async function () {
  const r = await authFetch(
    `/api/admin/newsletters/${this.newsletterId}/attachments/${this.attBody.id}`,
    "DELETE",
    undefined,
    this.token,
  );
  this.attDelStatus = r.status;
});
Then("the attachment delete status should be {int}", function (expected) {
  assert.equal(this.attDelStatus, expected);
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

// --- TASK-249: the shared saved-template library ---------------------------------------------------
// Reuses SAMPLE_DOC as "the current block document" (the same doc the preview scenario builds), so the
// scenario proves the round trip rather than re-describing a document.

When("I save the current block document as a template named {string}", async function (name) {
  const r = await authFetch("/api/admin/newsletter-templates", "POST", { name, bodyJson: SAMPLE_DOC }, this.token);
  this.tplStatus = r.status;
  this.tplBody = r.json;
  // Only a successful save carries an id — a 409 must NOT clobber the id we already hold, or the
  // delete steps below would target nothing and pass for the wrong reason.
  if (r.json && r.json.id) this.templateId = r.json.id;
});

When("I fetch the newsletter templates", async function () {
  const r = await authFetch("/api/admin/newsletter-templates", "GET", undefined, this.token);
  this.tplStatus = r.status;
  this.tplList = r.json;
});

When("I fetch that saved template", async function () {
  const r = await authFetch(`/api/admin/newsletter-templates/${this.templateId}`, "GET", undefined, this.token);
  this.tplStatus = r.status;
  this.tplBody = r.json;
});

When("I delete that saved template", async function () {
  const r = await authFetch(`/api/admin/newsletter-templates/${this.templateId}`, "DELETE", undefined, this.token);
  this.tplStatus = r.status;
});

Then("the template response status should be {int}", function (expected) {
  assert.equal(this.tplStatus, expected);
});

Then("the template list should contain {string}", function (name) {
  assert.ok(Array.isArray(this.tplList), "expected the template list to be an array");
  assert.ok(
    this.tplList.some((t) => t.name === name),
    `expected the shared library to contain a template named "${name}"`,
  );
});

Then("the saved template should carry its block document", function () {
  const doc = this.tplBody && this.tplBody.bodyJson;
  assert.ok(doc && Array.isArray(doc.blocks), "expected the template to return a block document");
  assert.ok(doc.blocks.length > 0, "expected the template's document to carry blocks — an empty one is useless");
});

// --- TASK-252: deleting a newsletter ---------------------------------------------------------------
// One endpoint, two behaviours, chosen server-side from the newsletter's own status: a draft is really
// deleted; a sent one is redacted down to its audit stub.

When("I delete that newsletter", async function () {
  const r = await authFetch(`/api/admin/newsletters/${this.newsletterId}`, "DELETE", undefined, this.token);
  this.nlStatus = r.status;
  this.nlBody = r.json;
});

When("I fetch that newsletter", async function () {
  const r = await authFetch(`/api/admin/newsletters/${this.newsletterId}`, "GET", undefined, this.token);
  this.nlStatus = r.status;
  this.nlBody = r.json;
});

// The redaction's promise: the content really is gone, not merely hidden.
Then("the newsletter body should be empty", function () {
  assert.equal(this.nlBody.bodyHtml, "", "expected the redacted newsletter's body_html to be blank");
  assert.ok(!this.nlBody.bodyJson, "expected the redacted newsletter's body_json to be cleared");
});

// TASK-254: the subject that actually went out is echoed back by the test-send, so the merge can be
// asserted across the real HTTP hop — the raw-subject bug lived at the call site, not in the pure
// merge function, so that hop is the thing worth proving.
Then("the test-send subject should be {string}", function (expected) {
  assert.equal(this.testBody.subject, expected);
});

Then("the test-send subject should not contain {string}", function (unexpected) {
  assert.ok(
    !String(this.testBody.subject || "").includes(unexpected),
    `expected the sent subject NOT to contain "${unexpected}" — got "${this.testBody.subject}"`,
  );
});

// --- TASK-255: the Resend delivery webhook + stats --------------------------------------------------
// Events are signed EXACTLY as Svix/Resend signs them (HMAC-SHA256 over `${id}.${ts}.${body}` with the
// base64 secret key), against the same RESEND_WEBHOOK_SECRET the app reads — the default matches
// .env.example and pr.yml, so this passes locally and in CI without setup.
const RESEND_SECRET =
  process.env.RESEND_WEBHOOK_SECRET || "whsec_Y2ktdGVzdC1rZXktZm9yLXJlc2VuZC13ZWJob29rcw==";

function svixHeadersFor(id, body, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
}

async function postResendEvent(headers, body) {
  const res = await fetch(`${BASE_URL}/api/webhooks/resend`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

When("Resend reports a signed {string} event for {string}", async function (type, email) {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { to: [email] } });
  // Unique per run so re-runs against a lived-in local DB never collide on the svix id.
  this.lastSvix = { id: `msg_bdd_${type}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, body };
  const r = await postResendEvent(svixHeadersFor(this.lastSvix.id, body, RESEND_SECRET), body);
  this.whStatus = r.status;
  this.whBody = r.json;
});

When("Resend retries the last event", async function () {
  const r = await postResendEvent(svixHeadersFor(this.lastSvix.id, this.lastSvix.body, RESEND_SECRET), this.lastSvix.body);
  this.whStatus = r.status;
  this.whBody = r.json;
});

When("Resend reports an UNSIGNED {string} event for {string}", async function (type, email) {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { to: [email] } });
  const r = await postResendEvent({}, body);
  this.whStatus = r.status;
  this.whBody = r.json;
});

Then("the webhook response status should be {int}", function (expected) {
  assert.equal(this.whStatus, expected);
});

Then("the webhook outcome should be {string}", function (expected) {
  assert.equal(this.whBody.outcome, expected);
});

When("I fetch that newsletter's stats", async function () {
  const r = await authFetch(`/api/admin/newsletters/${this.newsletterId}/stats`, "GET", undefined, this.token);
  this.statsStatus = r.status;
  this.stats = r.json;
});

Then(
  "the newsletter stats should show at least {int} sends, {int} delivered and {int} bounced",
  function (sends, delivered, bounced) {
    assert.equal(this.statsStatus, 200);
    // "At least": the send goes to EVERY consenting donor in the DB, and earlier features may have
    // left consenting donors behind — the exact-count assertions are on the events, which are ours.
    assert.ok(this.stats.sends >= sends, `sends: ${JSON.stringify(this.stats)}`);
    assert.equal(this.stats.delivered, delivered, `delivered: ${JSON.stringify(this.stats)}`);
    assert.equal(this.stats.bounced, bounced, `bounced: ${JSON.stringify(this.stats)}`);
  },
);

Then("the bounced addresses should include {string}", function (email) {
  assert.ok(
    (this.stats.bouncedEmails || []).includes(email),
    `expected ${email} in ${JSON.stringify(this.stats.bouncedEmails)}`,
  );
});

// TASK-257: engagement events ride the same signed webhook; a click names its destination link.
When("Resend reports a signed click on {string} by {string}", async function (link, email) {
  const body = JSON.stringify({
    type: "email.clicked",
    created_at: new Date().toISOString(),
    data: { to: [email], click: { link } },
  });
  this.lastSvix = { id: `msg_bdd_click_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, body };
  const r = await postResendEvent(svixHeadersFor(this.lastSvix.id, body, RESEND_SECRET), body);
  this.whStatus = r.status;
  this.whBody = r.json;
});

Then("the newsletter stats should count {int} click", function (clicks) {
  assert.equal(this.stats.clicked, clicks, JSON.stringify(this.stats));
});

Then("the per-link stats should show {int} person clicked {string}", function (people, link) {
  const row = (this.stats.links || []).find((l) => l.link === link);
  assert.ok(row, `expected a per-link row for ${link} in ${JSON.stringify(this.stats.links)}`);
  assert.equal(row.uniqueClicks, people);
});
