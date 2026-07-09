const { Given, When, Then, Before, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert");
const { Pool } = require("pg");
const { createHmac } = require("node:crypto");

// TASK-162 (REQ-069): BDD for GET /api/admin/thank-you/eligible. Seeds donors +
// paid donations directly, logs in for a real admin session token, and asserts
// the JSON. The admin-user seeding + status steps are reused from admin-api /
// admin-auth (global step definitions).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return body.token;
}

Before({ tags: "@thankyou" }, async function () {
  // Scope cleanup to THIS feature's own rows so we never trip other features'
  // FKs (e.g. declarations -> donors) or wipe their seed data. Test donors carry
  // a marker in business_name; thank_you_sent has no inbound FK so is cleared whole.
  await pool.query("DELETE FROM thank_you_sent");
  await pool.query("DELETE FROM donations WHERE donor_id IN (SELECT id FROM donors WHERE business_name = 'TYBDD')");
  await pool.query("DELETE FROM donors WHERE business_name = 'TYBDD'");
  await pool.query("DELETE FROM users WHERE email LIKE 'ty.%@example.com'");
  this.tyDonorIds = {};
});

async function seedDonor(world, name, email, emailConsent, giftPence) {
  const donor = await pool.query(
    // business_name = 'TYBDD' marks the row for this feature's scoped cleanup; it is
    // ignored by recipientName for individuals, so it doesn't affect assertions.
    "INSERT INTO donors (donor_type, full_name, business_name, email, email_consent) VALUES ('individual', $1, 'TYBDD', $2, $3) RETURNING id",
    [name, email, emailConsent],
  );
  const id = donor.rows[0].id;
  world.tyDonorIds[name] = id;
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status)
     VALUES ($1, 'once', $2, false, 'not_eligible', 'paid')`,
    [id, giftPence],
  );
  return id;
}

function emailFor(name) {
  return name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com";
}

Given("a donor named {string} who gave a single paid gift of {int} pence", async function (name, pence) {
  await seedDonor(this, name, emailFor(name), true, pence);
});

Given(
  "a donor named {string} with no email who gave a single paid gift of {int} pence",
  async function (name, pence) {
    await seedDonor(this, name, null, false, pence);
  },
);

Given(
  "a donor named {string} who opted out of email gave a single paid gift of {int} pence",
  async function (name, pence) {
    await seedDonor(this, name, emailFor(name), false, pence);
  },
);

Given("the donor {string} has already been thanked", async function (name) {
  const id = this.tyDonorIds[name];
  await pool.query(
    `INSERT INTO thank_you_sent
       (donor_id, thank_you_name, addressed_to, recipient_email, gift_type,
        gift_amount_pence, gift_aided, signed_by_name, sent_by)
     VALUES ($1, $2, $2, 'x@example.com', 'money', 200000, false, 'Jodie McFarlane', 'jon@nbcc.scot')`,
    [id, name],
  );
});

When(
  "I list thank-you eligible donors over {int} pence as {string} with password {string}",
  async function (threshold, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/thank-you/eligible?threshold=${threshold}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When("I list thank-you eligible donors over {int} pence with no token", async function (threshold) {
  const res = await fetch(`${BASE_URL}/api/admin/thank-you/eligible?threshold=${threshold}`);
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

function findByName(world, name) {
  return (world.adminBody.results || []).find((r) => r.name === name);
}

Then("the thank-you eligible results should include {string}", function (name) {
  assert.ok(findByName(this, name), `expected results to include ${name}`);
});

Then("the thank-you eligible results should not include {string}", function (name) {
  assert.ok(!findByName(this, name), `expected results NOT to include ${name}`);
});

Then("the thank-you eligible donor {string} should have send-state {string}", function (name, state) {
  const r = findByName(this, name);
  assert.ok(r, `expected results to include ${name}`);
  assert.equal(r.sendState, state);
});

Then("the thank-you eligible donor {string} should be marked already thanked", function (name) {
  const r = findByName(this, name);
  assert.ok(r, `expected results to include ${name}`);
  assert.equal(r.alreadyThanked, true);
});

// ---- TASK-163: compose + send, and the sent-letter history ----

async function sendLetter(world, email, password, recipient, name, cc) {
  const token = await login(email, password);
  const payload = {
    donorId: null,
    thankYouName: name,
    addressedTo: name,
    recipientEmail: recipient,
    giftType: "money",
    giftAmountPence: 150000,
    giftInKind: null,
    giftAided: true,
    personalMessage: null,
    signedByName: "Jodie McFarlane",
    signedByRole: "Head Elf (Trustee), Night Before Christmas Campaign",
  };
  if (cc !== undefined) payload.ccEmail = cc;
  const res = await fetch(`${BASE_URL}/api/admin/thank-you/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  world.adminStatus = res.status;
  world.adminBody = await res.json().catch(() => ({}));
  if (world.adminBody && world.adminBody.id) world.tySentId = world.adminBody.id;
}

