const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for admin-outreach.feature (TASK-401). The matcher, the schemas and the email copy are all
// covered DB-free in test/unit/outreach-*.test.ts; what is left for BDD is the part only a running
// server can prove — who is allowed to do what, and that the do-not-contact rule holds on the
// server rather than only in the browser.
//
// Admin users are seeded and cleaned by admin-auth.steps.js's shared @admin Before hook; login
// reuses the same POST /api/admin/login (+ stubbed 2FA) flow as the other admin step files.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Every business this feature creates starts "Zzbdd", so cleanup is one unambiguous prefix and a
// rerun is idempotent. The prefix is also nothing like a real Ayrshire business name, so it cannot
// collide with seeded donor rows the matcher also reads.
async function clean() {
  await pool.query(
    `DELETE FROM business_outreach_notes WHERE outreach_id IN
       (SELECT id FROM business_outreach WHERE business_name LIKE 'Zzbdd%')`,
  );
  await pool.query("DELETE FROM business_outreach WHERE business_name LIKE 'Zzbdd%'");
  await pool.query("DELETE FROM donations WHERE donor_id IN (SELECT id FROM donors WHERE business_name LIKE 'Zzbdd%')");
  await pool.query("DELETE FROM donors WHERE business_name LIKE 'Zzbdd%'");
}
Before({ tags: "@admin-outreach" }, clean);
After({ tags: "@admin-outreach" }, clean);
AfterAll(async () => {
  await pool.end();
});

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  // The email client is stubbed outside production, so step 1 hands back the code as devCode.
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    return (await res2.json().catch(() => ({}))).token;
  }
  return undefined;
}

async function call(ctx, path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  ctx.outStatus = res.status;
  ctx.outBody = await res.json().catch(() => ({}));
  return ctx.outBody;
}

// --- seeding ------------------------------------------------------------------------------------

Given("the business {string} told us not to contact them again", async function (name) {
  await pool.query(
    `INSERT INTO business_outreach (business_name, business_type, outcome, outcome_at)
     VALUES ($1, 'company', 'declined', now())`,
    [name],
  );
});

// A company donor with a settled gift - the "already gives us money" source.
async function seedBusinessDonor(name, paymentStatus) {
  const donor = await pool.query(
    `INSERT INTO donors (donor_type, full_name, business_name, email)
     VALUES ('company', 'Zzbdd Contact', $1, $2) RETURNING id`,
    [name, `hello@${name.toLowerCase().replace(/[^a-z]/g, "")}.example`],
  );
  await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status)
     VALUES ($1, 'monthly', 2500, false, 'not_eligible', $2)`,
    [donor.rows[0].id, paymentStatus],
  );
}

Given("{string} already gives us money", async function (name) {
  await seedBusinessDonor(name, "paid");
});

Given("{string} started a payment that never went through", async function (name) {
  await seedBusinessDonor(name, "pending");
});

Given("the sole trader {string} was added with email {string}", async function (name, email) {
  const row = await pool.query(
    `INSERT INTO business_outreach (business_name, contact_email, business_type)
     VALUES ($1, $2, 'sole_trader') RETURNING id`,
    [name, email],
  );
  this.outId = row.rows[0].id;
});

Given("the sole trader {string} agreed to hear from us", async function (name) {
  const row = await pool.query(
    `INSERT INTO business_outreach
       (business_name, contact_email, business_type, consent_basis, consent_basis_recorded_by,
        consent_basis_recorded_at)
     VALUES ($1, $2, 'sole_trader', $3, 'bdd@example.com', now()) RETURNING id`,
    [name, `hello@${name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
     "Gave me her card at the Chamber breakfast and said to email."],
  );
  this.outId = row.rows[0].id;
});

Given("the business {string} was added without an email address", async function (name) {
  const row = await pool.query(
    `INSERT INTO business_outreach (business_name, business_type) VALUES ($1, 'company') RETURNING id`,
    [name],
  );
  this.outId = row.rows[0].id;
});

Given("the business {string} was added with email {string}", async function (name, email) {
  const row = await pool.query(
    `INSERT INTO business_outreach (business_name, contact_email, business_type)
     VALUES ($1, $2, 'company') RETURNING id`,
    [name, email],
  );
  this.outId = row.rows[0].id;
});

// --- requests -----------------------------------------------------------------------------------

When("I GET the outreach list without a token", async function () {
  await call(this, "/api/admin/outreach");
});

