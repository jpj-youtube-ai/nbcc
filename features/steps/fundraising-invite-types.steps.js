const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createHash, randomBytes } = require("node:crypto");

// Steps for fundraising-invite-types.feature (invite types, Jaimie, B1 + I1). The shared steps
// (staff, switching on, "the fundraising answer is" and "says", "the sign up form asks for that
// invite", "no ... email went to") are in fundraising.steps.js, fundraising-team.steps.js,
// event-pages.steps.js and fundraising-private.steps.js, which also clear staff and invites made at
// addresses ending "fr.bdd@example.com". Every address here ends "invtype.fr.bdd@example.com", used
// by no other feature. This file also clears the in memory invite wording's sign off, which only
// these scenarios make. Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MINE = "%invtype.fr.bdd@example.com";
const PASSWORD = "pw-fundraising-bdd";
const WORDING_KEY = "invite_memory";
// As src/fundraising/invite.ts: only this hash of the token is ever stored.
const TOKEN_DOMAIN = "fundraiseinvite.v1:";
const hashToken = (token) => createHash("sha256").update(TOKEN_DOMAIN + token).digest("hex");

async function clean() {
  await pool.query("DELETE FROM fundraiser_invites WHERE email LIKE $1", [MINE]);
  await pool.query("DELETE FROM touch_wording_approvals WHERE key = $1", [WORDING_KEY]);
}

Before({ tags: "@invite-types" }, clean);
After({ tags: "@invite-types" }, clean);

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
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await login(email)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function invitesTo(email) {
  return (await pool.query("SELECT * FROM fundraiser_invites WHERE email = lower($1) ORDER BY id DESC", [email])).rows;
}

async function staffId(email) {
  const me = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  assert.ok(me.rows[0], `no staff member ${email}`);
  return Number(me.rows[0].id);
}

// ---- arranging ----

