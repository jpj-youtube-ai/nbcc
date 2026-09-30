const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for analytics-admin.feature (TASK-482). Drives /api/admin/analytics over HTTP and checks the
// main database. The staff come from the shared @admin steps (their addresses end
// "admin.bdd@example.com", which the @admin hooks remove). The @analytics hooks put the switch back
// OFF around each scenario, as the site ships. Every page view seeded here has a view id starting
// "bdd1" and an invented visitor, website and town, and is removed before and after.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "analytics-pw-123";

async function clean() {
  await pool.query("DELETE FROM analytics_views WHERE view_id LIKE 'bdd1%'");
}
Before({ tags: "@analytics-admin" }, clean);
After({ tags: "@analytics-admin" }, clean);
AfterAll(async function () {
  await pool.end();
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

async function call(world, token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.analyticsStatus = res.status;
  world.analyticsBody = await res.json().catch(() => ({}));
  return world.analyticsBody;
}

const onOff = (word) => {
  assert.ok(word === "on" || word === "off", `on or off, not ${word}`);
  return word === "on";
};

// ---- the permission and the switch ----

When("I read the analytics without a session", async function () {
  await call(this, null, "GET", "/api/admin/analytics?days=30");
});

When("{string} reads the analytics for {int} days", async function (email, days) {
  await call(this, await login(email), "GET", `/api/admin/analytics?days=${days}`);
});

When("{string} switches counting {string}", async function (email, word) {
  await call(this, await login(email), "PUT", "/api/admin/analytics/settings", { collecting: onOff(word) });
});

Then("the analytics answer is {int}", function (status) {
  assert.equal(this.analyticsStatus, status, JSON.stringify(this.analyticsBody));
});

Then("{string} sees counting is {string}", async function (email, word) {
  const settings = await call(this, await login(email), "GET", "/api/admin/analytics/settings");
  assert.equal(this.analyticsStatus, 200);
  assert.equal(settings.collecting, onOff(word));
});

Then("the audit log records counting switched {string} by {string}", async function (word, email) {
  const r = await pool.query(
    `SELECT data FROM audit_log
      WHERE action = 'analytics.collecting_switched' AND actor = $1
      ORDER BY id DESC LIMIT 1`,
    [`admin:${email}`],
  );
  assert.equal(r.rows.length, 1, "no audit row for the switch");
  assert.equal(r.rows[0].data.collecting, onOff(word));
});

// ---- the numbers ----

Given("{string} has read the analytics for {int} days", async function (email, days) {
  this.analyticsBefore = await call(this, await login(email), "GET", `/api/admin/analytics?days=${days}`);
  assert.equal(this.analyticsStatus, 200);
});

// Visitor A: two views ten minutes apart, then one more 48 minutes later (a second visit).
// Visitor B: one view. Both arrived from an invented website, from an invented town.
When("two invented visitors' page views from today are stored", async function () {
  const rows = [
    ["bdd1a1", "bdd1visitora", "/", 60],
    ["bdd1a2", "bdd1visitora", "/donate", 50],
    ["bdd1a3", "bdd1visitora", "/events", 2],
    ["bdd1b1", "bdd1visitorb", "/", 20],
  ];
  for (const [viewId, visitor, path, minutesAgo] of rows) {
    await pool.query(
      `INSERT INTO analytics_views
         (view_id, at, day, path, visitor, channel, source, campaign, country, region, city, device, browser, os)
       VALUES ($1, now() - make_interval(mins => $2), (now() AT TIME ZONE 'Europe/London')::date, $3, $4,
               'other_websites', 'bdd-site.example', NULL, 'GB', 'Scotland', 'Bddtown', 'phone', 'Safari', 'iOS')`,
      [viewId, minutesAgo, path, visitor],
    );
  }
});

Then(
  "today's figures grew by {int} visitors, {int} visits and {int} page views",
  function (visitors, visits, views) {
    const before = this.analyticsBefore.current.headline;
    const after = this.analyticsBody.current.headline;
    assert.equal(after.visitors - before.visitors, visitors, "visitors");
    assert.equal(after.visits - before.visits, visits, "visits");
    assert.equal(after.views - before.views, views, "page views");
  },
);

Then("{string} brought {int} visits", function (source, visits) {
  const row = this.analyticsBody.current.otherWebsites.find((r) => r.source === source);
  assert.ok(row, `${source} is not among the other websites`);
  assert.equal(row.visits, visits);
});

Then("{string} had {int} visitors", function (city, visitors) {
  const row = this.analyticsBody.current.cities.find((r) => r.city === city);
  assert.ok(row, `${city} is not among the towns`);
  assert.equal(row.visitors, visitors);
});

Then("someone is on the website right now", function () {
  assert.ok(this.analyticsBody.rightNow >= 1, `right now was ${this.analyticsBody.rightNow}`);
});
