const { Given, When, Then, Before, After } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createHash, randomBytes } = require("node:crypto");

// Steps for fundraising-team.feature (TASK-503): the invite, the calls, taking a fundraiser off Get
// involved, and who gets the Monday summary. The shared fundraising steps (staff, switching on,
// arranging an approved fundraiser, Get involved, the page, "the fundraising answer is") are in
// fundraising.steps.js, which also clears fundraisers and staff before and after every @fundraising
// scenario. This file clears what only these scenarios make: invites to the invented addresses, and
// those addresses on the Monday summary's list (the rest of the list is left exactly as it was).
//
// Everything made here is marked like the rest: titles carry "(bdd-fr)", addresses end
// "fr.bdd@example.com". Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STAFF = "%fr.bdd@example.com";
const PASSWORD = "pw-fundraising-bdd";
// As src/fundraising/invite.ts: only this hash of the token is ever stored.
const TOKEN_DOMAIN = "fundraiseinvite.v1:";
const hashToken = (token) => createHash("sha256").update(TOKEN_DOMAIN + token).digest("hex");

async function clean() {
  await pool.query("DELETE FROM fundraiser_invites WHERE email LIKE $1", [STAFF]);
  await pool.query(
    `UPDATE fundraising_settings
        SET summary_recipients = COALESCE(
              (SELECT jsonb_agg(e) FROM jsonb_array_elements_text(summary_recipients) AS e WHERE e NOT LIKE $1),
              '[]'::jsonb)
      WHERE id = 1`,
    [STAFF],
  );
}

Before({ tags: "@fundraising-team" }, clean);
After({ tags: "@fundraising-team" }, clean);

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

async function call(world, method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

const adminCall = async (world, email, method, path, body) => call(world, method, path, body, await login(email));

async function fundraiserId(title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].id;
}

async function inviteTo(email) {
  const r = await pool.query("SELECT * FROM fundraiser_invites WHERE email = lower($1) ORDER BY id DESC LIMIT 1", [email]);
  assert.ok(r.rows[0], `no invite to ${email}`);
  return r.rows[0];
}

// ---- arranging ----

Given("an invite to {string} at {string} whose link we know", async function (name, email) {
  // Made as the admin makes one, so the test knows the token the email would have carried.
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO fundraiser_invites (name, email, note, signed_by, sent_by, token_hash)
     VALUES ($1, lower($2), 'Lovely to talk today.', 'Fern', 'admin:fern.fr.bdd@example.com', $3)`,
    [name, email, hashToken(token)],
  );
  this.inviteToken = token;
  this.invite = { name, email };
});

Given("an approved fundraiser {string} dated {string}", async function (title, date) {
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, event_date, public, status, organiser_name,
                              organiser_email, organiser_phone, approved_at, approved_by, updated_by)
     VALUES ($1, 'raising', 'run_walk', $2, 'A test fundraiser.', $3::date, true, 'approved', 'Jo Testperson',
             'jo.team.fr.bdd@example.com', '07700 900125', now(), 'bdd', 'bdd')`,
    [`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${randomBytes(3).toString("hex")}`, title, date],
  );
});

// ---- inviting ----

When("{string} invites {string} at {string}, signed by themselves", async function (staff, name, email) {
  const me = await pool.query("SELECT id FROM users WHERE email = $1", [staff]);
  assert.ok(me.rows[0], `no staff member ${staff}`);
  await adminCall(this, staff, "POST", "/api/admin/fundraising/invites", {
    name,
    email,
    note: "Lovely to talk today. Here is the form we mentioned.",
    signedBy: Number(me.rows[0].id),
  });
});

Then("a {string} email went to {string}", async function (kind, email) {
  const r = await pool.query(
    "SELECT 1 FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2) AND created_at > now() - interval '10 minutes'",
    [kind, email],
  );
  assert.ok(r.rows.length > 0, `no ${kind} email went to ${email}`);
});

Then("the invite to {string} is kept with a hash of its link, not the link", async function (email) {
  const row = await inviteTo(email);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  // The answer to staff never carries the token or its hash either.
  const sent = JSON.stringify(this.frBody);
  assert.ok(!sent.includes(row.token_hash), "the hash came back to the page");
  assert.ok(!/token/i.test(sent), "a token came back to the page");
  assert.equal(row.used_at, null);
});

When("the sign up form asks for that invite", async function () {
  await call(this, "POST", "/api/fundraise/invite", { token: this.inviteToken });
});

Then("the form is given {string} and {string}, and nothing else", function (name, email) {
  assert.deepEqual(this.frBody, { name, email });
});

When("someone signs up {string} from that invite", async function (title) {
  await call(this, "POST", "/api/fundraise", {
    path: "raising",
    kind: "santa_dash",
    title,
    description: "Baking for a good cause.",
    eventDate: "",
    startTime: "",
    venue: "",
    town: "Exampleton",
    targetPence: 20000,
    public: true,
    name: this.invite.name,
    email: this.invite.email,
    phone: "07700 900126",
    socialLink: "",
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, shoutOut: false, attend: false },
    newsletterOk: false,
    company: "",
    invite: this.inviteToken,
  });
});

Then("the invite to {string} is used by {string}", async function (email, title) {
  const row = await inviteTo(email);
  assert.ok(row.used_at, "the invite is not marked used");
  assert.equal(Number(row.used_by_fundraiser_id), Number(await fundraiserId(title)));
});

// ---- Get involved ----

When("{string} takes {string} off Get involved", async function (staff, title) {
  await adminCall(this, staff, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/off-list`);
});

When("{string} puts {string} back on Get involved", async function (staff, title) {
  await adminCall(this, staff, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/on-list`);
});

Then("the history of {string} records {string}", async function (title, action) {
  const r = await pool.query(
    "SELECT 1 FROM audit_log WHERE entity = 'fundraiser' AND entity_id = $1 AND action = $2",
    [await fundraiserId(title), action],
  );
  assert.ok(r.rows.length > 0, `${action} is not in the history of ${title}`);
});

// ---- calls ----

When("{string} records the call before {string}", async function (staff, title) {
  await adminCall(this, staff, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/calls`, {
    which: "before",
    note: "Left a message (bdd-fr).",
  });
});

// ---- the Monday summary ----

When("{string} sets the Monday summary to go to {string}", async function (staff, email) {
  await adminCall(this, staff, "PUT", "/api/admin/fundraising/summary", { recipients: [email] });
});

When("{string} sends a test of the Monday summary", async function (staff) {
  await adminCall(this, staff, "POST", "/api/admin/fundraising/summary/test");
});
