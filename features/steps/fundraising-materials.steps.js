const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-materials.feature (TASK-504). The fundraisers, the switch, signing in and
// the clean up are fundraising.steps.js's and fundraising-private.steps.js's; the visitor steps are
// events.steps.js's. Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

When("the signed in organiser opens the {string} for {string}", async function (piece, title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  const headers = this.frSession ? { Cookie: `nbcc_fr_session=${this.frSession}` } : {};
  const res = await fetch(`${BASE_URL}/api/fundraise/manage/fundraisers/${r.rows[0].id}/materials/${piece}`, { headers });
  this.matStatus = res.status;
  this.matHeaders = res.headers;
  this.matBody = await res.text();
});

Then("the materials answer is {int}", function (status) {
  assert.equal(this.matStatus, status);
});

Then("the materials page shows {string}", function (text) {
  assert.ok(this.matBody.includes(text), `the page does not show ${text}`);
});

Then("the materials page is never kept or indexed", function () {
  assert.equal(this.matHeaders.get("cache-control"), "no-store");
  assert.equal(this.matHeaders.get("x-robots-tag"), "noindex, nofollow");
});
