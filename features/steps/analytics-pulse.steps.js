const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");

// Steps for analytics-pulse.feature (TASK-479). The switch is set directly in the database (its
// admin screen is TASK-482), events are posted to /api/pulse as pulse.js would send them, and what
// was kept is read back from the tables.
//
// Every view id made here starts "bdd0", so each scenario starts and ends clean, and the switch is
// put back OFF afterwards: the site ships with collecting off. Addresses and browsers are invented
// (203.0.113.0/24 is set aside for documentation). Outside production the app reads the switch on
// every event rather than remembering it for 30 seconds, so a change here is seen at once.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VISITOR_IP = "203.0.113.47";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

async function setCollecting(on) {
  await pool.query("UPDATE analytics_settings SET collecting = $1, updated_by = 'bdd' WHERE id = 1", [on]);
}

async function clean() {
  await pool.query("DELETE FROM analytics_clicks WHERE view_id LIKE 'bdd0%'");
  await pool.query("DELETE FROM analytics_views WHERE view_id LIKE 'bdd0%'");
  await setCollecting(false);
}

Before({ tags: "@analytics" }, async function () {
  await clean();
  this.viewId = "bdd0" + randomBytes(6).toString("hex");
});
After({ tags: "@analytics" }, clean);

// As a browser on one of our own pages sends it. The server drops events from anywhere else.
const OUR_PAGE = { "sec-fetch-site": "same-origin", origin: BASE_URL };
const ANOTHER_SITE = { "sec-fetch-site": "cross-site", origin: "https://elsewhere.example.com" };

async function pulse(world, body, userAgent = BROWSER, from = OUR_PAGE) {
  const res = await fetch(`${BASE_URL}/api/pulse`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": userAgent, "x-forwarded-for": VISITOR_IP, ...from },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  world.pulseStatus = res.status;
  world.pulseBody = await res.text();
}

async function keptView(world) {
  const r = await pool.query("SELECT * FROM analytics_views WHERE view_id = $1", [world.viewId]);
  return r.rows[0];
}

async function keptClicks(world) {
  const r = await pool.query("SELECT * FROM analytics_clicks WHERE view_id = $1 ORDER BY id", [world.viewId]);
  return r.rows;
}

// ---- arranging ----

Given("site analytics collecting is switched {word}", async function (state) {
  assert.ok(state === "on" || state === "off", `on or off, not ${state}`);
  await setCollecting(state === "on");
});

// ---- acting ----

When("a visitor opens the page {string}", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`);
  this.pageHtml = await res.text();
});

When("a visitor's browser sends a page view of {string}", async function (path) {
  await pulse(this, { t: "view", v: this.viewId, p: path, r: "", u: {}, w: 1280 });
});

When("a visitor's browser sends a page view of {string} from {string}", async function (path, referrer) {
  await pulse(this, { t: "view", v: this.viewId, p: path, r: referrer, u: {}, w: 1280 });
});

// TASK-492: as pulse.js sends it for a link tagged utm_medium=qr&utm_campaign=<the page's slug>.
When("a visitor scans the QR code for the page {string}", async function (path) {
  const slug = path.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "home";
  await pulse(this, { t: "view", v: this.viewId, p: path, r: "", u: { m: "qr", c: slug }, w: 390 });
});

When("a bot sends a page view of {string}", async function (path) {
  await pulse(this, { t: "view", v: this.viewId, p: path, r: "", u: {}, w: 1280 }, BOT);
});

When("another website makes a visitor's browser send a page view of {string}", async function (path) {
  await pulse(this, { t: "view", v: this.viewId, p: path, r: "", u: {}, w: 1280 }, BROWSER, ANOTHER_SITE);
});

When("the browser sends a leave after {int} seconds, scrolled {int} percent", async function (seconds, percent) {
  await pulse(this, { t: "leave", v: this.viewId, a: seconds, s: percent });
});

When("the browser sends a click on a link to {string}", async function (host) {
  await pulse(this, { t: "click", v: this.viewId, k: "outbound", l: host });
});

When("a browser sends {int} bytes of nonsense to the pulse", async function (bytes) {
  await pulse(this, "x".repeat(bytes));
});

// ---- checking ----

Then("the page loads the visit counter", function () {
  assert.match(this.pageHtml, /<script defer src="\/assets\/js\/pulse\.js"><\/script>/);
});

Then("the pulse answer is 204 with nothing in it", function () {
  assert.equal(this.pulseStatus, 204);
  assert.equal(this.pulseBody, "");
});

Then("no page view was kept", async function () {
  assert.equal(await keptView(this), undefined);
});

Then("the page view was kept with the path {string}", async function (path) {
  const view = await keptView(this);
  assert.ok(view, "no page view was kept");
  assert.equal(view.path, path);
});

Then("the kept page view came from {string} via {string}", async function (channel, source) {
  const view = await keptView(this);
  assert.equal(view.channel, channel);
  assert.equal(view.source, source);
});

// The channel check on analytics_views had to be widened for this (migration 1791200000030).
Then("the kept page view came from a QR code for {string}", async function (campaign) {
  const view = await keptView(this);
  assert.ok(view, "no page view was kept");
  assert.equal(view.channel, "qr");
  assert.equal(view.campaign, campaign);
});

Then("nothing kept holds the visitor's IP address or browser", async function () {
  const kept = JSON.stringify([await keptView(this), await keptClicks(this)]);
  assert.ok(!kept.includes(VISITOR_IP), "the IP address was stored");
  assert.ok(!kept.includes("203.0.113"), "part of the IP address was stored");
  assert.ok(!kept.includes("Macintosh"), "the user agent was stored");
});

Then("nothing kept mentions {string}", async function (text) {
  const kept = JSON.stringify([await keptView(this), await keptClicks(this)]);
  assert.ok(!kept.includes(text), `"${text}" was stored`);
});

Then("the kept page view spent {int} seconds and was read {int} percent of the way down", async function (seconds, percent) {
  const view = await keptView(this);
  assert.equal(view.active_seconds, seconds);
  assert.equal(view.max_scroll, percent);
});

Then("one {string} click was kept, labelled {string}", async function (kind, label) {
  const clicks = await keptClicks(this);
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].kind, kind);
  assert.equal(clicks[0].label, label);
});

AfterAll(async function () {
  await pool.end();
});
