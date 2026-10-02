const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-news.feature (TASK-506). The fundraisers, the staff, the switch, signing an
// organiser in and "the fundraising answer is" are fundraising.steps.js's and
// fundraising-private.steps.js's (whose hooks also clean up: an update goes with its fundraiser);
// opening a fundraiser's page is fundraising-pages.steps.js's and "the page shows" events.steps.js's.
// These add posting an update, staff deciding one, its photo, and the fundraiser's date. Every name,
// address and word is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const COOKIE = "nbcc_fr_session";
const PASSWORD = "pw-fundraising-bdd";
// The first bytes of a JPEG, which is all the server looks at to know it is one.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);

async function fundraiserId(title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].id;
}

async function latestUpdate(title) {
  const r = await pool.query(
    "SELECT u.id, u.photo_id, u.status FROM fundraiser_updates u WHERE u.fundraiser_id = $1 ORDER BY u.id DESC LIMIT 1",
    [await fundraiserId(title)],
  );
  assert.ok(r.rows[0], `no news update on ${title}`);
  return r.rows[0];
}

// As the private area's page sends it: JSON, from our own origin, with the session cookie.
async function organiserCall(world, method, path, body) {
  const headers = { "Content-Type": "application/json", Origin: new URL(BASE_URL).origin };
  if (world.frSession) headers.Cookie = `${COOKIE}=${world.frSession}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
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

async function staffCall(world, email, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await login(email)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

// ---- the date ----

Given("{string} is dated {int} days from today", async function (title, days) {
  await pool.query("UPDATE fundraisers SET event_date = (now() AT TIME ZONE 'Europe/London')::date + $2::int WHERE id = $1", [
    await fundraiserId(title),
    days,
  ]);
});

// ---- the organiser ----

When("the signed in organiser posts the news update {string} to {string}", async function (text, title) {
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${await fundraiserId(title)}/news`, { text });
});

When("the signed in organiser posts the news update {string} with a photo to {string}", async function (text, title) {
  await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${await fundraiserId(title)}/news`, {
    text,
    photo: { mime: "image/jpeg", dataBase64: JPEG.toString("base64") },
  });
});

When("the signed in organiser posts {int} news updates to {string}", async function (n, title) {
  const id = await fundraiserId(title);
  for (let i = 1; i <= n; i += 1) {
    await organiserCall(this, "POST", `/api/fundraise/manage/fundraisers/${id}/news`, { text: `Update number ${i} (bdd-fr)` });
    assert.equal(this.frStatus, 202, `update ${i} was answered ${this.frStatus}`);
  }
});

Then("the private area says the news update on {string} is {string}", async function (title, words) {
  const id = await fundraiserId(title);
  const body = await organiserCall(this, "GET", "/api/fundraise/manage/news");
  const mine = (body.fundraisers || []).find((f) => f.id === id);
  assert.ok(mine, `${title} is not in the private area's news`);
  assert.equal(mine.updates[0] && mine.updates[0].statusWords, words);
  assert.doesNotMatch(JSON.stringify(body), /rejectReason|decidedBy/);
});

Then("the signed in organiser can see the photo of the news update on {string}", async function (title) {
  const u = await latestUpdate(title);
  const res = await fetch(`${BASE_URL}/api/fundraise/manage/news/${u.id}/photo`, { headers: { Cookie: `${COOKIE}=${this.frSession}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

// ---- the public ----

async function publicPhotoStatus(title) {
  const u = await latestUpdate(title);
  assert.ok(u.photo_id, "the update has no photo");
  const res = await fetch(`${BASE_URL}/media/fundraiser-news/${u.photo_id}`);
  return res;
}

Then("the photo of the news update on {string} is not served to the public", async function (title) {
  assert.equal((await publicPhotoStatus(title)).status, 404);
});

Then("the photo of the news update on {string} is served to the public", async function (title) {
  const res = await publicPhotoStatus(title);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

// ---- staff ----

When("{string} approves the news update on {string}", async function (email, title) {
  const u = await latestUpdate(title);
  await staffCall(this, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/news/${u.id}/approve`);
});

Then("the history of {string} records {string} by {string}", async function (title, action, email) {
  const body = await staffCall(this, email, "GET", `/api/admin/fundraisers/${await fundraiserId(title)}/history`);
  assert.ok(
    (body.history || []).some((h) => h.action === action && h.actor === `admin:${email}`),
    `${action} by ${email} not in ${JSON.stringify(body.history)}`,
  );
});
