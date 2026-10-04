const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-all-emails.feature: the list of every fundraising and events email in
// Admin > Fundraising, one email opened, and the sign off of the few that are approval gated (done
// through the endpoint the list points at, which is the one that already existed).
// The shared fundraising steps (staff, "the fundraising answer is") are in fundraising.steps.js,
// whose @fundraising hooks clear the staff made here. This file keeps the wording sign offs as it
// found them: whatever was approved before a scenario is approved again after it.
// Every step here says "All emails", so none can be mistaken for another feature's.
// Addresses end "allemails.fr.bdd@example.com". Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "pw-fundraising-bdd";

const GROUPS = [
  "Signing up and approval",
  "Invites from staff",
  "Teams",
  "Keeping in touch (automatic)",
  "Finishing and paying in",
  "In memory",
  "Sponsor pledges",
  "Event pages and tickets",
  "The Festive Ball",
  "Staff notices",
];

let kept = null;

Before({ tags: "@all-emails" }, async function () {
  kept = (await pool.query("SELECT key, approved_at, approved_by FROM touch_wording_approvals")).rows;
});

After({ tags: "@all-emails" }, async function () {
  if (!kept) return;
  await pool.query("DELETE FROM touch_wording_approvals");
  for (const r of kept) {
    await pool.query("INSERT INTO touch_wording_approvals (key, approved_at, approved_by) VALUES ($1, $2, $3)", [r.key, r.approved_at, r.approved_by]);
  }
  kept = null;
});

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
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

// The answer is kept where "the fundraising answer is" reads it.
async function call(world, email, method, urlPath) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers.Authorization = `Bearer ${await login(email)}`;
  const res = await fetch(`${BASE_URL}${urlPath}`, { method, headers });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

const emailsOf = (list) => (list.groups || []).flatMap((g) => g.emails || []);
function rowOf(world, id) {
  assert.ok(world.allEmailsList, "the All emails list has not been read");
  const row = emailsOf(world.allEmailsList).find((e) => e.id === id);
  assert.ok(row, `no email "${id}" in the All emails list`);
  return row;
}

// ---- arranging ----

Given("the All emails wording {string} is waiting for sign off", async function (key) {
  await pool.query("DELETE FROM touch_wording_approvals WHERE key = $1", [key]);
});

Given("the All emails wording {string} is signed off", async function (key) {
  await pool.query("INSERT INTO touch_wording_approvals (key, approved_by) VALUES ($1, 'bdd') ON CONFLICT (key) DO NOTHING", [key]);
});

// ---- acting ----

When("someone who is not signed in asks for the All emails list", async function () {
  await call(this, null, "GET", "/api/admin/fundraising/emails");
});

When("{string} reads the All emails list", async function (email) {
  this.allEmailsList = await call(this, email, "GET", "/api/admin/fundraising/emails");
});

When("{string} reads the All emails count", async function (email) {
  await call(this, email, "GET", "/api/admin/fundraising/emails/summary");
});

When("{string} opens the All emails email {string} in its {string} version", async function (email, id, version) {
  await call(this, email, "GET", `/api/admin/fundraising/emails/${encodeURIComponent(id)}/${encodeURIComponent(version)}`);
});

When("{string} approves the All emails email {string} where the list says to", async function (email, id) {
  const gated = rowOf(this, id).versions.find((v) => v.approval);
  assert.ok(gated, `"${id}" has no sign off in the All emails list`);
  await call(this, email, "POST", gated.approval.path);
});

// ---- checking ----

Then("the All emails list has its ten groups in order", function () {
  assert.deepEqual(this.frBody.groups.map((g) => g.name), GROUPS);
  for (const g of this.frBody.groups) assert.ok(g.emails.length > 0, `${g.name} is empty`);
});

Then("the All emails list has as many emails as it says, each with a name, a subject and who gets it", function () {
  const all = emailsOf(this.frBody);
  assert.equal(all.length, this.frBody.count);
  assert.ok(all.length >= 69, `only ${all.length} emails`);
  assert.equal(new Set(all.map((e) => e.id)).size, all.length, "an email is listed twice");
  for (const e of all) {
    assert.ok(e.name && e.subject && e.who, `${e.id} is missing its name, subject or who gets it`);
    assert.ok(e.versions.length > 0, `${e.id} has no version`);
  }
});

Then("the All emails list carries no email itself", function () {
  const text = JSON.stringify(this.frBody);
  assert.ok(!/<table|<html|<body/i.test(text), "the list carries an email's HTML");
});

Then("the All emails count matches the list", function () {
  assert.equal(this.frBody.count, this.allEmailsList.count);
  assert.equal(this.frBody.waiting, this.allEmailsList.waiting);
  assert.equal(this.frBody.waiting, emailsOf(this.allEmailsList).filter((e) => e.state === "waiting").length);
});

Then("the All emails email has a subject and shows only invented people", function () {
  assert.ok(this.frBody.subject, "no subject");
  assert.ok(/<table/i.test(this.frBody.html), "no email was rendered");
  const addresses = this.frBody.html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const strangers = addresses.filter((a) => !/@(example\.com|nbcc\.scot)$/i.test(a));
  assert.deepEqual(strangers, []);
});

Then("the All emails email has no sign off", function () {
  assert.equal(this.frBody.approval, null);
});

Then("the All emails email was approved by {string}", function (email) {
  assert.ok(this.frBody.approval, "it has no sign off");
  assert.equal(this.frBody.approval.approvedBy, `admin:${email}`);
  assert.ok(this.frBody.approval.approvedAt, "it is not approved");
});

Then("All emails says {string} is {string}", function (id, state) {
  assert.equal(rowOf(this, id).state, state);
});

Then("All emails says {string} has no sign off", function (id) {
  const row = rowOf(this, id);
  assert.equal(row.state, null);
  assert.ok(row.versions.every((v) => v.approval === null));
});

Then("All emails says the version of {string} that is waiting is {string}", function (id, version) {
  assert.equal(rowOf(this, id).waitingVersion, version);
});
