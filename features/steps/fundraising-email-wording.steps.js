const { When } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-email-wording.feature (Jaimie, 2026-10-04): a team signed up, and a member
// joining, with addresses of this feature's own (ending wording.fr.bdd@example.com), so its checks of
// the email log are never muddied by another feature's emails. The switches, staff accounts,
// approving and the email log checks are fundraising.steps.js's, fundraising-touch.steps.js's,
// fundraising-private.steps.js's and fundraising-invite-types.steps.js's; every "(bdd-fr)" fundraiser
// is cleaned up by fundraising.steps.js. Every name and address here is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ORIGIN = new URL(BASE_URL).origin;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

When("{string} signs up the wording team {string}", async function (email, title) {
  await call(this, "POST", "/api/fundraise", {
    path: "raising",
    kind: "santa_dash",
    kindOther: "",
    title,
    description: "A team, dashing in Santa suits.",
    eventDate: "2099-12-05",
    startTime: "",
    venue: "",
    town: "Exampleton",
    targetPence: 200000,
    public: true,
    firstName: "Robin",
    lastName: "Organiser",
    email,
    phone: "07700 900111",
    instagram: "",
    facebook: "",
    socialOk: false,
    over18: true,
    sharesWithOther: false,
    team: "team",
    teamShareMode: null,
    teamMembers: [],
    postLine1: "1 Example Road", postLine2: "", postTown: "Exampleton", postPostcode: "EX1 1EX", splitConfirmed: true,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
    newsletterOk: false,
    company: "",
  });
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});

When("{string} joins the wording team {string} as {string}", async function (first, title, email) {
  const r = await pool.query("SELECT slug FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  await call(this, "POST", `/api/fundraise/teams/${r.rows[0].slug}/join`, { firstName: first, lastName: "Sample", email, over18: true, why: "", company: "" });
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
});
