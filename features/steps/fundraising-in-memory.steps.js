const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");

// Steps for fundraising-in-memory.feature (Jaimie, 2026-10-03). The switch, the staff accounts,
// approving, giving on the page, "the fundraising answer is" and the clean up are
// fundraising.steps.js's; "names the field" and "no fundraiser called" are
// fundraising-age-split.steps.js's; signing the organiser in is fundraising-private.steps.js's.
// Everything made here carries "(bdd-fr)" in its title and invented addresses ending
// "fr.bdd@example.com", so that clean up takes it away. Every name and address is invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

async function call(world, method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.frStatus = res.status;
  world.frBody = await res.json().catch(() => ({}));
  return world.frBody;
}

async function fundraiser(title) {
  const r = await pool.query(
    `SELECT id, slug, in_memory, memory_name, memory_setup_by, memory_permission, memory_show_target
       FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1`,
    [title],
  );
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

// A raising money sign up in memory of someone, as the form sends it, every yes or no answered.
function memorySignUp(title, name, permission) {
  return {
    path: "raising",
    kind: "other",
    kindOther: "A collection at the funeral",
    title,
    description: "Remembering a kind and generous neighbour.",
    eventDate: "",
    startTime: "",
    venue: "",
    town: "Exampleton",
    targetPence: 50000,
    public: true,
    firstName: "Sam",
    lastName: "Sample",
    email: "friend.memory.fr.bdd@example.com",
    phone: "07700 900131",
    instagram: "",
    facebook: "",
    socialOk: false,
    over18: true,
    sharesWithOther: false,
    inMemory: true,
    memoryName: name,
    memoryDates: "1948 to 2026",
    memorySetupBy: "friend",
    memoryPermission: permission,
    memoryShowTarget: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, qrCount: 0, shoutOut: false, attend: false },
    newsletterOk: false,
    company: "",
  };
}

When(
  "a friend signs up {string} in memory of {string}, with the family's permission and a hidden target",
  async function (title, name) {
    await call(this, "POST", "/api/fundraise", memorySignUp(title, name, true));
  },
);

When("a friend signs up {string} in memory of {string}, without the family's permission", async function (title, name) {
  await call(this, "POST", "/api/fundraise", memorySignUp(title, name, false));
});

Then(
  "the fundraiser {string} is stored in memory of {string}, set up by {string}, with permission",
  async function (title, name, who) {
    const f = await fundraiser(title);
    assert.equal(f.in_memory, true);
    assert.equal(f.memory_name, name);
    assert.equal(f.memory_setup_by, who);
    assert.equal(f.memory_permission, true);
    assert.equal(f.memory_show_target, false);
  },
);

Then("the organiser of {string} was sent the in memory email", async function (title) {
  const r = await pool.query(
    `SELECT e.subject FROM email_log e JOIN fundraisers f ON lower(f.organiser_email) = lower(e.recipient)
      WHERE f.title = $1 AND e.kind = 'fundraiseApproved' AND e.created_at > now() - interval '10 minutes'`,
    [title],
  );
  assert.ok(r.rows.length > 0, `no approval email to the organiser of ${title}`);
  assert.match(String(r.rows[0].subject), /^Your page in memory of /);
});

Then("the page for {string} says {string}, with no countdown and no target", async function (title, words) {
  const f = await fundraiser(title);
  const res = await fetch(`${BASE_URL}/fundraise/${f.slug}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(words), `the page does not say ${words}`);
  assert.ok(html.includes("fr-memory-page"), "the page is not the quieter one");
  assert.doesNotMatch(html, /fr-countdown|fr-today|Good luck/);
  assert.doesNotMatch(html, /£500/);
  const api = await call(this, "GET", `/api/fundraisers/${f.slug}`);
  assert.equal(api.meter.targetPence, null);
  assert.equal(api.memory.name, words.replace(/^In memory of /, ""));
});

// Arranged in the database: an approved, public, in memory page with a target it does not show.
Given("an approved in memory page {string} organised by {string}", async function (title, email) {
  const slug = `ime-${randomBytes(3).toString("hex")}`;
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, target_pence, public, status, organiser_name,
                              organiser_email, organiser_phone, approved_at, approved_by, updated_by,
                              in_memory, memory_name, memory_dates, memory_setup_by, memory_permission, memory_show_target)
     VALUES ($1, 'raising', 'other', $2, 'Remembering Robin.', 50000, true, 'approved', 'Sam Sample', $3, '07700 900131',
             now(), 'bdd', 'bdd', true, 'Robin Example', '1950 to 2026', 'family', true, false)`,
    [slug, title, email],
  );
});

