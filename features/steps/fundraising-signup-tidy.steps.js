const { When, Then, Given } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const { Pool } = require("pg");

// Steps for fundraising-signup-tidy.feature (Jaimie, 2026-10-03): the welcome pack's address, sport
// and the T shirt, the split check, the in memory path, and "only people with the link". The switch,
// staff accounts, approving and the clean up of every "(bdd-fr)" fundraiser are fundraising.steps.js's;
// "the fundraising answer names the field" and "no fundraiser called" are fundraising-age-split's;
// opening a page and what it shows are events.steps.js's and fundraising-pages.steps.js's. Every name
// here is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "pw-fundraising-bdd";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// The page's own POSTs say where they came from; the T shirt choice is refused from anywhere else.
const OUR_PAGE = { "sec-fetch-site": "same-origin", origin: BASE_URL };

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

async function call(world, method, path, body, token, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function fundraiser(title) {
  const r = await pool.query(
    `SELECT id, is_sporting, tshirt_size, post_line1, post_town, post_postcode, in_memory, off_list_at, off_list_by, wants
       FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1`,
    [title],
  );
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

const ADDRESS = { postLine1: "1 Example Road", postLine2: "", postTown: "Exampleton", postPostcode: "ex1 1ex" };

// A raising money sign up as the tidied form sends it.
function signUpBody(title, over) {
  return {
    path: "raising",
    kind: "quiz",
    kindOther: "",
    title,
    description: "A quiz for NBCC.",
    eventDate: "",
    startTime: "",
    venue: "",
    town: "",
    targetPence: 20000,
    public: true,
    listed: true,
    firstName: "Sam",
    lastName: "Sample",
    email: "sam.tidy.fr.bdd@example.com",
    phone: "07700 900140",
    instagram: "",
    facebook: "",
    socialOk: false,
    over18: true,
    sharesWithOther: false,
    inMemory: false,
    isSporting: false,
    tshirtSize: "",
    childFundraiser: "me",
    forOrganisation: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false },
    ...ADDRESS,
    newsletterOk: false,
    company: "",
    ...over,
  };
}

When("someone signs up {string}", async function (title) {
  await call(this, "POST", "/api/fundraise", signUpBody(title));
});

When("someone signs up {string} without an address", async function (title) {
  await call(this, "POST", "/api/fundraise", signUpBody(title, { postLine1: "", postLine2: "", postTown: "", postPostcode: "" }));
});

When("someone signs up the sporting event {string} with no T shirt size", async function (title) {
  await call(this, "POST", "/api/fundraise", signUpBody(title, { kind: "walk", isSporting: true, tshirtSize: "" }));
});

When("someone signs up the sporting event {string} with the T shirt size {string}", async function (title, size) {
  await call(this, "POST", "/api/fundraise", signUpBody(title, { kind: "walk", isSporting: true, tshirtSize: size }));
});

When(
  "someone signs up {string} sharing {int} percent with {string} without the tick",
  async function (title, percent, cause) {
    await call(this, "POST", "/api/fundraise", signUpBody(title, { sharesWithOther: true, nbccSharePercent: percent, otherCauseName: cause, splitConfirmed: false }));
  },
);

When("someone signs up {string} for only people with the link", async function (title) {
  await call(this, "POST", "/api/fundraise", signUpBody(title, { listed: false }));
});

When("someone signs up {string} in the in memory way of giving {string}", async function (title, kind) {
  await call(this, "POST", "/api/fundraise", signUpBody(title, { kind }));
});

// In memory, as the form sends that path: its own way of giving, and none of the upbeat questions.
When("a family member signs up a page in memory of {string} by {string}", async function (name, label) {
  const found = await pool.query("SELECT key FROM fundraising_categories WHERE label = $1 AND memory_only", [label]);
  assert.ok(found.rows[0], `no in memory way of giving called ${label}`);
  await call(
    this,
    "POST",
    "/api/fundraise",
    signUpBody("", {
      kind: found.rows[0].key,
      description: "",
      targetPence: null,
      inMemory: true,
      memoryName: name,
      memoryDates: "",
      memorySetupBy: "family",
      memoryPermission: true,
      memoryShowTarget: null,
      isSporting: null,
      childFundraiser: null,
      forOrganisation: null,
      socialOk: true,
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, envelopeCount: 0 },
      postLine1: "",
      postTown: "",
      postPostcode: "",
      email: "family.tidy.fr.bdd@example.com",
    }),
  );
});