When(
  "I check the business {string} as {string} with password {string}",
  async function (name, email, password) {
    const token = await login(email, password);
    await call(this, "/api/admin/outreach/check", {
      method: "POST",
      token,
      body: { businessName: name },
    });
  },
);

async function add(ctx, name, actor, password, acknowledge) {
  const token = await login(actor, password);
  const body = { businessName: name, businessType: "company" };
  if (acknowledge) body.acknowledgedMatches = true;
  const out = await call(ctx, "/api/admin/outreach", { method: "POST", token, body });
  if (out.business) ctx.outId = out.business.id;
}

When(
  "I add the business {string} as {string} with password {string}",
  async function (name, actor, password) {
    await add(this, name, actor, password, false);
  },
);

When(
  "I add the business {string} acknowledging the matches as {string} with password {string}",
  async function (name, actor, password) {
    await add(this, name, actor, password, true);
  },
);

When(
  "I preview the invitation to {string} saying {string} as {string} with password {string}",
  async function (name, message, actor, password) {
    const token = await login(actor, password);
    await call(this, "/api/admin/outreach/preview", {
      method: "POST",
      token,
      body: {
        businessName: name,
        personalMessage: message,
        signerName: "Jaimie Wakefield",
        signerRole: "Project Manager, Night Before Christmas Campaign",
      },
    });
  },
);

When("I send the invitation as {string} with password {string}", async function (actor, password) {
  const token = await login(actor, password);
  await call(this, `/api/admin/outreach/${this.outId}/send`, {
    method: "POST",
    token,
    body: {
      personalMessage: "",
      signerName: "Jaimie Wakefield",
      signerRole: "Project Manager, Night Before Christmas Campaign",
    },
  });
});

When("I open the business as {string} with password {string}", async function (actor, password) {
  const token = await login(actor, password);
  await call(this, `/api/admin/outreach/${this.outId}`, { token });
});

When("I open business {int} as {string} with password {string}", async function (id, actor, password) {
  const token = await login(actor, password);
  await call(this, `/api/admin/outreach/${id}`, { token });
});

async function recordOutcome(ctx, outcome, askAgainOn, actor, password) {
  const token = await login(actor, password);
  await call(ctx, `/api/admin/outreach/${ctx.outId}/outcome`, {
    method: "POST",
    token,
    body: { outcome, askAgainOn },
  });
}

When(
  "I record the outcome {string} as {string} with password {string}",
  async function (outcome, actor, password) {
    await recordOutcome(this, outcome, null, actor, password);
  },
);

When(
  "I record the outcome {string} asking again on {string} as {string} with password {string}",
  async function (outcome, date, actor, password) {
    await recordOutcome(this, outcome, date, actor, password);
  },
);

When("I add the note {string} as {string} with password {string}", async function (body, actor, password) {
  const token = await login(actor, password);
  await call(this, `/api/admin/outreach/${this.outId}/notes`, {
    method: "POST",
    token,
    body: { body },
  });
});

// The todo list reads sent_at and owner_email, so a scenario has to be able to seed both.
async function seedEmailed(name, daysAgo, ownerEmail) {
  const row = await pool.query(
    `INSERT INTO business_outreach
       (business_name, contact_email, business_type, owner_email, sent_at, sent_by)
     VALUES ($1, $2, 'company', $3, now() - ($4 || ' days')::interval, 'bdd@example.com')
     RETURNING id`,
    [name, `hello@${name.toLowerCase().replace(/[^a-z]/g, "")}.example`, ownerEmail, String(daysAgo)],
  );
  return row.rows[0].id;
}

Given(
  "{string} was emailed {int} days ago and belongs to {string}",
  async function (name, daysAgo, ownerEmail) {
    this.outId = await seedEmailed(name, daysAgo, ownerEmail);
  },
);

Given("{string} was emailed {int} days ago and belongs to nobody", async function (name, daysAgo) {
  this.outId = await seedEmailed(name, daysAgo, null);
});

When("I open the list of what needs doing without a token", async function () {
  await call(this, "/api/admin/outreach/todo");
});

When(
  "I open the list of what needs doing as {string} with password {string}",
  async function (actor, password) {
    const token = await login(actor, password);
    await call(this, "/api/admin/outreach/todo", { token });
  },
);

