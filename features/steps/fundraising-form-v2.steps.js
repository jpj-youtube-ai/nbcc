const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");

// Steps for fundraising-form-v2.feature (TASK-511). The switch, staff accounts, approved fundraisers
// and approving are fundraising.steps.js's (whose Before and After hooks clean every "(bdd-fr)"
// fundraiser, and with it the old page links it had: fundraiser_slug_history goes with its
// fundraiser); a visitor's request and its status are events.steps.js's and fundraising-pages
// .steps.js's. These add the round two sign up, and changing a page link and opening the old one.
// Every name and address is invented.

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
    `SELECT id, slug, organiser_name, first_name, last_name, kind_other, instagram, facebook, social_link, wants
       FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1`,
    [title],
  );
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

When("someone signs up {string} with the round two answers", async function (title) {
  await call(this, "POST", "/api/fundraise", {
    path: "raising",
    kind: "other",
    kindOther: "A sponsored silence",
    title,
    description: "Not a word for a whole day, for NBCC.",
    eventDate: "",
    startTime: "",
    venue: "",
    town: "Exampleton",
    targetPence: 20000,
    public: true,
    firstName: "Sam",
    lastName: "Sample",
    email: "sam.v2.fr.bdd@example.com",
    phone: "07700 900127",
    instagram: "@sam.dashes",
    facebook: "facebook.com/samdashes",
    socialOk: true,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 25, shoutOut: true, attend: false },
    postLine1: "1 Example Road",
    postLine2: "",
    postTown: "Exampleton",
    postPostcode: "EX1 1EX",
    newsletterOk: false,
    company: "",
  });
});

Then("the fundraiser {string} has the short page link {string}", async function (title, slug) {
  assert.equal((await fundraiser(title)).slug, slug);
});

Then("the fundraiser {string} is stored with the round two answers", async function (title) {
  const f = await fundraiser(title);
  assert.equal(f.first_name, "Sam");
  assert.equal(f.last_name, "Sample");
  assert.equal(f.organiser_name, "Sam Sample");
  assert.equal(f.kind_other, "A sponsored silence");
  assert.equal(f.instagram, "https://www.instagram.com/sam.dashes");
  assert.equal(f.facebook, "https://www.facebook.com/samdashes");
  assert.equal(f.social_link, "https://www.facebook.com/samdashes");
  assert.equal(f.wants.qrCount, 25);
  assert.equal(f.wants.shoutOut, true);
});

When("{string} gives {string} a new page link", async function (staff, title) {
  const f = await fundraiser(title);
  this.oldSlugs = { ...(this.oldSlugs || {}), [title]: f.slug };
  const next = `kcw${randomBytes(3).toString("hex")}`;
  await call(this, "PATCH", `/api/admin/fundraisers/${f.id}`, { slug: next }, await login(staff));
});

When("a visitor opens the old page link of {string} with {string}", async function (title, query) {
  const res = await fetch(`${BASE_URL}/fundraise/${this.oldSlugs[title]}${query}`, { redirect: "manual" });
  this.visitorStatus = res.status;
  this.visitorHeaders = res.headers;
  this.visitorBody = await res.text();
});

Then("the visitor is sent to the new page link of {string} with {string}", async function (title, query) {
  const f = await fundraiser(title);
  assert.notEqual(f.slug, this.oldSlugs[title]);
  assert.equal(this.visitorHeaders.get("location"), `/fundraise/${f.slug}${query}`);
});

When("{string} gives {string} the old page link of {string}", async function (staff, title, other) {
  const f = await fundraiser(title);
  await call(this, "PATCH", `/api/admin/fundraisers/${f.id}`, { slug: this.oldSlugs[other] }, await login(staff));
});
