const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");

// Steps for fundraising-requests.feature (TASK-505): the requests in Admin > Fundraising. The shared
// fundraising steps (staff, "the fundraising answer is", the history) are in fundraising.steps.js and
// fundraising-team.steps.js; fundraising.steps.js also clears fundraisers and staff before and after
// every @fundraising scenario, and a fundraiser's requests go with it (ON DELETE CASCADE).
//
// Everything made here is marked like the rest: titles carry "(bdd-fr)", addresses end
// "fr.bdd@example.com". Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "pw-fundraising-bdd";

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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function fundraiserId(title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].id;
}

// Today as a UK day, as the server takes it: a date still to come is refused.
const ukToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

Given("an approved fundraiser {string} asking for {int} posters and {int} collection bucket", async function (title, posters, buckets) {
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${randomBytes(3).toString("hex")}`;
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, target_pence, public, status, organiser_name,
                              organiser_email, organiser_phone, wants, post_line1, post_town, post_postcode,
                              event_date, approved_at, approved_by, updated_by)
     VALUES ($1, 'raising', 'bake_sale', $2, 'A test fundraiser.', 50000, true, 'approved', 'Ali Testperson',
             'ali.req.fr.bdd@example.com', '07700 900123', $3::jsonb, '1 Example Road', 'Exampleton', 'KA1 1AA',
             (now() AT TIME ZONE 'Europe/London')::date + 30, now(), 'bdd', 'bdd')`,
    [slug, title, JSON.stringify({ posterCount: posters, leafletCount: 0, bucketCount: buckets, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false })],
  );
});

When("{string} reads the fundraising requests", async function (email) {
  const body = await adminCall(this, email, "GET", "/api/admin/fundraising/requests");
  // The first read is the count to compare the later ones with.
  if (this.frStatus === 200 && !this.reqTotalsAtStart) this.reqTotalsAtStart = body.totals;
});

async function change(world, email, title, kind, body) {
  return adminCall(world, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/requests/${kind}`, body);
}

When("{string} marks the posters for {string} sent", async function (email, title) {
  await change(this, email, title, "posters", { action: "send", from: "to_send", on: ukToday(), how: "post", by: "Fern (bdd)", quantity: 10 });
});

When("{string} lends the collection buckets to {string}", async function (email, title) {
  await change(this, email, title, "buckets", { action: "out", from: "to_send", on: ukToday(), quantity: 1, by: "Fern (bdd)" });
});

When("{string} marks the collection buckets for {string} back", async function (email, title) {
  await change(this, email, title, "buckets", { action: "back", from: "with_them", on: ukToday(), quantity: 1, note: "All there (bdd)." });
});

When("{string} undoes the posters for {string}", async function (email, title) {
  await change(this, email, title, "posters", { action: "undo", from: "sent" });
});

async function viewOf(world, title, kind) {
  const id = await fundraiserId(title);
  const list = (world.frBody.requests || {})[String(id)] || [];
  return list.find((v) => v.kind === kind);
}

Then("the posters for {string} are {string}", async function (title, status) {
  const v = await viewOf(this, title, "posters");
  assert.ok(v, `no posters request for ${title}`);
  assert.equal(v.status, status);
});

Then("the collection buckets for {string} are {string}", async function (title, status) {
  const v = await viewOf(this, title, "buckets");
  assert.ok(v, `no buckets request for ${title}`);
  assert.equal(v.status, status);
});

Then("{string} shows Requests to do", async function (title) {
  assert.equal((this.frBody.toDo || {})[String(await fundraiserId(title))], true);
});

Then("{string} does not show Requests to do", async function (title) {
  assert.equal((this.frBody.toDo || {})[String(await fundraiserId(title))], undefined);
});

Then("the posters still to send have dropped by {int} and the collection buckets by {int}", function (posters, buckets) {
  const before = this.reqTotalsAtStart.materials;
  const now = this.frBody.totals.materials;
  assert.equal(before.posters - now.posters, posters);
  assert.equal(before.buckets - now.buckets, buckets);
});

Then("buckets or tins not back have gone up by {int}", function (n) {
  assert.equal(this.frBody.totals.notBack - this.reqTotalsAtStart.notBack, n);
});

Then("buckets or tins not back are as they were at the start", function () {
  assert.equal(this.frBody.totals.notBack, this.reqTotalsAtStart.notBack);
});
