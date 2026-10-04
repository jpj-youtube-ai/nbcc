const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-small-fixes.feature. The switch, staff accounts, approving and "the
// fundraising answer is" are fundraising.steps.js's, which also clears every "(bdd-fr)" fundraiser
// before and after each @fundraising scenario (a team's held invites, a pack and its requests go
// with it). Opening an invite is fundraising-teams.steps.js's; the Do it again link is
// fundraising-touch.steps.js's; the pack's ticks, the event and the page in memory of someone are
// fundraising-welcome-pack.steps.js's.
//
// Every address made here is this feature's own, ending "smallfix.fr.bdd@example.com", so no other
// feature's rows are ever touched. Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORIGIN = new URL(BASE_URL).origin;
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
  const headers = { "Content-Type": "application/json" };
  if (email) headers.Authorization = `Bearer ${await login(email)}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  const text = await res.text();
  world.smallFixPage = text;
  try {
    world.frBody = JSON.parse(text);
  } catch {
    world.frBody = {};
  }
  return world.frBody;
}

async function fundraiser(title) {
  const r = await pool.query("SELECT id, slug, path FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

/** Today in the UK, as the Requests part sends it. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ---- a team member under 18 ----

// A team's sign up as the form sends it, with a tick beside the first person added.
When(
  "someone signs up the team {string} adding {string} as under 18 at {string} and {string} at {string}",
  async function (title, child, parentEmail, adult, adultEmail) {
    const res = await fetch(`${BASE_URL}/api/fundraise`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({
        path: "raising",
        kind: "santa_dash",
        kindOther: "",
        title,
        description: "The under 12s, dashing in Santa suits.",
        eventDate: "2099-12-05",
        startTime: "",
        venue: "",
        town: "Exampleton",
        targetPence: 200000,
        public: true,
        firstName: "Robin",
        lastName: "Organiser",
        email: "robin.smallfix.fr.bdd@example.com",
        phone: "07700 900141",
        instagram: "",
        facebook: "",
        socialOk: false,
        over18: true,
        sharesWithOther: false,
        team: "team",
        teamShareMode: null,
        teamMembers: [
          { firstName: child, lastName: "Sample", email: parentEmail, under18: true },
          { firstName: adult, lastName: "Example", email: adultEmail },
        ],
        postLine1: "1 Example Road",
        postLine2: "",
        postTown: "Exampleton",
        postPostcode: "EX1 1EX",
        splitConfirmed: true,
        wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
        newsletterOk: false,
        company: "",
      }),
    });
    this.frStatus = res.status;
    this.frBody = await res.json().catch(() => ({}));
  },
);

async function heldUnder18(title, email) {
  const f = await fundraiser(title);
  const r = await pool.query("SELECT under_18 FROM team_invites WHERE team_id = $1 AND lower(email) = lower($2)", [f.id, email]);
  assert.equal(r.rows.length, 1, `nobody is held at ${email}`);
  return r.rows[0].under_18;
}

Then("the person held at {string} on {string} is marked under 18", async function (email, title) {
  assert.equal(await heldUnder18(title, email), true);
});

Then("the person held at {string} on {string} is not marked under 18", async function (email, title) {
  assert.equal(await heldUnder18(title, email), false);
});

Then("the team invite sent to {string} has the subject {string}", async function (email, subject) {
  const r = await pool.query(
    "SELECT subject FROM email_log WHERE kind = 'fundraiseTeamInvite' AND lower(recipient) = lower($1) AND created_at > now() - interval '10 minutes' ORDER BY id DESC LIMIT 1",
    [email],
  );
  assert.ok(r.rows[0], `no team invite went to ${email}`);
  assert.equal(r.rows[0].subject, subject);
});

Then("the join form is told the person joining is under 18", function () {
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
  assert.equal(this.frBody.under18, true);
});

Then("the join form is not told the person joining is under 18", function () {
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
  assert.equal(this.frBody.under18, undefined);
});

// ---- the QR code to print ----

When("{string} opens the QR code to print for {string}", async function (email, title) {
  const f = await fundraiser(title);
  this.smallFixEvent = f;
  await adminCall(this, email, "GET", `/api/admin/fundraisers/${f.id}/materials/qr-code`);
});

When("the QR code to print for {string} is opened without a session", async function (title) {
  await adminCall(this, null, "GET", `/api/admin/fundraisers/${(await fundraiser(title)).id}/materials/qr-code`);
});

Then("the QR code page is one A4 page", function () {
  const page = String(this.smallFixPage || "");
  assert.ok(page.includes("@page{size:A4 portrait;margin:0}"), "the page is not set to print on A4");
  assert.equal((page.match(/class="page /g) || []).length, 1);
  assert.ok(page.includes('class="q-qr"'), "there is no QR code on the page");
});

Then("the QR code page shows {string}", function (words) {
  assert.ok(String(this.smallFixPage || "").includes(words), `"${words}" is not on the QR code page`);
});

Then("the QR code page shows the event's own web address", function () {
  assert.ok(String(this.smallFixPage || "").includes(`/event/${this.smallFixEvent.slug}</div>`), "the event's address is not under the code");
});

// ---- Do it again, for a page in memory of someone ----

Then("the form is given the in memory path, remembering {string}", function (name) {
  assert.equal(this.frBody.path, "memory");
  assert.equal(this.frBody.memoryName, name);
  assert.equal(this.frBody.email, "callum.pack.fr.bdd@example.com");
});

// ---- a request staff sent again by hand ----

When("{string} undoes the posters sent to {string} by hand in Requests", async function (email, title) {
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${(await fundraiser(title)).id}/requests/posters`, { action: "undo", from: "sent" });
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});

