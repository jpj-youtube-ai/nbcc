const { When, Then, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for impact-examples.feature. The staff, the switch and the fundraisers come from
// fundraising.steps.js (its @fundraising hooks clear them). This file adds examples through the admin
// API and reads a fundraiser's page over HTTP. Afterwards each example a scenario added is switched
// off through the API first, so the server reads its list again at once and none can linger in its
// cache into a later scenario, and only then removed (the five seeded ones are never touched). This
// After hook is defined after fundraising.steps.js's, so it runs before it, while the admin who added
// them still exists. Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "pw-fundraising-bdd";
const ADDED_BY = "admin:%impact.fr.bdd@example.com";

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

const unescape = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

async function pageOf(title) {
  const r = await pool.query("SELECT slug FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  const res = await fetch(`${BASE_URL}/fundraise/${r.rows[0].slug}`);
  assert.equal(res.status, 200);
  return res.text();
}

After({ tags: "@impact" }, async function () {
  for (const id of this.impactAdded || []) {
    await fetch(`${BASE_URL}/api/admin/impact-examples/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.impactToken}` },
      body: JSON.stringify({ active: false }),
    }).catch(() => undefined);
  }
  await pool.query("DELETE FROM impact_examples WHERE created_by LIKE $1", [ADDED_BY]);
});

When("{string} adds the impact example of {int} pence {string}", async function (email, amountPence, wording) {
  const token = await login(email);
  const res = await fetch(`${BASE_URL}/api/admin/impact-examples`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ amountPence, wording }),
  });
  this.impactStatus = res.status;
  this.impactBody = await res.json().catch(() => ({}));
  if (res.status === 201 && this.impactBody.example) {
    this.impactToken = token;
    this.impactAdded = [...(this.impactAdded || []), this.impactBody.example.id];
  }
});

Then("the impact example answer is {int}", function (status) {
  assert.equal(this.impactStatus, status, JSON.stringify(this.impactBody));
});

Then("the page of {string} shows {string} under its give amounts", async function (title, wording) {
  const html = await pageOf(title);
  const lines = [...html.matchAll(/<span class="fr-amount__could">([^<]*)<\/span>/g)].map((m) => unescape(m[1]));
  assert.ok(lines.includes(wording), `the give amounts say ${JSON.stringify(lines)}`);
});

Then("the page of {string} shows the footnote {string}", async function (title, footnote) {
  const html = await pageOf(title);
  assert.ok(unescape(html).includes(footnote), "no footnote on the page");
});

Then("adding the impact example is in audit_log by {string}", async function (actor) {
  const r = await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'impact.example_added' AND actor = $1", [actor]);
  assert.ok(r.rows[0].n >= 1, `no impact.example_added by ${actor}`);
});

Then("there is no impact example saying {string}", async function (wording) {
  const r = await pool.query("SELECT count(*)::int AS n FROM impact_examples WHERE wording = $1", [wording]);
  assert.equal(r.rows[0].n, 0);
});