Then("the sign up form marks {string} as a sporting category", function (key) {
  assert.ok(this.visitorBody.includes(`for="kind-${key}" data-sporty>`), `${key} is not marked sporting on the form`);
});

Then("the sign up form does not mark {string} as a sporting category", function (key) {
  assert.ok(this.visitorBody.includes(`for="kind-${key}">`), `${key} is not on the form, or is marked sporting`);
});

Then("{string} is stored as a sporting event with the T shirt size {string}", async function (title, size) {
  const f = await fundraiser(title);
  assert.equal(f.is_sporting, true);
  assert.equal(f.tshirt_size, size);
});

Then("{string} is stored with the address {string} {string} {string}", async function (title, line1, town, postcode) {
  const f = await fundraiser(title);
  assert.deepEqual([f.post_line1, f.post_town, f.post_postcode], [line1, town, postcode]);
});

Then("{string} is waiting for a T shirt size", async function (title) {
  const f = await fundraiser(title);
  assert.equal(f.is_sporting, true);
  assert.equal(f.tshirt_size, null);
});

Then("{string} is stored in memory with no sport, no T shirt and no address", async function (title) {
  const f = await fundraiser(title);
  assert.equal(f.in_memory, true);
  assert.equal(f.is_sporting, null);
  assert.equal(f.tshirt_size, null);
  assert.equal(f.post_line1, null);
  assert.equal(f.wants.shoutOut, false);
  assert.equal(f.wants.attend, false);
});

// ---- Admin > Fundraising, Categories: the Sporting tick ----

When("{string} marks the category {string} as sporting", async function (email, key) {
  await call(this, "PATCH", `/api/admin/fundraising/categories/${key}`, { sporty: true }, await login(email));
});

// Put back through the API, so the server reads its list again and the rest of the suite sees it as it was.
Then("{string} puts the category {string} back as not sporting", async function (email, key) {
  await call(this, "PATCH", `/api/admin/fundraising/categories/${key}`, { sporty: false }, await login(email));
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
  const r = await pool.query("SELECT sporty FROM fundraising_categories WHERE key = $1", [key]);
  assert.equal(r.rows[0].sporty, false);
});

// ---- sport and the T shirt, after the sign up ----

When("{string} sets {string} as a sporting event with no T shirt size", async function (email, title) {
  const f = await fundraiser(title);
  await call(this, "PUT", `/api/admin/fundraisers/${f.id}/welcome-pack`, { isSporting: true, tshirtSize: null }, await login(email));
});

// The link staff email carries a token only the organiser has; only its sha256 is stored. Here one
// is made and stored the same way (src/fundraising/signup-tidy.ts hashTshirtToken), as if just sent.
Given("a T shirt link for {string} whose token we know", async function (title) {
  const f = await fundraiser(title);
  this.tshirtToken = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update("fundraisetshirt.v1:" + this.tshirtToken).digest("hex");
  await pool.query("UPDATE fundraisers SET tshirt_token_hash = $1, tshirt_asked_at = now(), tshirt_asked_by = 'bdd' WHERE id = $2", [hash, f.id]);
});

When("the organiser opens that T shirt link", async function () {
  await call(this, "POST", "/api/fundraise/tshirt/look", { token: this.tshirtToken }, null, OUR_PAGE);
});

When("the organiser chooses the T shirt size {string} with that link", async function (size) {
  await call(this, "POST", "/api/fundraise/tshirt", { token: this.tshirtToken, tshirtSize: size }, null, OUR_PAGE);
});
