const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createHash, createHmac, randomBytes } = require("node:crypto");

// Steps for fundraising-private.feature and the private area parts of fundraising.feature
// (TASK-501). The fundraisers, the switch and "the fundraising answer is" are fundraising.steps.js's,
// whose Before and After hooks also clean up (sessions and codes for its "fr.bdd@example.com"
// addresses included).
//
// The code itself only ever goes by email, and the email is stubbed in CI, so to sign in with "the
// code from their email" a step puts a code it knows in place of the one sent, hashed exactly as the
// server hashes it (src/fundraising/sign-in.ts), with the same ADMIN_SESSION_SECRET pr.yml gives the
// app. Every address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SECRET = process.env.ADMIN_SESSION_SECRET || "ci-admin-session-secret";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const COOKIE = "nbcc_fr_session";
const KNOWN_CODE = "246810";

function codeHash(email, code) {
  return createHmac("sha256", SECRET).update(`fundraisecode.v1:${email.trim().toLowerCase()}:${code}`).digest("base64url");
}

// As the page sends them: JSON, from our own origin, with the session cookie once there is one.
async function call(world, method, path, body) {
  const headers = { "Content-Type": "application/json", Origin: new URL(BASE_URL).origin };
  if (world.frSession) headers.Cookie = `${COOKIE}=${world.frSession}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  world.frSetCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie().join("\n") : res.headers.get("set-cookie") || "";
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function fundraiserId(title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].id;
}

// The code is stored after the answer goes back (so the time taken never says who is signed up):
// wait a moment for it.
async function storedCode(email) {
  for (let tries = 0; tries < 40; tries += 1) {
    const r = await pool.query("SELECT code_hash, expires_at, attempts FROM fundraiser_sign_in_codes WHERE email = lower($1)", [email]);
    if (r.rows[0]) return r.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function signIn(world, email, code) {
  await call(world, "POST", "/api/fundraise/manage/sign-in", { email, code });
  const m = /nbcc_fr_session=([A-Za-z0-9_-]+)/.exec(world.frSetCookie || "");
  world.frSession = m ? m[1] : null;
}

// ---- asking for a code ----

When("the organiser asks for a sign in code for {string}", async function (email) {
  await call(this, "POST", "/api/fundraise/manage/request", { email });
});

When("the answer is kept to compare", function () {
  this.frKept = { status: this.frStatus, body: JSON.stringify(this.frBody) };
});

Then("the answer is the same as the one kept", function () {
  assert.deepEqual({ status: this.frStatus, body: JSON.stringify(this.frBody) }, this.frKept);
});

Then("a sign in code for {string} is stored only as a hash", { timeout: 15000 }, async function (email) {
  const row = await storedCode(email);
  assert.ok(row, `no sign in code stored for ${email}`);
  assert.doesNotMatch(row.code_hash, /^\d{6}$/);
  assert.match(row.code_hash, /^[A-Za-z0-9_-]{43}$/);
  const minutes = (new Date(row.expires_at).getTime() - Date.now()) / 60000;
  assert.ok(minutes > 8 && minutes <= 10, `the code lasts ${minutes} minutes`);
  assert.equal(row.attempts, 0);
});

Then("no sign in code is stored for {string}", async function (email) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const r = await pool.query("SELECT 1 FROM fundraiser_sign_in_codes WHERE email = lower($1)", [email]);
  assert.equal(r.rows.length, 0);
});

Then("no {string} email went to {string}", async function (kind, email) {
  const r = await pool.query(
    "SELECT 1 FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2) AND created_at > now() - interval '10 minutes'",
    [kind, email],
  );
  assert.equal(r.rows.length, 0, `a ${kind} email went to ${email}`);
});

// ---- signing in ----

When("{string} signs in with the code from their email", { timeout: 15000 }, async function (email) {
  assert.ok(await storedCode(email), `no sign in code was sent to ${email}`);
  await pool.query("UPDATE fundraiser_sign_in_codes SET code_hash = $2 WHERE email = lower($1)", [email, codeHash(email, KNOWN_CODE)]);
  await signIn(this, email, KNOWN_CODE.slice(0, 3) + " " + KNOWN_CODE.slice(3));
});

When("{string} signs in with the wrong code", async function (email) {
  await pool.query("UPDATE fundraiser_sign_in_codes SET code_hash = $2 WHERE email = lower($1)", [email, codeHash(email, KNOWN_CODE)]);
  await signIn(this, email, "135799");
});

Then("the sign in set an http only session cookie", function () {
  assert.ok(this.frSession, "no session cookie");
  assert.match(this.frSetCookie, /HttpOnly/i);
  assert.match(this.frSetCookie, /SameSite=Lax/i);
  assert.match(this.frSetCookie, /Path=\/api\/fundraise\/manage/);
});

Then("the sign in set no cookie", function () {
  assert.equal(this.frSession, null);
  assert.doesNotMatch(this.frSetCookie || "", /nbcc_fr_session=/);
});

// For a scenario that is about something after signing in: a session put straight in the database,
// stored as the server stores it (the sha256 of the cookie's id).
Given("the organiser of {string} is signed in to their private area", async function (title) {
  const r = await pool.query("SELECT organiser_email FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  this.frSession = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO fundraiser_sessions (session_hash, email, expires_at) VALUES ($1, lower($2), now() + interval '2 hours')", [
    createHash("sha256").update(this.frSession).digest("hex"),
    r.rows[0].organiser_email,
  ]);
});

// ---- the private area ----

When("the signed in organiser opens their private area", async function () {
  await call(this, "GET", "/api/fundraise/manage/me");
});

Then("the private area lists {string} and not {string}", function (mine, theirs) {
  const titles = (this.frBody.fundraisers || []).map((f) => f.title);
  assert.ok(titles.includes(mine), `${mine} is not listed: ${titles.join(", ")}`);
  assert.ok(!titles.includes(theirs), `${theirs} is listed`);
  assert.doesNotMatch(JSON.stringify(this.frBody), /other\.code\.fr\.bdd@example\.com/);
});

When(
  /^the (?:signed in )?organiser (?:asks to change|changes) the target of "([^"]*)" to (\d+) pence(?: in their private area)?$/,
  async function (title, target) {
    await call(this, "POST", `/api/fundraise/manage/fundraisers/${await fundraiserId(title)}/edit`, { targetPence: Number(target) });
  },
);

When("the signed in organiser signs out", async function () {
  await call(this, "POST", "/api/fundraise/manage/sign-out");
});

// ---- the public page (fundraising-pages.feature) ----

Then("the page has no QR code on it", function () {
  assert.doesNotMatch(this.visitorBody, /qr\.svg/);
  assert.doesNotMatch(this.visitorBody, /class="[^"]*fr-qr/);
});

Then("the page ends with a link for its organiser to manage it", function () {
  assert.match(this.visitorBody, /<p class="fr-owner">Is this your page\? <a href="\/fundraise\/manage">Manage it<\/a><\/p>/);
});
