const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createHash, randomBytes } = require("node:crypto");

// Steps for newsletter-signup.feature: joining the mailing list from /newsletter, with a confirm by
// email step. The form is posted as the page posts it; the emailed link is never readable from the
// database (only a hash of it is kept), so a step gives the waiting request a link of its own by
// storing that link's hash, made exactly as the app makes it (SHA-256, src/mailing-list/model.ts).
// Every address ends "newsletter.signup.bdd@example.com", and everything made for one is cleared
// before and after each scenario. Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ORIGIN = new URL(BASE_URL).origin;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const OURS = "%newsletter.signup.bdd@example.com";

async function clear() {
  await pool.query("DELETE FROM newsletter_signup_requests WHERE email LIKE $1", [OURS]);
  await pool.query("DELETE FROM list_subscribers WHERE lower(email) LIKE $1", [OURS]);
  await pool.query("DELETE FROM email_suppressions WHERE lower(email) LIKE $1", [OURS]);
  await pool.query("DELETE FROM email_log WHERE recipient LIKE $1", [OURS]);
}
Before({ tags: "@newsletter-signup" }, clear);
After({ tags: "@newsletter-signup" }, clear);

const hashOf = (token) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

async function ask(world, firstName, email) {
  const res = await fetch(`${BASE_URL}/api/newsletter/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ firstName, email, company: "", captchaToken: "" }),
  });
  world.mlForm = { status: res.status, body: await res.json().catch(() => ({})) };
}

// Gives the waiting request a link we know, and remembers it for this address.
async function linkFor(world, email) {
  const token = newToken();
  const r = await pool.query("UPDATE newsletter_signup_requests SET token_hash = $1 WHERE email = $2", [hashOf(token), email.toLowerCase()]);
  assert.equal(r.rowCount, 1, `no mailing list request is waiting for ${email}`);
  world.mlTokens = world.mlTokens || {};
  world.mlTokens[email] = token;
  return token;
}

async function page(world, res) {
  world.mlPage = { status: res.status, text: await res.text() };
}

const open = (world, token) => fetch(`${BASE_URL}/newsletter/confirm?t=${encodeURIComponent(token)}`).then((res) => page(world, res));

const press = (world, token) =>
  fetch(`${BASE_URL}/newsletter/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: new URLSearchParams({ t: token }).toString(),
  }).then((res) => page(world, res));

async function member(email) {
  const r = await pool.query(
    `SELECT ls.name, ls.consent_source, ls.consented_at, ls.unsubscribed_at, ls.added_by
       FROM list_subscribers ls JOIN subscriber_lists l ON l.id = ls.list_id
      WHERE l.slug = 'newsletter' AND lower(ls.email) = lower($1)`,
    [email],
  );
  return r.rows[0] || null;
}

When("the mailing list page is opened at {string}", async function (path) {
  await page(this, await fetch(`${BASE_URL}${path}`));
});

When("someone opens the mailing list link {string}", async function (path) {
  await page(this, await fetch(`${BASE_URL}${path}`));
});

When("{string} asks to join the mailing list as {string}", async function (firstName, email) {
  await ask(this, firstName, email);
});

Given("{string} has joined the mailing list as {string} and confirmed by email", async function (firstName, email) {
  await ask(this, firstName, email);
  assert.equal(this.mlForm.status, 200);
  await press(this, await linkFor(this, email));
  assert.equal(this.mlPage.status, 200);
  const m = await member(email);
  assert.ok(m && !m.unsubscribed_at, `${email} should be on the newsletter list`);
});

When("{string} opens their mailing list link", async function (email) {
  await open(this, await linkFor(this, email));
});

When("{string} presses the button behind their mailing list link", async function (email) {
  await press(this, await linkFor(this, email));
});

When("{string} opens the mailing list link they already used", async function (email) {
  const token = this.mlTokens && this.mlTokens[email];
  assert.ok(token, `no link was used by ${email}`);
  await open(this, token);
});

When("the mailing list request for {string} was made {int} days ago", async function (email, days) {
  const r = await pool.query(
    "UPDATE newsletter_signup_requests SET sent_at = sent_at - make_interval(days => $2), expires_at = expires_at - make_interval(days => $2) WHERE email = $1",
    [email.toLowerCase(), days],
  );
  assert.equal(r.rowCount, 1);
});

Given("{string} is on the stop list because it bounced", async function (email) {
  await pool.query("INSERT INTO email_suppressions (email, reason, detail) VALUES ($1, 'bounced', 'bdd')", [email.toLowerCase()]);
});

Given("{string} has since unsubscribed from the newsletter list", async function (email) {
  const r = await pool.query(
    `UPDATE list_subscribers SET unsubscribed_at = now()
      WHERE lower(email) = lower($1) AND list_id = (SELECT id FROM subscriber_lists WHERE slug = 'newsletter')`,
    [email],
  );
  assert.equal(r.rowCount, 1);
  // The wait between links, so asking again sends a new one.
  await pool.query("DELETE FROM newsletter_signup_requests WHERE email = $1", [email.toLowerCase()]);
});

Given("the time {string} joined the newsletter list is noted", async function (email) {
  const m = await member(email);
  assert.ok(m);
  this.mlJoined = new Date(m.consented_at).toISOString();
  // The wait between links, so asking again sends a new one.
  await pool.query("DELETE FROM newsletter_signup_requests WHERE email = $1", [email.toLowerCase()]);
});

Then("the time {string} joined the newsletter list has not changed", async function (email) {
  const m = await member(email);
  assert.ok(m);
  assert.equal(new Date(m.consented_at).toISOString(), this.mlJoined);
});

Then("the mailing list form answers {int} with {string}", function (status, word) {
  assert.equal(this.mlForm.status, status);
  assert.deepEqual(this.mlForm.body, { status: word });
});

Then("the mailing list form answers {int} with the boxes {string} and {string} marked", function (status, a, b) {
  assert.equal(this.mlForm.status, status);
  assert.deepEqual(Object.keys(this.mlForm.body.fields || {}).sort(), [a, b].sort());
});

Then("the mailing list page answers {int}", function (status) {
  assert.equal(this.mlPage.status, status);
});

Then("the mailing list page says {string}", function (words) {
  assert.ok(this.mlPage.text.includes(words), `the page does not say "${words}"`);
});

Then(/^(\d+) mailing list confirm emails? (?:has|have) gone to "([^"]+)"$/, async function (count, email) {
  const r = await pool.query("SELECT count(*)::int AS n FROM email_log WHERE kind = 'newsletterSignupConfirm' AND recipient = $1", [email.toLowerCase()]);
  assert.equal(r.rows[0].n, Number(count));
});

Then("{string} is not on the mailing list", async function (email) {
  const m = await member(email);
  assert.ok(!m || m.unsubscribed_at, `${email} should not be on the newsletter list`);
});

Then("{string} is on the mailing list as {string}, having signed up themselves", async function (email, name) {
  const m = await member(email);
  assert.ok(m, `${email} is not on the mailing list`);
  assert.equal(m.unsubscribed_at, null);
  assert.equal(m.name, name);
  // The existing source for someone who signed up themselves on the website, and no staff member.
  assert.equal(m.consent_source, "footer");
  assert.equal(m.added_by, null);
  assert.ok(m.consented_at);
});

Then("no mailing list request is waiting for {string}", async function (email) {
  const r = await pool.query("SELECT count(*)::int AS n FROM newsletter_signup_requests WHERE email = $1", [email.toLowerCase()]);
  assert.equal(r.rows[0].n, 0);
});
