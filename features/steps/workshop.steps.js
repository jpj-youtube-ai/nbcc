const { Given, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");

// Steps for workshop.feature (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md). Every
// name and address here is invented, and each run makes its own address.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const unique = (who) => `${who}.${randomBytes(4).toString("hex")}@example.com`;

async function postDropOff(world, body) {
  const res = await fetch(`${BASE_URL}/api/workshop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  world.workshopStatus = res.status;
  world.workshopEmail = body.email;
  world.workshopBrought = body.brought;
}

When("somebody drops off {string} at the workshop and ticks the newsletter box", async function (brought) {
  await postDropOff(this, { name: "Robin Example", email: unique("robin"), brought, groupName: "Church group", newsletter: true });
});

When("a bot fills the hidden box on the workshop form", async function () {
  await postDropOff(this, { name: "Bot Example", email: unique("bot"), brought: "Nothing", website: "spam.example" });
});

When("somebody opens the workshop page", async function () {
  const res = await fetch(`${BASE_URL}/workshop`);
  this.workshopStatus = res.status;
  this.workshopHtml = await res.text();
});

Then("the workshop answers {int}", function (status) {
  assert.equal(this.workshopStatus, status);
});

Then("the drop-off is saved with what they brought", async function () {
  const { rows } = await pool.query("SELECT brought, group_name, newsletter FROM workshop_dropoffs WHERE email = $1", [this.workshopEmail]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brought, this.workshopBrought);
  assert.equal(rows[0].group_name, "Church group");
  assert.equal(rows[0].newsletter, true);
});

Then("they are on the newsletter list, signed up at the workshop", async function () {
  const { rows } = await pool.query(
    `SELECT s.consent_source FROM list_subscribers s JOIN subscriber_lists l ON l.id = s.list_id
      WHERE l.slug = 'newsletter' AND s.email = $1`,
    [this.workshopEmail],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].consent_source, "workshop");
});

Then("no drop-off is saved for the bot", async function () {
  const { rows } = await pool.query("SELECT 1 FROM workshop_dropoffs WHERE email = $1", [this.workshopEmail]);
  assert.equal(rows.length, 0);
});

Then("the workshop page asks search engines not to list it", function () {
  assert.match(this.workshopHtml, /<meta name="robots" content="noindex"/);
});

AfterAll(async function () {
  await pool.end();
});

// --- Admin > Giving > Workshop drop-offs (admin-drop-offs.feature) ---------------------------------
// The staff come from the shared @admin steps (addresses ending "admin.bdd@example.com").
const STAFF_PASSWORD = "do-pw-123";

async function staffLogin(email) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: STAFF_PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    return (await res2.json().catch(() => ({}))).token;
  }
  throw new Error(`could not sign in as ${email}: ${JSON.stringify(body)}`);
}

// One sign-in per person per scenario: each one mints and spends a 2FA code.
async function staffCall(world, method, path, email) {
  world.doTokens = world.doTokens || {};
  if (email && !world.doTokens[email]) world.doTokens[email] = await staffLogin(email);
  const headers = email ? { Authorization: `Bearer ${world.doTokens[email]}` } : {};
  const res = await fetch(`${BASE_URL}${path}`, { method, headers });
  world.doStatus = res.status;
  world.doBody = await res.json().catch(() => ({}));
}

Given("somebody has dropped off {string} at the workshop", async function (brought) {
  const email = unique("sam");
  const { rows } = await pool.query(
    "INSERT INTO workshop_dropoffs (name, email, brought) VALUES ('Sam Example', $1, $2) RETURNING id",
    [email, brought],
  );
  this.doId = rows[0].id;
});

When("I ask for the workshop drop-offs without a session", async function () {
  await staffCall(this, "GET", "/api/admin/drop-offs", null);
});

When("{string} lists the workshop drop-offs", async function (email) {
  await staffCall(this, "GET", "/api/admin/drop-offs", email);
});

When("{string} removes that drop-off", async function (email) {
  await staffCall(this, "DELETE", `/api/admin/drop-offs/${this.doId}`, email);
});

Then("the drop-offs answer is {int}", function (status) {
  assert.equal(this.doStatus, status);
});

Then("the list has the drop-off of {string}", function (brought) {
  const found = (this.doBody.dropOffs || []).find((d) => d.id === this.doId);
  assert.ok(found, "the drop-off is in the list");
  assert.equal(found.brought, brought);
});

Then("that drop-off is gone", async function () {
  const { rows } = await pool.query("SELECT 1 FROM workshop_dropoffs WHERE id = $1", [this.doId]);
  assert.equal(rows.length, 0);
});
