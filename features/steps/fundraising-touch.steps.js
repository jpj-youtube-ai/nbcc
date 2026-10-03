const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Pool } = require("pg");
const { createHash, randomBytes } = require("node:crypto");

// Steps for fundraising-touch.feature (TASK-515): the Automatic emails switch, reading an email
// before any is sent, the daily pass, the thank you at Mark finished, and a call about a prompt.
// The shared fundraising steps (staff, switching fundraising on, arranging an approved fundraiser,
// "the fundraising answer is", the history, the emails that went) are in fundraising.steps.js,
// fundraising-team.steps.js and fundraising-private.steps.js; fundraising.steps.js clears
// fundraisers (their touchpoints and calls go with them) and staff before and after every
// @fundraising scenario. This file puts the Automatic emails switch back OFF, as it ships, and
// clears the opt outs it made.
//
// The daily pass runs from the compiled app (dist/, built before the BDD step in CI) in this
// process, against the same database, exactly as the 8am task runs it. Everything made here is
// marked like the rest: titles carry "(bdd-fr)", addresses end "fr.bdd@example.com". Every name
// and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "pw-fundraising-bdd";
const MINE = "%touch.fr.bdd@example.com";

async function setTouch(on) {
  await pool.query("UPDATE fundraising_settings SET touch_emails_on = $1 WHERE id = 1", [on]);
}

async function clean() {
  await setTouch(false);
  await pool.query("DELETE FROM email_opt_outs WHERE email LIKE $1", [MINE]);
}

Before({ tags: "@fundraising-touch" }, clean);
After({ tags: "@fundraising-touch" }, clean);

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

async function adminCall(world, email, method, urlPath, body) {
  const token = await login(email);
  const res = await fetch(`${BASE_URL}${urlPath}`, {
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

// Today in the UK, as the daily pass reads it, and a day so many on.
function ukDayPlus(days) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- arranging ----

Given("the automatic emails are switched on", async function () {
  await setTouch(true);
});

Given("the automatic emails are switched off", async function () {
  await setTouch(false);
});

Given("an approved fundraiser {string} a week from today, organised by {string}", async function (title, email) {
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${randomBytes(3).toString("hex")}`;
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, event_date, target_pence, public, status, organiser_name,
                              organiser_email, organiser_phone, approved_at, approved_by, updated_by)
     VALUES ($1, 'raising', 'run_walk', $2, 'A test fundraiser.', $3::date, 50000, true, 'approved', 'Robin Testperson', $4,
             '07700 900123', now() - interval '30 days', 'bdd', 'bdd')`,
    [slug, title, ukDayPlus(7), email],
  );
});

Given("{string} has asked us to stop all emails", async function (email) {
  await pool.query("INSERT INTO email_opt_outs (email, kind, source) VALUES (lower($1), 'all', 'preferences')", [email]);
});

// ---- acting ----

When("{string} reads the automatic emails", async function (email) {
  await adminCall(this, email, "GET", "/api/admin/fundraising/touch");
});

When("{string} switches the automatic emails on", async function (email) {
  await adminCall(this, email, "PUT", "/api/admin/fundraising/touch/settings", { on: true });
});

When("{string} reads the {string} automatic email", async function (email, kind) {
  await adminCall(this, email, "GET", `/api/admin/fundraising/touch/preview/${kind}`);
});

When("the daily automatic emails run", async function () {
  const { runTouchEmails } = require(path.resolve(__dirname, "../../dist/fundraising/touch-runner.js"));
  this.touchRun = await runTouchEmails(new Date());
});

When("{string} marks {string} finished", async function (email, title) {
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/finish`);
});

When("{string} records a call about {string} for {string}", async function (email, prompt, title) {
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/prompt-calls`, { prompt, note: "A friendly chat." });
});

// ---- checking ----

Then("the automatic emails are said to be off", function () {
  assert.equal(this.frBody.settings.on, false);
  assert.equal(this.frBody.kinds.length, 9);
});

Then("the automatic emails are switched on in the database", async function () {
  const r = await pool.query("SELECT touch_emails_on FROM fundraising_settings WHERE id = 1");
  assert.equal(r.rows[0].touch_emails_on, true);
});

Then("the automatic email's subject is {string}", function (subject) {
  assert.equal(this.frBody.subject, subject);
  assert.match(this.frBody.html, /^<!doctype html>/);
  assert.ok(this.frBody.text.length > 0);
});

Then("exactly {int} {string} email went to {string}", async function (n, kind, email) {
  const r = await pool.query(
    "SELECT 1 FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2) AND created_at > now() - interval '10 minutes'",
    [kind, email],
  );
  assert.equal(r.rows.length, n);
});

// ---- Do it again (TASK-515) ----

// As src/fundraising/again.ts: only this hash of the token is ever stored.
const againHash = (token) => createHash("sha256").update("fundraiseagain.v1:" + token).digest("hex");

async function publicCall(world, method, urlPath, body) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

Given("a Do it again link for {string} whose token we know", async function (title) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO fundraiser_again_tokens (fundraiser_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '60 days')",
    [await fundraiserId(title), againHash(token)],
  );
  this.againToken = token;
});

When("the sign up form asks for that Do it again link", async function () {
  await publicCall(this, "POST", "/api/fundraise/again", { token: this.againToken });
});

Then("the form is given last year's details for {string}, and nothing about givers", function (email) {
  assert.equal(this.frBody.email, email);
  assert.equal(this.frBody.path, "raising");
  assert.equal(this.frBody.targetPence, 40000);
  assert.deepEqual(Object.keys(this.frBody).sort(), [
    "description", "email", "facebook", "firstName", "instagram", "kind", "kindOther", "lastName", "path", "phone", "targetPence", "title", "town", "venue",
  ]);
});

When("someone signs up {string} from that Do it again link", async function (title) {
  const p = this.frBody && this.frBody.email ? this.frBody : {};
  await publicCall(this, "POST", "/api/fundraise", {
    path: "raising",
    kind: "santa_dash",
    title,
    description: "Doing it again.",
    eventDate: "",
    startTime: "",
    venue: "",
    town: "Exampleton",
    targetPence: 40000,
    public: true,
    firstName: p.firstName || "Robin",
    lastName: p.lastName || "Testperson",
    email: p.email || "pat.touch.fr.bdd@example.com",
    phone: "07700 900127",
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, shoutOut: false, attend: false },
    newsletterOk: false,
    company: "",
    again: this.againToken,
  });
});

Then("the Do it again link is used by {string}", async function (title) {
  const r = await pool.query("SELECT used_at, used_by_fundraiser_id FROM fundraiser_again_tokens WHERE token_hash = $1", [againHash(this.againToken)]);
  assert.ok(r.rows[0] && r.rows[0].used_at, "the link was not marked used");
  assert.equal(r.rows[0].used_by_fundraiser_id, await fundraiserId(title));
});

Then("{string} is waiting for staff to approve it", async function (title) {
  const r = await pool.query("SELECT status FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.equal(r.rows[0].status, "new");
});
