const { Given, When, Then, Before } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for site-pages.feature. Reuses the newsletter steps' admin Given (seeds a user + logs
// in, leaving this.token); requests are made with redirect: "manual" so a spare address's 301
// is asserted directly rather than silently followed.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Re-runnable on a lived-in local DB: this feature's own aliases and overrides are cleared
// before each scenario. The seeded day-one aliases are left alone — they are what the
// spare-address scenario asserts.
Before({ tags: "@site-pages" }, async function () {
  await pool.query("DELETE FROM site_aliases WHERE from_path IN ('/festive', '/blocked')");
  await pool.query("DELETE FROM site_page_seo WHERE page_path = '/about-us'");
  await pool.query("DELETE FROM users WHERE email LIKE 'site.%.bdd@example.com'");
});

When("I request the site path {string}", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  this.siteStatus = res.status;
  this.siteLocation = res.headers.get("location");
  this.siteRobots = res.headers.get("x-robots-tag");
  this.siteBody = await res.text();
});

Then("the site response status should be {int}", function (expected) {
  assert.equal(this.siteStatus, expected);
});

Then("the site response should contain {string}", function (needle) {
  assert.ok(this.siteBody.includes(needle), `expected the response to contain "${needle}"`);
});

Then("the site response should not contain {string}", function (needle) {
  assert.ok(!this.siteBody.includes(needle), `expected the response NOT to contain "${needle}"`);
});

Then("the site response should be JSON with error {string}", function (message) {
  const body = JSON.parse(this.siteBody);
  assert.equal(body.error, message);
});

Then("the site response should redirect permanently to {string}", function (target) {
  assert.equal(this.siteStatus, 301, `expected a 301, got ${this.siteStatus}`);
  assert.equal(this.siteLocation, target);
});

Then("the site response noindex header should be set", function () {
  assert.match(String(this.siteRobots), /noindex/);
});

When("I add a spare address {string} pointing at {string}", async function (from, to) {
  const res = await fetch(`${BASE_URL}/api/admin/site-aliases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
    body: JSON.stringify({ from, to }),
  });
  this.sitePagesStatus = res.status;
});

Then("the site pages response status should be {int}", function (expected) {
  assert.equal(this.sitePagesStatus, expected);
});

When("I set the search visibility of {string} to hidden", async function (path) {
  await setSeo(this.token, path, false);
});

When("I set the search visibility of {string} to shown", async function (path) {
  await setSeo(this.token, path, true);
});

async function setSeo(token, path, listed) {
  const res = await fetch(`${BASE_URL}/api/admin/site-seo`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path, listed }),
  });
  assert.equal(res.status, 200, "expected the visibility change to save");
}
