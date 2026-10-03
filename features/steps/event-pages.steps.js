const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for event-pages.feature: an event's own page at /event/<short name>. The fundraisers, the
// switches and staff are arranged by fundraising.steps.js and events.steps.js (whose hooks also clean
// up, as the feature carries both tags); a visitor's request, its status and "the page shows" are
// events.steps.js's, and "the visitor is sent to" and "the answer is an SVG picture" are
// fundraising-pages.steps.js's. These add only what those do not.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "pw-fundraising-bdd";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fundraiserOf(title) {
  const r = await pool.query("SELECT id, slug FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

async function token(email) {
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

async function open(world, path) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  world.visitorStatus = res.status;
  world.visitorHeaders = res.headers;
  world.visitorBody = await res.text();
}

// Staff keep the suggested short name: saving it is what lets an event be approved.
When("{string} keeps the short name of {string}", async function (email, title) {
  const f = await fundraiserOf(title);
  const res = await fetch(`${BASE_URL}/api/admin/fundraisers/${f.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(email)}` },
    body: JSON.stringify({ slug: f.slug }),
  });
  this.frStatus = res.status;
  this.frBody = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, `could not keep the short name: ${JSON.stringify(this.frBody)}`);
});

Then("the fundraising answer says {string}", function (words) {
  assert.equal(this.frBody && this.frBody.error, words);
});

When("a visitor opens the event page for {string}", async function (title) {
  await open(this, `/event/${(await fundraiserOf(title)).slug}`);
});

When("a visitor opens the event page QR code for {string}", async function (title) {
  await open(this, `/event/${(await fundraiserOf(title)).slug}/qr.svg`);
});

Then("the visitor is sent to the event page of {string}", async function (title) {
  assert.equal(this.visitorHeaders.get("location"), `/event/${(await fundraiserOf(title)).slug}`);
});

Then("the card for {string} links to its event page", async function (title) {
  const { slug } = await fundraiserOf(title);
  const body = this.visitorBody || "";
  const start = body.indexOf(`id="community-${slug}"`);
  assert.ok(start !== -1, `no card for ${title} on the page`);
  const card = body.slice(start, body.indexOf("</article></div></li>", start));
  assert.ok(card.includes(`href="/event/${slug}"`), `the card for ${title} does not link to /event/${slug}`);
});