// The thank you's optional step, as the page sends it, with the family tick.
When("the giver adds the message {string} to {string}, asking to let the family know", async function (message, title) {
  const f = await fundraiser(title);
  assert.ok(this.frSessionId, "no gift given in this scenario");
  await call(
    this,
    "POST",
    `/api/fundraisers/${f.slug}/wall-message`,
    { sessionId: this.frSessionId, message, showName: true, showAmount: true, familyNotify: true },
    { Origin: new URL(BASE_URL).origin },
  );
});

async function wallMessages(world, title) {
  const f = await fundraiser(title);
  const page = await call(world, "GET", `/api/fundraisers/${f.slug}`);
  return (page.wall || []).map((w) => w.message);
}

Then("the page for {string} does not show the message {string}", async function (title, message) {
  assert.ok(!(await wallMessages(this, title)).includes(message), "the message shows before staff approved it");
});

Then("the page for {string} shows the message {string}", async function (title, message) {
  assert.ok((await wallMessages(this, title)).includes(message), "the approved message does not show");
});

When("{string} approves the message on {string}", async function (email, title) {
  const f = await fundraiser(title);
  const d = await pool.query("SELECT id FROM donations WHERE fundraiser_id = $1 AND supporter_message IS NOT NULL ORDER BY id DESC LIMIT 1", [f.id]);
  assert.ok(d.rows[0], "no message on the page");
  const token = await login(email);
  await call(this, "POST", `/api/admin/fundraisers/${f.id}/wall/${d.rows[0].id}/approve`, {}, { Authorization: `Bearer ${token}` });
});

Then("the private area shows {string} as asking to let the family know, with no amount", function (name) {
  assert.equal(this.frStatus, 200, JSON.stringify(this.frBody));
  const f = (this.frBody.fundraisers || [])[0];
  assert.ok(f, "the private area lists nothing");
  const gift = (f.gifts || []).find((g) => g.name === name);
  assert.ok(gift, `${name} is not listed: ${JSON.stringify(f.gifts)}`);
  assert.equal(gift.amountPence, null);
  assert.equal(gift.message, "Thinking of you all.");
  assert.doesNotMatch(JSON.stringify(f.gifts), /@example\.com/);
});

When("{string} corrects the in memory name of {string} to {string}", async function (email, title, name) {
  const f = await fundraiser(title);
  const token = await login(email);
  await call(
    this,
    "PUT",
    `/api/admin/fundraisers/${f.id}/memory`,
    { memoryName: name, memoryDates: "1950 to 2026", memorySetupBy: "family", memoryShowTarget: false },
    { Authorization: `Bearer ${token}` },
  );
});

// The name of the page follows a correction when it was named for them, so this one is named for
// "Kit Example (bdd-fr)" exactly (the marker keeps it in the clean up).
Given(
  "an approved in memory page {string} remembering {string}, organised by {string}",
  async function (title, name, email) {
    const slug = `ime-${randomBytes(3).toString("hex")}`;
    const r = await pool.query(
      `INSERT INTO fundraisers (slug, path, kind, title, description, target_pence, public, status, organiser_name,
                                organiser_email, organiser_phone, approved_at, approved_by, updated_by,
                                in_memory, memory_name, memory_setup_by, memory_permission, memory_show_target)
       VALUES ($1, 'raising', 'other', $2, 'Remembering Kit.', 50000, true, 'approved', 'Sam Sample', $3, '07700 900131',
               now(), 'bdd', 'bdd', true, $4, 'family', true, false)
       RETURNING id, slug`,
      [slug, title, email, name],
    );
    this.memoryPage = r.rows[0];
  },
);

Then("the public page of that in memory page is called {string} and remembers {string}", async function (title, name) {
  assert.ok(this.memoryPage, "no in memory page in this scenario");
  const page = await call(this, "GET", `/api/fundraisers/${this.memoryPage.slug}`);
  assert.equal(page.title, title);
  assert.equal(page.memory.name, name);
});