When(
  "I send a thank-you letter as {string} with password {string} to {string} for {string}",
  async function (email, password, recipient, name) {
    await sendLetter(this, email, password, recipient, name);
  },
);

// TASK-168: an optional CC on the thank-you email.
When(
  "I send a thank-you letter as {string} with password {string} to {string} for {string} cc {string}",
  async function (email, password, recipient, name, cc) {
    await sendLetter(this, email, password, recipient, name, cc);
  },
);

Then("a thank-you letter to {string} should be recorded", async function (recipient) {
  const r = await pool.query("SELECT COUNT(*)::int AS n FROM thank_you_sent WHERE recipient_email = $1", [recipient]);
  assert.ok(r.rows[0].n >= 1, `expected a recorded thank_you_sent to ${recipient}`);
});

Then("a thank-you letter to {string} should not be recorded", async function (recipient) {
  const r = await pool.query("SELECT COUNT(*)::int AS n FROM thank_you_sent WHERE recipient_email = $1", [recipient]);
  assert.equal(r.rows[0].n, 0, `expected no thank_you_sent to ${recipient}`);
});

// TASK-168: deleting a sent thank-you from the history.
When("I delete that sent thank-you as {string} with password {string}", async function (email, password) {
  assert.ok(this.tySentId, "expected a sent-letter id from a prior send");
  const token = await login(email, password);
  const res = await fetch(`${BASE_URL}/api/admin/thank-you/sent/${this.tySentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

When(
  "I delete thank-you letter id {int} as {string} with password {string}",
  async function (id, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/thank-you/sent/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

Then("there should be a {string} audit row for the deleted thank-you", async function (action) {
  assert.ok(this.tySentId, "expected a sent-letter id");
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1 AND (data->>'thankYouSentId')::int = $2",
    [action, this.tySentId],
  );
  assert.ok(r.rows[0].n >= 1, `no ${action} audit row for id ${this.tySentId}`);
});

Then("the sent thank-you should have an audit row", async function () {
  assert.ok(this.tySentId, "expected a sent-letter id from the send response");
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'thank_you.sent' AND (data->>'thankYouSentId')::int = $1",
    [this.tySentId],
  );
  assert.ok(r.rows[0].n >= 1, `no thank_you.sent audit row for id ${this.tySentId}`);
});

When("I list sent thank-you letters as {string} with password {string}", async function (email, password) {
  const token = await login(email, password);
  const res = await fetch(`${BASE_URL}/api/admin/thank-you/sent`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

Then("the sent thank-you history should include a letter to {string}", function (recipient) {
  const found = (this.adminBody.results || []).some((r) => r.recipientEmail === recipient);
  assert.ok(found, `expected sent history to include a letter to ${recipient}`);
});

// ---- TASK-165: the public printable-letter page (tokenised) ----

// Mirrors src/thank-you/letter-token.ts: token = `<id>.<hmacSha256(id)>` signed with ADMIN_SESSION_SECRET.
function signLetterToken(sentId, secret) {
  const body = String(sentId);
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

When("I open the print page for that sent letter", async function () {
  assert.ok(this.tySentId, "expected a sent-letter id from a prior send");
  const token = signLetterToken(this.tySentId, process.env.ADMIN_SESSION_SECRET);
  const res = await fetch(`${BASE_URL}/thank-you/letter/${token}`);
  this.printStatus = res.status;
  this.printBody = await res.text();
});

When("I open the print page with an invalid token", async function () {
  const res = await fetch(`${BASE_URL}/thank-you/letter/garbage.token`);
  this.printStatus = res.status;
  this.printBody = await res.text();
});

Then("the print page status should be {int}", function (expected) {
  assert.equal(this.printStatus, expected);
});

Then("the print page should show {string}", function (text) {
  assert.ok(this.printBody.includes(text), `expected print page to contain "${text}"`);
});

AfterAll(async function () {
  await pool.end();
});
