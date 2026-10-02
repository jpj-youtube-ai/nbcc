const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-pages.feature (TASK-494). The fundraisers and both switches are arranged by
// the steps in fundraising.steps.js and events.steps.js (whose Before and After hooks also clean up,
// as the feature carries both tags); a visitor's request and its status are events.steps.js's. These
// add only what those do not: opening a fundraiser's page or QR code by its title, and reading
// headers.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function slugOf(title) {
  const r = await pool.query("SELECT slug FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].slug;
}

async function open(world, path) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  world.visitorStatus = res.status;
  world.visitorHeaders = res.headers;
  world.visitorBody = await res.text();
}

When("a visitor opens the page for {string}", async function (title) {
  await open(this, `/fundraise/${await slugOf(title)}`);
});

When("a visitor opens the QR code for {string}", async function (title) {
  await open(this, `/fundraise/${await slugOf(title)}/qr.svg`);
});

Then("the visitor is sent to {string}", function (location) {
  assert.equal(this.visitorHeaders.get("location"), location);
});

Then("the answer is an SVG picture", function () {
  assert.match(this.visitorHeaders.get("content-type") || "", /^image\/svg\+xml/);
  assert.ok(this.visitorBody.startsWith("<svg"), "not an SVG");
});

Then("the page is kept out of search engines", function () {
  assert.equal(this.visitorHeaders.get("x-robots-tag"), "noindex, nofollow");
  assert.ok(this.visitorBody.includes('<meta name="robots" content="noindex, nofollow" />'), "no robots meta");
});