When("{string} marks {int} posters as sent to {string} by hand in Requests", async function (email, quantity, title) {
  await adminCall(this, email, "POST", `/api/admin/fundraisers/${(await fundraiser(title)).id}/requests/posters`, {
    action: "send",
    from: "to_send",
    on: today(),
    how: "dropped_off",
    by: "Fern",
    quantity,
  });
});

Then("the posters request for {string} stands as staff left it: {string} with {int}", async function (title, status, quantity) {
  const r = await pool.query("SELECT status, quantity, how FROM fundraiser_requests WHERE fundraiser_id = $1 AND kind = 'posters'", [(await fundraiser(title)).id]);
  assert.ok(r.rows[0], "no posters request is stored");
  assert.equal(r.rows[0].status, status);
  assert.equal(r.rows[0].quantity, quantity);
  assert.equal(r.rows[0].how, "dropped_off");
});

// ---- the one-off marking of the requests a pack changed (migration 1791200000240) ----

// The very statement the migration runs, so what is tested is what production ran.
const { BACKFILL_SQL } = require("../../migrations/1791200000240_team-invite-under-18.js");

async function postersChangedBy(title) {
  const r = await pool.query("SELECT updated_by FROM fundraiser_requests WHERE fundraiser_id = $1 AND kind = 'posters'", [(await fundraiser(title)).id]);
  assert.ok(r.rows[0], "no posters request is stored");
  return r.rows[0].updated_by;
}

// As the code before the mark left it: only the staff member, with its time untouched.
Given("the posters request for {string} is as the pack left it before the pack mark existed", async function (title) {
  const r = await pool.query(
    "UPDATE fundraiser_requests SET updated_by = substr(updated_by, 6) WHERE fundraiser_id = $1 AND kind = 'posters' AND updated_by LIKE 'pack:%' RETURNING updated_by",
    [(await fundraiser(title)).id],
  );
  assert.equal(r.rows.length, 1, "the posters request was not marked by the pack");
  assert.ok(!String(r.rows[0].updated_by).startsWith("pack:"));
});

When("the one-off marking of pack requests runs", async function () {
  await pool.query(BACKFILL_SQL);
});

Then("the posters request for {string} is last changed by the pack", async function (title) {
  const by = await postersChangedBy(title);
  assert.match(String(by), /^pack:admin:[^:]+$/, `it says ${by}`);
});

Then("the posters request for {string} is last changed by {string}", async function (title, actor) {
  assert.equal(await postersChangedBy(title), actor);
});
