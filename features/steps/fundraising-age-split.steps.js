const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-age-split.feature (Jaimie, 2026-10-03): 18 or over, and sharing what is
// raised with another cause. The switch, staff accounts, approving, giving on a page and the
// clean up of every "(bdd-fr)" fundraiser are fundraising.steps.js's; opening a page and "the page
// shows" are fundraising-pages.steps.js's and events.steps.js's. Every name here, the other cause's
// included, is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "pw-fundraising-bdd";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

async function call(world, method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function fundraiser(title) {
  const r = await pool.query(
    `SELECT id, slug, over_18, shares_with_other, nbcc_share_percent, other_cause_name
       FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1`,
    [title],
  );
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

// A raising money sign up as the form sends it, every yes or no answered.
function signUpBody(title, over) {
  return {
    path: "raising",
    kind: "walk",
    kindOther: "",
    title,
    description: "A long walk for NBCC.",
    eventDate: "",
    startTime: "",
    venue: "",
    town: "Exampleton",
    targetPence: 20000,
    public: true,
    firstName: "Sam",
    lastName: "Sample",
    email: "sam.split.fr.bdd@example.com",
    phone: "07700 900129",
    instagram: "",
    facebook: "",
    socialOk: false,
    over18: true,
    sharesWithOther: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
    newsletterOk: false,
    company: "",
    ...over,
  };
}

When("someone under 18 signs up {string}", async function (title) {
  await call(this, "POST", "/api/fundraise", signUpBody(title, { over18: false }));
});

When("someone signs up {string} sharing {int} percent with {string}", async function (title, percent, cause) {
  await call(this, "POST", "/api/fundraise", signUpBody(title, { sharesWithOther: true, nbccSharePercent: percent, otherCauseName: cause }));
});

Then("the fundraising answer names the field {string}", function (field) {
  assert.ok(this.frBody && this.frBody.fields && this.frBody.fields[field], `no message for ${field}: ${JSON.stringify(this.frBody)}`);
});

Then("no fundraiser called {string} is stored", async function (title) {
  const r = await pool.query("SELECT 1 FROM fundraisers WHERE title = $1", [title]);
  assert.equal(r.rows.length, 0);
});

Then(
  "{string} is stored as 18 or over, sharing {int} percent with {string}",
  async function (title, percent, cause) {
    const f = await fundraiser(title);
    assert.equal(f.over_18, true);
    assert.equal(f.shares_with_other, true);
    assert.equal(Number(f.nbcc_share_percent), percent);
    assert.equal(f.other_cause_name, cause);
  },
);

When("{string} corrects the split of {string} to {int} percent", async function (email, title, percent) {
  const f = await fundraiser(title);
  await call(
    this,
    "PUT",
    `/api/admin/fundraisers/${f.id}/split`,
    { sharesWithOther: true, nbccSharePercent: percent, otherCauseName: f.other_cause_name },
    await login(email),
  );
});

// Staff open a piece of the materials (src/routes/fundraise-materials.ts), read as a visitor's page
// is, so "the page shows" can check it.
When("{string} opens the {string} of {string}", async function (email, piece, title) {
  const f = await fundraiser(title);
  const res = await fetch(`${BASE_URL}/api/admin/fundraisers/${f.id}/materials/${piece}`, {
    headers: { Authorization: `Bearer ${await login(email)}` },
  });
  this.visitorStatus = res.status;
  this.visitorBody = await res.text();
  assert.equal(res.status, 200, this.visitorBody.slice(0, 200));
});

// A holding an event sign up, shown on the website, sharing what it raises.
When("someone signs up the event {string} sharing {int} percent with {string}", async function (title, percent, cause) {
  await call(
    this,
    "POST",
    "/api/fundraise",
    signUpBody(title, {
      path: "event",
      kind: "quiz",
      eventDate: "2099-11-21",
      startTime: "19:30",
      venue: "Example Village Hall",
      targetPence: null,
      cardLine: "Eight rounds and a raffle (bdd-fr).",
      booking: "free",
      sharesWithOther: true,
      nbccSharePercent: percent,
      otherCauseName: cause,
    }),
  );
});
