const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for events.feature (TASK-453). Arranges events and the page switch directly in the
// database, then reads the public pages and the admin API over HTTP like the other @db features.
//
// Every event made here carries "(bdd-events)" in its name and every staff account ends
// "events.bdd@example.com", so each scenario starts and ends clean. The switch is put back OFF
// afterwards: other features read page menus and the site map, and must see the site as shipped.
//
// Dates are worked out from today in UK time rather than written down, so these scenarios do not
// start failing once the real events on the page have happened.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MARK = "%(bdd-events)%";
const STAFF = "%events.bdd@example.com";
const PASSWORD = "pw-events-bdd";

function londonDate(daysFromNow) {
  const at = new Date(Date.now() + daysFromNow * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(at);
}

function slugFor(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") +
    "-" +
    randomBytes(3).toString("hex")
  );
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

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

async function adminCall(world, email, method, path, body) {
  const token = await login(email);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.eventsAdminStatus = res.status;
  world.eventsAdminBody = await res.json().catch(() => ({}));
  return world.eventsAdminBody;
}

// A complete event as the admin form sends it, with whatever the scenario changes.
function formEvent(over = {}) {
  return {
    name: "An event (bdd-events)",
    subtitle: "",
    gist: "Something good happening for NBCC.",
    date: londonDate(30),
    start: "19:00",
    end: "",
    timeTbc: false,
    venue: "Annbank Village Hall",
    town: "Annbank",
    address: "",
    access: [],
    imageSrc: "",
    imageFit: "cover",
    imageGround: "night",
    imageAlt: "",
    cover: "crimson",
    costFront: "Free",
    costBack: "",
    flag: "",
    listHeading: "",
    whatsOn: "",
    note: "",
    runBy: "nbcc",
    partnerName: "",
    partnerFront: "Organised by",
    partnerCredit: "Organised by",
    partnerLogoSrc: "",
    partnerLine: "",
    bookingHow: "none",
    bookingUrl: "",
    bookingLabel: "",
    bookingNote: "",
    status: "draft",
    showFrom: "",
    ...over,
  };
}

async function insertEvent({ name, date, status = "live", showFrom = null }) {
  await pool.query(
    `INSERT INTO events (slug, name, gist, event_date, venue, town, booking_how, status, show_from, created_by, updated_by)
     VALUES ($1, $2, 'A test event.', $3, 'Annbank Village Hall', 'Annbank', 'none', $4, $5, 'bdd', 'bdd')`,
    [slugFor(name), name, date, status, showFrom],
  );
}

async function setSwitch(on) {
  await pool.query("UPDATE events_settings SET page_on = $1 WHERE id = 1", [on]);
}

async function clean() {
  await pool.query("DELETE FROM events WHERE name LIKE $1", [MARK]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [STAFF]);
  await setSwitch(false);
}

Before({ tags: "@events" }, clean);
After({ tags: "@events" }, clean);

const navList = (html) => (html.match(/<ul[^>]*class="nav-links"[\s\S]*?<\/ul>/i) || [""])[0];

// ---- arranging ----

Given("the events page is switched off", async function () {
  await setSwitch(false);
});

Given("the events page is switched on", async function () {
  await setSwitch(true);
});

Given("a live event {string} {int} days from now", async function (name, days) {
  await insertEvent({ name, date: londonDate(days) });
});

Given("a draft event {string} {int} days from now", async function (name, days) {
  await insertEvent({ name, date: londonDate(days), status: "draft" });
});

Given("a live event {string} {int} day ago", async function (name, days) {
  await insertEvent({ name, date: londonDate(-days) });
});

Given(
  "an event {string} {int} days from now scheduled to go up in {int} days",
  async function (name, days, upIn) {
    await insertEvent({ name, date: londonDate(days), status: "scheduled", showFrom: londonDate(upIn) });
  },
);

Given("an event {string} {int} days from now scheduled to go up today", async function (name, days) {
  await insertEvent({ name, date: londonDate(days), status: "scheduled", showFrom: londonDate(0) });
});

Given("an events staff member {string} with role {string}", async function (email, role) {
  await pool.query(
    "INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'Events Staff', $2, $3)",
    [email, role, hashPassword(PASSWORD)],
  );
});

// ---- the public side ----

When("a visitor opens {string}", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  this.visitorStatus = res.status;
  this.visitorHeaders = res.headers;
  this.visitorBody = await res.text();
});

When("a visitor opens the uploaded picture", async function () {
  const res = await fetch(`${BASE_URL}${this.uploadedSrc}`);
  this.visitorStatus = res.status;
  this.visitorHeaders = res.headers;
  this.visitorBody = await res.text();
});

Then("the visitor gets status {int}", function (status) {
  assert.equal(this.visitorStatus, status);
});

Then("the menu does not offer Events", function () {
  const nav = navList(this.visitorBody);
  assert.ok(nav.length > 0, "no nav list on the page");
  assert.ok(!nav.includes('href="/events"'), "the menu offered a page that is switched off");
});

Then("the menu offers Events straight after About", function () {
  const nav = navList(this.visitorBody);
  const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const about = hrefs.indexOf("/about-us");
  assert.ok(about !== -1, `no About item in the menu: ${hrefs.join(" ")}`);
  assert.equal(hrefs[about + 1], "/events", `Events did not follow About: ${hrefs.join(" ")}`);
});

Then("the site map does not list the events page", function () {
  assert.ok(!this.visitorBody.includes("/events</loc>"), "sitemap.xml listed a switched off page");
});