When(
  "I open everyone's list of what needs doing as {string} with password {string}",
  async function (actor, password) {
    const token = await login(actor, password);
    await call(this, "/api/admin/outreach/todo?scope=all", { token });
  },
);

When(
  "I ask who a business can be assigned to as {string} with password {string}",
  async function (actor, password) {
    const token = await login(actor, password);
    await call(this, "/api/admin/outreach/volunteers", { token });
  },
);

Then("the list should include {string}", function (name) {
  const names = (this.outBody.todos || []).map((t) => t.businessName);
  assert.ok(names.includes(name), `expected ${name} on the list, got ${JSON.stringify(names)}`);
});

Then("the list should not include {string}", function (name) {
  const names = (this.outBody.todos || []).map((t) => t.businessName);
  assert.ok(!names.includes(name), `expected ${name} NOT on the list, got ${JSON.stringify(names)}`);
});

Then("the volunteers should include {string}", function (email) {
  const emails = (this.outBody.volunteers || []).map((v) => v.email);
  assert.ok(emails.includes(email), `expected ${email}, got ${JSON.stringify(emails)}`);
});

// --- assertions ---------------------------------------------------------------------------------

Then("the outreach response status should be {int}", function (status) {
  assert.equal(this.outStatus, status);
});

Then("the outreach response should say do not contact", function () {
  assert.equal(this.outBody.doNotContact, true);
});

Then("the outreach response should match a business we already know", function () {
  const matches = this.outBody.matches || [];
  assert.ok(matches.length > 0, "expected at least one match");
  assert.ok(
    matches.some((m) => m.source === "donor"),
    `expected a donor match, got ${JSON.stringify(matches)}`,
  );
});

Then("the outreach response should explain the sole trader rule", function () {
  const error = String(this.outBody.error || "");
  assert.match(error, /sole trader/i);
  // A refusal that does not say what to do instead just gets worked around.
  assert.match(error, /call|letter/i);
});

Then("the outreach business outcome should be {string}", async function (outcome) {
  const row = await pool.query("SELECT outcome FROM business_outreach WHERE id = $1", [this.outId]);
  assert.equal(row.rows[0].outcome, outcome);
});

// last_engagement_at is what holds off the retention purge and drives the call list, so it is
// worth asserting directly rather than inferring it from the outcome.
Then("the outreach business should count as engaged", async function () {
  const row = await pool.query("SELECT last_engagement_at FROM business_outreach WHERE id = $1", [
    this.outId,
  ]);
  assert.ok(row.rows[0].last_engagement_at, "expected last_engagement_at to be stamped");
});

Then("the outreach business should not count as engaged", async function () {
  const row = await pool.query("SELECT last_engagement_at FROM business_outreach WHERE id = $1", [
    this.outId,
  ]);
  assert.equal(row.rows[0].last_engagement_at, null);
});

Then("the outreach business ask-again date should be {string}", async function (date) {
  const row = await pool.query("SELECT ask_again_on FROM business_outreach WHERE id = $1", [
    this.outId,
  ]);
  assert.equal(new Date(row.rows[0].ask_again_on).toISOString().slice(0, 10), date);
});

Then("the outreach business should have no ask-again date", async function () {
  const row = await pool.query("SELECT ask_again_on FROM business_outreach WHERE id = $1", [
    this.outId,
  ]);
  assert.equal(row.rows[0].ask_again_on, null);
});

Then("the business should have a note by {string} saying {string}", async function (author, body) {
  const rows = await pool.query(
    "SELECT author, body FROM business_outreach_notes WHERE outreach_id = $1",
    [this.outId],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].author, author);
  assert.equal(rows.rows[0].body, body);
});

Then("the outreach response should find nothing", function () {
  assert.deepEqual(this.outBody.matches, []);
});

Then("the outreach business should not have been emailed", async function () {
  const row = await pool.query("SELECT sent_at FROM business_outreach WHERE id = $1", [this.outId]);
  assert.equal(row.rows[0].sent_at, null);
});

Then("the outreach business should have been emailed", async function () {
  const row = await pool.query("SELECT sent_at FROM business_outreach WHERE id = $1", [this.outId]);
  assert.ok(row.rows[0].sent_at, "expected sent_at to be stamped");
});

Then("the preview should contain {string}", function (text) {
  assert.ok(
    String(this.outBody.html || "").includes(text),
    `expected the preview to contain ${JSON.stringify(text)}`,
  );
});
