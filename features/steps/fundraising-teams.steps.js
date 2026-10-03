const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const { Pool } = require("pg");

// Steps for fundraising-teams.feature (team pages, Jaimie, 2026-10-03). The switch, staff accounts,
// approving, giving on a page, the events inbox email and the clean up of every "(bdd-fr)"
// fundraiser are fundraising.steps.js's (a team's held invites and its member pages go with it: the
// invites ON DELETE CASCADE, every member page carrying "(bdd-fr)" in its title too); opening a page
// and "the page shows" are fundraising-pages.steps.js's and events.steps.js's; the split check is
// fundraising-age-split.steps.js's. Every name and address here is invented.
//
// An invite's token is only ever in the email, never stored or logged, so the scenario that joins
// from one gives that invite a token of its own (its hash, as the app stores it), then opens the join
// form's lookup and joins with it, exactly as the email's link would.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORIGIN = new URL(BASE_URL).origin;

async function call(world, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function fundraiser(title) {
  const r = await pool.query(
    "SELECT id, slug, status, is_team, team_id, shares_with_other, nbcc_share_percent, other_cause_name FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1",
    [title],
  );
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

// A team's sign up as the form sends it: raising money, every yes or no answered.
function teamSignUp(title, over) {
  return {
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
    email: "robin.team.fr.bdd@example.com",
    phone: "07700 900111",
    instagram: "",
    facebook: "",
    socialOk: false,
    over18: true,
    sharesWithOther: false,
    team: "team",
    teamShareMode: null,
    teamMembers: [],
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
    newsletterOk: false,
    company: "",
    ...over,
  };
}

When("someone signs up the team {string} adding {string} and {string}", async function (title, a, b) {
  await call(
    this,
    "POST",
    "/api/fundraise",
    teamSignUp(title, {
      teamMembers: [
        { firstName: "Ava", lastName: "Example", email: a },
        { firstName: "Ava", lastName: "Sample", email: b },
      ],
    }),
  );
});

When("someone signs up the team {string} sharing {int} percent with {string} for the whole team", async function (title, percent, cause) {
  await call(this, "POST", "/api/fundraise", teamSignUp(title, { sharesWithOther: true, nbccSharePercent: percent, otherCauseName: cause, teamShareMode: "team" }));
});

Then("{string} is stored as a team with {int} people held to invite", async function (title, n) {
  const f = await fundraiser(title);
  assert.equal(f.is_team, true);
  const r = await pool.query("SELECT count(*) AS n FROM team_invites WHERE team_id = $1 AND sent_at IS NULL AND deleted_at IS NULL", [f.id]);
  assert.equal(Number(r.rows[0].n), n);
});

// "no {string} email went to {string}" is fundraising-private.steps.js's (TASK-501), and
// "a {string} email went to {string}" fundraising-team.steps.js's (TASK-503).

Then("every invite of {string} is sent", async function (title) {
  const f = await fundraiser(title);
  const r = await pool.query("SELECT sent_at, token_hash FROM team_invites WHERE team_id = $1", [f.id]);
  assert.ok(r.rows.length > 0);
  for (const row of r.rows) {
    assert.ok(row.sent_at, "an invite was not sent");
    assert.match(String(row.token_hash), /^[0-9a-f]{64}$/);
  }
});

// The token the email would carry: made here, and only its hash given to the invite, as the app does.
When("the invite to {string} on {string} is opened", async function (email, title) {
  const f = await fundraiser(title);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(`teaminvite.v1:${token}`).digest("hex");
  const r = await pool.query("UPDATE team_invites SET token_hash = $1 WHERE team_id = $2 AND lower(email) = lower($3) RETURNING id", [hash, f.id, email]);
  assert.equal(r.rows.length, 1, `no invite to ${email}`);
  this.teamInviteToken = token;
  this.teamSlug = f.slug;
  await call(this, "POST", "/api/fundraise/team-invite", { token });
});

Then("the join form is filled in with {string} and {string}", function (first, email) {
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
  assert.equal(this.frBody.firstName, first);
  assert.equal(this.frBody.email, email);
  assert.equal(this.frBody.teamSlug, this.teamSlug);
});

function joinBody(first, last, over) {
  return { firstName: first, lastName: last, email: `${first.toLowerCase()}.join.fr.bdd@example.com`, over18: true, why: "", company: "", ...over };
}

When("they join {string} from that invite as {string} {string}, 18 or over", async function (title, first, last) {
  const f = await fundraiser(title);
  await call(this, "POST", `/api/fundraise/teams/${f.slug}/join`, joinBody(first, last, { email: "parent.team.fr.bdd@example.com", invite: this.teamInviteToken }));
});

When("{string} {string} joins {string}", async function (first, last, title) {
  const f = await fundraiser(title);
  await call(this, "POST", `/api/fundraise/teams/${f.slug}/join`, joinBody(first, last));
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});

When("{string} {string} joins {string}, saying they are not sharing", async function (first, last, title) {
  const f = await fundraiser(title);
  await call(this, "POST", `/api/fundraise/teams/${f.slug}/join`, joinBody(first, last, { sharesWithOther: false }));
});

When("{string} {string} joins {string}, under 18", async function (first, last, title) {
  const f = await fundraiser(title);
  await call(this, "POST", `/api/fundraise/teams/${f.slug}/join`, joinBody(first, last, { over18: false }));
});

Then("{string} is a member page of {string}, waiting for staff", async function (memberTitle, teamTitle) {
  const [m, t] = [await fundraiser(memberTitle), await fundraiser(teamTitle)];
  assert.equal(Number(m.team_id), Number(t.id));
  assert.equal(m.status, "new");
});

Then("the invite to {string} on {string} is joined", async function (email, title) {
  const f = await fundraiser(title);
  const r = await pool.query("SELECT joined_at, joined_fundraiser_id FROM team_invites WHERE team_id = $1 AND lower(email) = lower($2)", [f.id, email]);
  assert.ok(r.rows[0] && r.rows[0].joined_at, "the invite is not marked joined");
  assert.ok(r.rows[0].joined_fundraiser_id, "the invite is not linked to the member page");
});

When("a visitor opens the join form for {string}", async function (title) {
  const f = await fundraiser(title);
  const res = await fetch(`${BASE_URL}/fundraise/${f.slug}/join`, { redirect: "manual" });
  this.visitorStatus = res.status;
  this.visitorHeaders = res.headers;
  this.visitorBody = await res.text();
});

Then("the page lists {string} before {string}", function (first, second) {
  const a = this.visitorBody.indexOf(first);
  const b = this.visitorBody.indexOf(second);
  assert.ok(a > -1, `${first} is not on the page`);
  assert.ok(b > -1, `${second} is not on the page`);
  assert.ok(a < b, `${first} is not before ${second}`);
});

// ---- after the independent review ----

const path = require("node:path");
const { createHmac } = require("node:crypto");
const SECRET = process.env.ADMIN_SESSION_SECRET || "ci-admin-session-secret";
const PASSWORD = "pw-fundraising-bdd";

async function staffToken(email) {
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
  throw new Error(`could not sign in as ${email}`);
}

When("someone else signs up the team {string}", async function (title) {
  await call(this, "POST", "/api/fundraise", teamSignUp(title, { email: "kim.team.fr.bdd@example.com", firstName: "Kim", lastName: "Other" }));
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});

When("the invites of {string} were sent {int} days ago", async function (title, days) {
  const f = await fundraiser(title);
  await pool.query(
    "UPDATE team_invites SET created_at = now() - make_interval(days => $2), sent_at = now() - make_interval(days => $2) WHERE team_id = $1",
    [f.id, days],
  );
});

// The 8am task's team pass, as send-reminders.ts runs it (the compiled app, as the touch steps do).
When("the daily team pass runs", async function () {
  const { runTeamEmails } = require(path.resolve(__dirname, "../../dist/fundraising/team-runner.js"));
  this.teamRun = await runTeamEmails(new Date());
});

Then("every invite of {string} has had its names, email and links deleted", async function (title) {
  const f = await fundraiser(title);
  const r = await pool.query("SELECT first_name, last_name, email, token_hash, reminder_token_hash, deleted_at FROM team_invites WHERE team_id = $1", [f.id]);
  assert.ok(r.rows.length > 0);
  for (const row of r.rows) {
    assert.ok(row.deleted_at, "an invite was not deleted");
    assert.deepEqual([row.first_name, row.last_name, row.email, row.token_hash, row.reminder_token_hash], [null, null, null, null, null]);
  }
});

Then("no email log row names {string}", async function (email) {
  const r = await pool.query("SELECT kind FROM email_log WHERE lower(recipient) = lower($1) AND kind IN ('fundraiseTeamInvite', 'fundraiseTeamInviteReminder')", [email]);
  assert.equal(r.rows.length, 0, `${r.rows.length} invite rows still name ${email}`);
});

When("{string} hands {string} over to {string}", async function (staff, title, to) {
  const f = await fundraiser(title);
  const token = await staffToken(staff);
  const res = await fetch(`${BASE_URL}/api/admin/fundraisers/${f.id}/team/handover`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ firstName: "Sam", lastName: "Handover", email: to, phone: "07700 900321" }),
  });
  this.frStatus = res.status;
  this.frBody = await res.json().catch(() => ({}));
});

