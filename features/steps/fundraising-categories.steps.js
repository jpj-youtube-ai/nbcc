const { When, Then, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-categories.feature. The staff, the switch and the fundraisers come from
// fundraising.steps.js (its @fundraising hooks clear them); "the fundraising answer is" too. This
// file adds and hides categories through the admin API, reads the sign up form over HTTP, and puts
// the categories back afterwards: a category a scenario added is removed (once the sign ups using it
// are gone) and any it hid is put back on the form. Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "pw-fundraising-bdd";
const MARK = "%(bdd-fr)%";
const ADDED_BY = "admin:%cat.fr.bdd@example.com";

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

async function send(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, body: parsed };
}

async function keyOf(label) {
  const r = await pool.query("SELECT key FROM fundraising_categories WHERE lower(label) = lower($1)", [label]);
  assert.ok(r.rows[0], `no fundraising category called ${label}`);
  return r.rows[0].key;
}

/** The category names the sign up form offers, in the order it offers them. */
async function formLabels() {
  const html = await (await fetch(`${BASE_URL}/fundraise`)).text();
  const block = (html.match(/<!-- kinds -->([\s\S]*?)<!-- \/kinds -->/) || ["", ""])[1];
  return [...block.matchAll(/<span>([^<]*)<\/span><\/label>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
  );
}

async function putBack() {
  // Sign ups first: a category in use can never be deleted.
  await pool.query("DELETE FROM fundraisers WHERE title LIKE $1", [MARK]);
  await pool.query("DELETE FROM fundraising_categories WHERE created_by LIKE $1", [ADDED_BY]);
  await pool.query("UPDATE fundraising_categories SET active = true, retired_at = NULL WHERE key = 'party'");
}

After({ tags: "@categories" }, putBack);

When("{string} adds the fundraising category {string}", async function (email, label) {
  const r = await send("POST", "/api/admin/fundraising/categories", { label }, await login(email));
  this.catStatus = r.status;
  this.catBody = r.body;
});

When("{string} hides the fundraising category {string}", async function (email, label) {
  const r = await send("PATCH", `/api/admin/fundraising/categories/${await keyOf(label)}`, { active: false }, await login(email));
  this.catStatus = r.status;
});

When("{string} puts the fundraising category {string} back", async function (email, label) {
  const r = await send("PATCH", `/api/admin/fundraising/categories/${await keyOf(label)}`, { active: true }, await login(email));
  this.catStatus = r.status;
  assert.equal(r.status, 200);
});

Then("the category answer is {int}", function (status) {
  assert.equal(this.catStatus, status, JSON.stringify(this.catBody));
});

Then("there is no fundraising category {string}", async function (label) {
  const r = await pool.query("SELECT 1 FROM fundraising_categories WHERE lower(label) = lower($1)", [label]);
  assert.equal(r.rows.length, 0);
});

Then("the sign up form offers its categories A to Z, with Other last", async function () {
  const labels = await formLabels();
  assert.ok(labels.length > 2, `the form offers ${JSON.stringify(labels)}`);
  assert.equal(labels[labels.length - 1], "Other");
  const rest = labels.slice(0, -1);
  const sorted = [...rest].sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" }));
  assert.deepEqual(rest, sorted);
  // One each: never "this or that".
  for (const l of rest) assert.ok(!/ or /.test(l), `${l} is two things`);
});

Then("the sign up form offers {string} between {string} and {string}", async function (label, before, after) {
  const labels = await formLabels();
  const at = labels.indexOf(label);
  assert.ok(at > 0, `the form offers ${JSON.stringify(labels)}`);
  assert.equal(labels[at - 1], before);
  assert.equal(labels[at + 1], after);
});

Then("the sign up form does not offer {string}", async function (label) {
  assert.ok(!(await formLabels()).includes(label));
});

Then("adding the category {string} is in audit_log by {string}", async function (label, actor) {
  const r = await pool.query(
    "SELECT actor, data FROM audit_log WHERE action = 'fundraising.category_added' AND entity = 'fundraising_category' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(r.rows[0].actor, actor);
  assert.equal(r.rows[0].data.label, label);
  assert.equal(r.rows[0].data.key, await keyOf(label));
});

async function signUpAs(world, title, kind) {
  const res = await fetch(`${BASE_URL}/api/fundraise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "raising",
      kind,
      kindOther: "",
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
      email: "sam.cat.fr.bdd@example.com",
      phone: "07700 900128",
      instagram: "",
      facebook: "",
      socialOk: false,
      over18: true,
      sharesWithOther: false,
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
      newsletterOk: false,
    }),
  });
  // The same names fundraising.steps.js reads ("the fundraising answer is").
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
}

When("someone signs up {string} in the category {string}", async function (title, label) {
  await signUpAs(this, title, await keyOf(label));
});

When("someone signs up {string} in the old category {string}", async function (title, key) {
  await signUpAs(this, title, key);
});

Then("the fundraiser {string} is stored in the category {string}", async function (title, label) {
  const r = await pool.query("SELECT kind FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.equal(r.rows[0].kind, await keyOf(label));
});

Then("Get involved names the category of {string} as {string}", async function (title, label) {
  const body = await (await fetch(`${BASE_URL}/api/fundraisers`)).json();
  const card = body.fundraisers.find((f) => f.title === title);
  assert.ok(card, `${title} is not listed`);
  assert.equal(card.kindLabel, label);
});
