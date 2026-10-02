const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");

// Steps for admin-overview.feature (TASK-507). Drives GET /api/admin/overview over HTTP against the
// real database. The staff come from the shared @admin steps (addresses ending admin.bdd@example.com,
// which the @admin hooks remove). The sign up is written straight into fundraisers, as the public form
// leaves it, and removed again by its organiser's invented address.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "overview-pw-123";
const ORGANISER = "ola.overview.fr.bdd@example.com";

async function reset() {
  await pool.query("DELETE FROM fundraisers WHERE organiser_email = $1", [ORGANISER]);
}
Before({ tags: "@admin-overview" }, reset);
After({ tags: "@admin-overview" }, reset);
AfterAll(async () => {
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

async function read(world, email) {
  const headers = email ? { Authorization: `Bearer ${await login(email)}` } : {};
  const res = await fetch(`${BASE_URL}/api/admin/overview`, { headers });
  world.ovStatus = res.status;
  world.ovBody = await res.json().catch(() => ({}));
}

// A stored map is a complete statement of access: the contact form, and nothing else.
Given("{string} can see only the contact form", async function (email) {
  await pool.query("UPDATE users SET permissions = $2::jsonb WHERE email = $1", [email, JSON.stringify({ contact: "view" })]);
});

Given("a new fundraising sign up {string} waiting for approval", async function (title) {
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${randomBytes(3).toString("hex")}`;
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, target_pence, public, status, organiser_name,
                              organiser_email, organiser_phone, wants, post_line1, post_town, post_postcode,
                              event_date, updated_by)
     VALUES ($1, 'raising', 'bake_sale', $2, 'A test fundraiser.', 50000, true, 'new', 'Ola Testperson',
             $3, '07700 900123', '{}'::jsonb, '1 Example Road', 'Exampleton', 'KA1 1AA',
             (now() AT TIME ZONE 'Europe/London')::date + 30, 'bdd')`,
    [slug, title, ORGANISER],
  );
});

When("I read the overview without a session", async function () {
  await read(this, null);
});

When("{string} reads the overview", async function (email) {
  await read(this, email);
});

Then("the overview answer is {int}", function (status) {
  assert.equal(this.ovStatus, status, JSON.stringify(this.ovBody));
});

Then("it says fundraising sign ups are waiting, with a button to {string}", function (button) {
  const line = (this.ovBody.needs || []).find((n) => n.key === "fundraisingNew");
  assert.ok(line, JSON.stringify(this.ovBody));
  assert.match(line.text, /^\d+ fundraising sign ups? (is|are) waiting for approval$/);
  assert.equal(line.button, button);
  assert.equal(line.view, "fundraising");
  assert.deepEqual(this.ovBody.failed, []);
});

// A real answer, checked in full (not an empty one that would pass by accident), with nothing from a
// screen this person cannot open: their only access is the contact form.
Then("it says nothing about Fundraising", function () {
  assert.ok(Array.isArray(this.ovBody.needs), JSON.stringify(this.ovBody));
  assert.deepEqual(this.ovBody.failed, []);
  assert.ok(this.ovBody.updatedAt, "the answer says when it was read");
  const others = this.ovBody.needs.filter((n) => n.view !== "contact");
  assert.deepEqual(others, [], JSON.stringify(this.ovBody));
});