Then("the site map lists the events page", function () {
  assert.ok(this.visitorBody.includes("/events</loc>"), "sitemap.xml did not list the events page");
});

Then("{string} comes before {string} on the page", function (first, second) {
  const a = this.visitorBody.indexOf(first);
  const b = this.visitorBody.indexOf(second);
  assert.ok(a !== -1, `"${first}" is not on the page`);
  assert.ok(b !== -1, `"${second}" is not on the page`);
  assert.ok(a < b, `"${first}" should come before "${second}"`);
});

Then("the last card on the page is the face down card", function () {
  const cards = [...this.visitorBody.matchAll(/<li class="(ev-card[^"]*)"/g)].map((m) => m[1]);
  assert.ok(cards.length > 0, "no cards on the page");
  assert.equal(cards[cards.length - 1], "ev-card ev-card--more");
});

Then("the page shows {string}", function (text) {
  assert.ok(this.visitorBody.includes(text), `"${text}" is not on the page`);
});

Then("the page does not show {string}", function (text) {
  assert.ok(!this.visitorBody.includes(text), `"${text}" should not be on the page`);
});

Then("the picture is served as {string} and never sniffed", function (mime) {
  assert.equal(this.visitorHeaders.get("content-type"), mime);
  assert.equal(this.visitorHeaders.get("x-content-type-options"), "nosniff");
});

// ---- the admin side ----

When("I list the admin events without a session", async function () {
  const res = await fetch(`${BASE_URL}/api/admin/events`);
  this.eventsAdminStatus = res.status;
  this.eventsAdminBody = await res.json().catch(() => ({}));
});

Then("the events admin status should be {int}", function (status) {
  assert.equal(this.eventsAdminStatus, status, JSON.stringify(this.eventsAdminBody));
});

When(
  "{string} saves a new draft event {string} {int} days from now",
  async function (email, name, days) {
    const body = await adminCall(this, email, "POST", "/api/admin/events", formEvent({ name, date: londonDate(days) }));
    this.eventId = body.event && body.event.id;
  },
);

When("{string} renames that event to {string}", async function (email, name) {
  await adminCall(this, email, "PUT", `/api/admin/events/${this.eventId}`, formEvent({ name }));
});

When("{string} deletes that event", async function (email) {
  await adminCall(this, email, "DELETE", `/api/admin/events/${this.eventId}`);
});

When("{string} switches the events page on", async function (email) {
  await adminCall(this, email, "PATCH", "/api/admin/events/settings", { pageOn: true });
});

When("{string} saves an event booking elsewhere at {string}", async function (email, url) {
  await adminCall(this, email, "POST", "/api/admin/events", formEvent({ bookingHow: "away", bookingUrl: url }));
});

When("{string} publishes an event with no gist or venue", async function (email) {
  await adminCall(this, email, "POST", "/api/admin/events", formEvent({ gist: "", venue: "", status: "live" }));
});

When("{string} saves an event with no gist or venue as a draft", async function (email) {
  await adminCall(this, email, "POST", "/api/admin/events", formEvent({ gist: "", venue: "", status: "draft" }));
});

When("{string} previews an event called {string}", async function (email, name) {
  await adminCall(this, email, "POST", "/api/admin/events/preview", { event: formEvent({ name }) });
});

When("{string} uploads a text file as an event picture", async function (email) {
  await adminCall(this, email, "POST", "/api/admin/event-images", {
    mime: "text/plain",
    dataBase64: Buffer.from("not a picture").toString("base64"),
  });
});

// The smallest valid PNG: one transparent pixel.
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

When("{string} uploads a small PNG as an event picture", async function (email) {
  const body = await adminCall(this, email, "POST", "/api/admin/event-images", {
    mime: "image/png",
    dataBase64: ONE_PIXEL_PNG,
  });
  this.uploadedSrc = body.src;
});

Then("the refusal names the field {string}", function (field) {
  const fields = this.eventsAdminBody.fields || {};
  assert.ok(field in fields, `expected "${field}" in ${JSON.stringify(fields)}`);
});

Then("the refusal says {string}", function (message) {
  const problems = this.eventsAdminBody.problems || [];
  assert.ok(problems.includes(message), `expected "${message}" in ${JSON.stringify(problems)}`);
});

Then("the preview card shows {string}", function (text) {
  assert.ok(String(this.eventsAdminBody.card || "").includes(text), "the preview card did not show the event");
  assert.ok(String(this.eventsAdminBody.card || "").startsWith("<!doctype html>"), "the preview is not a whole document");
});

Then(
  "the audit log records {string} for {string} by {string}",
  async function (action, name, email) {
    const r = await pool.query(
      `SELECT actor FROM audit_log WHERE action = $1 AND data->>'name' = $2 ORDER BY id DESC LIMIT 1`,
      [action, name],
    );
    assert.equal(r.rows.length, 1, `no ${action} audit row for "${name}"`);
    assert.equal(r.rows[0].actor, `admin:${email}`);
  },
);

Then("the audit log records the page being switched on by {string}", async function (email) {
  const r = await pool.query(
    `SELECT actor, data FROM audit_log WHERE action = 'events.page_switched' ORDER BY id DESC LIMIT 1`,
  );
  assert.equal(r.rows.length, 1, "no page switch audit row");
  assert.equal(r.rows[0].actor, `admin:${email}`);
  assert.equal(r.rows[0].data.pageOn, true);
});