When("{string} puts in a wrong handover code {int} times", async function (email, n) {
  for (let i = 0; i < n; i += 1) {
    await call(this, "POST", "/api/fundraise/manage/handover", { email, code: "000000" });
    assert.equal(this.frStatus, 401, JSON.stringify(this.frBody));
  }
});

// The code only goes by email (stubbed in CI), so a code the step knows is put in its place, hashed as
// the server hashes it (src/fundraising/teams.ts handoverCodeKey, src/fundraising/sign-in.ts).
When("{string} puts in the right handover code for {string}", async function (email, title) {
  const f = await fundraiser(title);
  const known = "246810";
  const key = `team-handover:${f.id}:${email.trim().toLowerCase()}`;
  const hash = createHmac("sha256", SECRET).update(`fundraisecode.v1:${key}:${known}`).digest("base64url");
  await pool.query("UPDATE team_handovers SET code_hash = $2 WHERE team_id = $1 AND confirmed_at IS NULL AND cancelled_at IS NULL", [f.id, hash]);
  await call(this, "POST", "/api/fundraise/manage/handover", { email, code: known });
});

Then("the team organiser of {string} is still {string}", async function (title, email) {
  const r = await pool.query("SELECT organiser_email FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.equal(r.rows[0].organiser_email, email);
});

async function asOrganiser(world, method, urlPath) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `nbcc_fr_session=${world.frSession}` },
    body: method === "GET" ? undefined : "{}",
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
}

When("the signed in team organiser of {string} takes {string} off their team", async function (teamTitle, memberTitle) {
  const [t, m] = [await fundraiser(teamTitle), await fundraiser(memberTitle)];
  this.otherMemberId = m.id;
  await asOrganiser(this, "POST", `/api/fundraise/manage/fundraisers/${t.id}/team/members/${m.id}/remove`);
});

When("the signed in team organiser tries the same on {string}", async function (teamTitle) {
  const t = await fundraiser(teamTitle);
  await asOrganiser(this, "POST", `/api/fundraise/manage/fundraisers/${t.id}/team/members/${this.otherMemberId}/remove`);
});

Then("{string} is still on {string}", async function (memberTitle, teamTitle) {
  const r = await pool.query("SELECT team_id, team_left_at FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [memberTitle]);
  const t = await fundraiser(teamTitle);
  assert.equal(Number(r.rows[0].team_id), Number(t.id));
  assert.equal(r.rows[0].team_left_at, null);
});