// An invite as the admin makes one, so the test knows the token its email would have carried.
// "none" is an invite from before the drop-down: no type at all.
Given("a {string} invite to first name {string} and surname {string} at {string} whose link we know", async function (type, firstName, lastName, email) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO fundraiser_invites (name, first_name, last_name, email, note, signed_by, sent_by, token_hash, invite_type)
     VALUES ($1, $2, $3, lower($4), 'Good to talk today.', 'Fern', 'admin:fern.invtype.fr.bdd@example.com', $5, $6)`,
    [`${firstName} ${lastName}`, firstName, lastName, email, hashToken(token), type === "none" ? null : type],
  );
  this.inviteToken = token;
  this.invite = { firstName, lastName, email };
});

Given("the in memory invite wording is not approved", async function () {
  await pool.query("DELETE FROM touch_wording_approvals WHERE key = $1", [WORDING_KEY]);
});

// ---- inviting ----

When("{string} sends a {string} invite to first name {string} and surname {string} at {string}", async function (staff, type, firstName, lastName, email) {
  await adminCall(this, staff, "POST", "/api/admin/fundraising/invites", {
    type,
    firstName,
    lastName,
    email,
    note: "Good to talk today. Here is the form we mentioned.",
    signedBy: await staffId(staff),
  });
});

// As an admin page loaded before the drop-down sends it: no type at all.
When("{string} sends an invite with no type to first name {string} and surname {string} at {string}", async function (staff, firstName, lastName, email) {
  await adminCall(this, staff, "POST", "/api/admin/fundraising/invites", {
    firstName,
    lastName,
    email,
    note: "Good to talk today.",
    signedBy: await staffId(staff),
  });
});

When("{string} resends the invite to {string}", async function (staff, email) {
  const rows = await invitesTo(email);
  assert.ok(rows[0], `no invite to ${email}`);
  await adminCall(this, staff, "POST", `/api/admin/fundraising/invites/${rows[0].id}/resend`, {});
});

// ---- the wording's sign off ----

When("{string} reads the {string} invite wording", async function (staff, type) {
  await adminCall(this, staff, "GET", `/api/admin/fundraising/invite-wording/${type}`);
});

When("{string} approves the in memory invite wording", async function (staff) {
  await adminCall(this, staff, "POST", `/api/admin/fundraising/invite-wording/${WORDING_KEY}/approval`, {});
});

When("{string} withdraws the in memory invite wording's approval", async function (staff) {
  await adminCall(this, staff, "DELETE", `/api/admin/fundraising/invite-wording/${WORDING_KEY}/approval`, {});
});

Then("the invite wording has the subject {string} and is waiting for sign off", function (subject) {
  assert.equal(this.frBody.subject, subject);
  assert.equal(this.frBody.wordingKey, WORDING_KEY);
  assert.equal(this.frBody.approval, null);
  assert.ok(String(this.frBody.html).includes("A page in their memory"));
  // An example to read: never a real link.
  assert.ok(!/invite=/.test(String(this.frBody.html)));
});

// ---- what is kept, and what went ----

Then("the invite to {string} is kept as a {string} invite", async function (email, type) {
  const rows = await invitesTo(email);
  assert.equal(rows.length, 1, `expected one invite to ${email}`);
  assert.equal(rows[0].invite_type, type);
  assert.equal(rows[0].used_at, null);
});

Then("the invite to {string} is kept with no type", async function (email) {
  const rows = await invitesTo(email);
  assert.equal(rows.length, 1, `expected one invite to ${email}`);
  assert.equal(rows[0].invite_type, null);
});

Then("there is no invite to {string}", async function (email) {
  assert.equal((await invitesTo(email)).length, 0);
});

Then("a {string} email with the subject {string} went to {string}", async function (kind, subject, email) {
  const r = await pool.query(
    "SELECT subject FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2) AND created_at > now() - interval '10 minutes' ORDER BY id DESC",
    [kind, email],
  );
  assert.ok(r.rows.length > 0, `no ${kind} email went to ${email}`);
  assert.equal(r.rows[0].subject, subject);
});

// ---- where the form opens ----

const OPENS = {
  raising: { path: "raising" },
  "raising, as a team": { path: "raising", team: "team" },
  event: { path: "event" },
  memory: { path: "memory" },
  "no choice": {},
};

// Only the name, the email and where the form opens: never an answer about age, a consent or a
// permission.
Then("the form opens on {string} for first name {string}, surname {string} and {string}, and nothing else", function (opensOn, firstName, lastName, email) {
  assert.ok(opensOn in OPENS, `unknown place: ${opensOn}`);
  assert.deepEqual(this.frBody, { name: `${firstName} ${lastName}`, firstName, lastName, email, ...OPENS[opensOn] });
});

// ---- the admin page ----

When("the admin page and its script are read", async function () {
  this.adminHtml = await (await fetch(`${BASE_URL}/admin`)).text();
  this.adminJs = await (await fetch(`${BASE_URL}/assets/js/admin/app.js`)).text();
});

Then(
  "the invite form has a required drop-down {string} with nothing chosen and the choices {string}, {string}, {string} and {string}",
  function (label, a, b, c, d) {
    const html = this.adminHtml;
    assert.ok(html.includes(`<label class="fx-call-label" for="frInviteType">${label}</label>`), "no label for the drop-down");
    const select = (html.match(/<select[^>]*id="frInviteType"[^>]*>[\s\S]*?<\/select>/) || [""])[0];
    assert.ok(/\srequired[\s>]/.test(select), "the drop-down is not required");
    const options = [...select.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((m) => ({ attrs: m[1], text: m[2] }));
    assert.deepEqual(options.map((o) => o.text), ["Choose one", a, b, c, d]);
    // Nothing chosen for staff: only the empty choice is selected, and it cannot be picked again.
    assert.ok(/value=""/.test(options[0].attrs) && /selected/.test(options[0].attrs) && /disabled/.test(options[0].attrs));
    for (const o of options.slice(1)) assert.ok(!/selected/.test(o.attrs), `${o.text} is chosen for them`);
  },
);

Then("the question before sending names the type, the full name, the email and the signer, as in {string}", function (example) {
  const js = this.adminJs;
  // The words the page puts together (assets/js/admin/app.js, frSendInvite).
  const phrase = (js.match(/memory: \{ label: "In memory", phrase: "([^"]+)"/) || [])[1];
  assert.ok(phrase, "no words for the in memory type");
  assert.ok(js.includes('"Send " + FR_INVITE_TYPES[type].phrase + " to " + name + " at " + email + ", signed by " + signer + "?"'), "the question is not put together as expected");
  assert.equal(`Send ${phrase} to Mary Smith at mary@example.com, signed by Jaimie?`, example);
});
