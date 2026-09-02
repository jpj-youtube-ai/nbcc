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
  await pool.query("DELETE FROM business_outreach WHERE business_name LIKE 'Zzbdd%'");
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

// --- assertions ---------------------------------------------------------------------------------

Then("the outreach response status should be {int}", function (status) {
  assert.equal(this.outStatus, status);
});

Then("the outreach response should say do not contact", function () {
  assert.equal(this.outBody.doNotContact, true);
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
