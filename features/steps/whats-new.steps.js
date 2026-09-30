const { When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for whats-new.feature (TASK-478). Drives /api/admin/whats-new over HTTP against the real
// database. The staff come from the shared @admin steps (their addresses end
// "admin.bdd@example.com", which the @admin hooks remove, and their admin_seen rows go with them).
// The sign-up is written straight into the newsletter list, as the footer form writes it, rather
// than through /api/subscribe, whose per-address rate limit other features already spend.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "whatsnew-pw-123";
const SIGNUP = "pat.whatsnew.bdd@example.com";

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

// One sign-in per person per scenario: each one mints and spends a 2FA code.
async function tokenFor(world, email) {
  world.whatsNewTokens = world.whatsNewTokens || {};
  if (!world.whatsNewTokens[email]) world.whatsNewTokens[email] = await login(email);
  return world.whatsNewTokens[email];
}

async function areasFor(world, email) {
  const res = await fetch(`${BASE_URL}/api/admin/whats-new`, {
    headers: { Authorization: `Bearer ${await tokenFor(world, email)}` },
  });
  assert.equal(res.status, 200);
  return (await res.json()).areas;
}

async function reset() {
  await pool.query("DELETE FROM list_subscribers WHERE email = $1", [SIGNUP]);
}

Before({ tags: "@whats-new" }, reset);
After({ tags: "@whats-new" }, reset);
AfterAll(async () => {
  await pool.end();
});

When("someone signs up for the newsletter on the website", async function () {
  await pool.query(
    `INSERT INTO list_subscribers (list_id, name, email, consent_source)
     SELECT id, 'Pat Test', $1, 'footer' FROM subscriber_lists WHERE slug = 'newsletter'`,
    [SIGNUP],
  );
});

When("{string} opens {string}", async function (email, area) {
  const res = await fetch(`${BASE_URL}/api/admin/whats-new/seen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(this, email)}` },
    body: JSON.stringify({ area }),
  });
  this.whatsNewStatus = res.status;
});

Then("{string} is new to {string}", async function (area, email) {
  const found = (await areasFor(this, email)).find((a) => a.area === area);
  assert.ok(found, `${area} was not listed for ${email}`);
  if (found.new !== true) {
    // The database's own times, to the microsecond, so a failure says which came first. The first CI
    // run failed on an account and a sign-up made within one millisecond of each other.
    const times = await pool.query(
      `SELECT (SELECT created_at::text FROM users WHERE email = $1) AS account_made,
              (SELECT max(consented_at)::text FROM list_subscribers WHERE email = $2) AS signed_up`,
      [email, SIGNUP],
    );
    assert.fail(`${area} should be new to ${email}: answered ${JSON.stringify(found)}, ${JSON.stringify(times.rows[0])}`);
  }
});

Then("{string} is not new to {string}", async function (area, email) {
  const found = (await areasFor(this, email)).find((a) => a.area === area);
  assert.ok(found, `${area} was not listed for ${email}`);
  assert.equal(found.new, false, `${area} should not be new to ${email}`);
});

Then("{string} is not listed for {string}", async function (area, email) {
  const areas = await areasFor(this, email);
  assert.equal(areas.some((a) => a.area === area), false);
});

Then("the answer is {int}", function (status) {
  assert.equal(this.whatsNewStatus, status);
});
