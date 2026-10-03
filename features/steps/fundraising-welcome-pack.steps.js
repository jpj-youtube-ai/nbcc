const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");

// Steps for fundraising-welcome-pack.feature: the welcome pack tick list in Admin > Fundraising. The
// shared fundraising steps (the switch, staff, "the fundraising answer is") are in
// fundraising.steps.js, which also clears fundraisers and staff before and after every @fundraising
// scenario; a fundraiser's pack goes with it (ON DELETE CASCADE).
//
// Everything made here is marked like the rest: titles carry "(bdd-fr)", and every address is this
// feature's own, ending "pack.fr.bdd@example.com", so no other feature's rows are ever touched.
// Every name and address is invented.

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

async function adminCall(world, email, method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers.Authorization = `Bearer ${await login(email)}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.frStatus = res.status;
  const text = await res.text();
  world.packPage = text;
  try {
    world.frBody = JSON.parse(text);
  } catch {
    world.frBody = {};
  }
  return world.frBody;
}

async function fundraiserId(title) {
  const r = await pool.query("SELECT id FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0].id;
}

const slugFor = (title) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${randomBytes(3).toString("hex")}`;
const wants = (over) => JSON.stringify({ posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false, ...over });
const firstWord = (title) => title.split(/['\s]/)[0];

// Someone raising money for a sporting event, approved, as the tidied sign up form stores it.
async function sporting(title, size, posters) {
  const first = firstWord(title);
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, target_pence, public, status, organiser_name, first_name, last_name,
                              organiser_email, organiser_phone, wants, post_line1, post_town, post_postcode,
                              is_sporting, tshirt_size, approved_at, approved_by, updated_by)
     VALUES ($1, 'raising', 'other', $2, 'A test fundraiser.', 50000, true, 'approved', $3, $4, 'Example',
             $5, '07700 900150', $6::jsonb, '1 Example Road', 'Exampleton', 'EX1 1EX',
             true, $7, now(), 'bdd', 'bdd')`,
    [slugFor(title), title, `${first} Example`, first, `${first.toLowerCase()}.pack.fr.bdd@example.com`, wants({ posterCount: posters }), size],
  );
}

Given(
  "an approved sporting fundraiser {string} with the T-shirt size {string} asking for {int} posters",
  async function (title, size, posters) {
    await sporting(title, size, posters);
  },
);

Given("an approved sporting fundraiser {string} with no T-shirt size", async function (title) {
  await sporting(title, null, 0);
});

Given("an approved event {string} asking for {int} posters", async function (title, posters) {
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, event_date, start_time, venue, town, public, status,
                              organiser_name, first_name, last_name, organiser_email, organiser_phone, wants,
                              post_line1, post_town, post_postcode, approved_at, approved_by, updated_by, slug_set_at)
     VALUES ($1, 'event', 'other', $2, 'A quiz for NBCC.', '2099-11-22', '19:00', 'Example Church Hall', 'Exampleton', true,
             'approved', 'Iona Example', 'Iona', 'Example', 'iona.pack.fr.bdd@example.com', '07700 900151', $3::jsonb,
             '3 Sample Lane', 'Exampleton', 'EX2 2EX', now(), 'bdd', 'bdd', now())`,
    [slugFor(title), title, wants({ posterCount: posters })],
  );
});

Given("an approved page in memory of {string} asking for {int} collection envelopes", async function (name, envelopes) {
  const title = `In memory of ${name}`;
  await pool.query(
    `INSERT INTO fundraisers (slug, path, kind, title, description, public, status, organiser_name, first_name, last_name,
                              organiser_email, organiser_phone, wants, post_line1, post_town, post_postcode,
                              approved_at, approved_by, updated_by,
                              in_memory, memory_name, memory_setup_by, memory_permission, memory_show_target)
     VALUES ($1, 'raising', 'other', $2, 'Remembering her.', true, 'approved', 'Callum Example', 'Callum', 'Example',
             'callum.pack.fr.bdd@example.com', '07700 900152', $3::jsonb, '22 Sample Street', 'Exampleton', 'EX3 3EX',
             now(), 'bdd', 'bdd', true, $4, 'family', true, false)`,
    [slugFor(title), title, wants({ envelopeCount: envelopes }), name],
  );
});

When("{string} reads the welcome packs", async function (email) {
  await adminCall(this, email, "GET", "/api/admin/fundraising/packs");
});

When("the welcome packs are read without a session", async function () {
  await adminCall(this, null, "GET", "/api/admin/fundraising/packs");
});

async function change(world, email, title, body) {
  return adminCall(world, email, "POST", `/api/admin/fundraisers/${await fundraiserId(title)}/pack`, body);
}

When("{string} ticks {string} in the pack for {string}", async function (email, key, title) {
  await change(this, email, title, { action: "tick", key });
});

When("{string} leaves {string} out of the pack for {string} because {string}", async function (email, key, title, reason) {
  await change(this, email, title, { action: "skip", key, reason });
});

When("{string} marks the pack for {string} as sent", async function (email, title) {
  await change(this, email, title, { action: "send" });
});

When("{string} undoes the sent pack for {string}", async function (email, title) {
  await change(this, email, title, { action: "undo" });
});

When("{string} opens the print view of the pack for {string}", async function (email, title) {
  await adminCall(this, email, "GET", `/api/admin/fundraisers/${await fundraiserId(title)}/pack/print`);
});

async function packOf(world, title) {
  const pack = (world.frBody.packs || {})[String(await fundraiserId(title))];
  assert.ok(pack, `no pack for ${title}`);
  return pack;
}
const wordsOf = (pack) => pack.items.map((i) => i.words);

Then("the pack for {string} is called {string} and is {string}", async function (title, name, state) {
  const pack = await packOf(this, title);
  assert.equal(pack.title, name);
  assert.equal(pack.stateLabel, state);
});

Then("the pack for {string} lists {string}", async function (title, words) {
  const list = wordsOf(await packOf(this, title));
  assert.ok(list.includes(words), `"${words}" is not in the pack for ${title}: ${list.join(", ")}`);
});

Then("the pack for {string} does not list {string}", async function (title, words) {
  const list = wordsOf(await packOf(this, title));
  assert.ok(!list.includes(words), `"${words}" is in the pack for ${title}`);
});

Then("the pack for {string} has no T-shirt", async function (title) {
  const pack = await packOf(this, title);
  assert.equal(pack.items.find((i) => i.key === "tshirt"), undefined);
});

Then("the pack for {string} is addressed to {string} at {string} {string} {string}", async function (title, name, line1, town, postcode) {
  const pack = await packOf(this, title);
  assert.equal(pack.address.name, name);
  assert.deepEqual(pack.address.lines, [line1, town, postcode]);
});

Then("{string} has a pack to send", async function (title) {
  assert.equal((this.frBody.toSend || {})[String(await fundraiserId(title))], true);
});

Then("{string} has no pack to send", async function (title) {
  assert.equal((this.frBody.toSend || {})[String(await fundraiserId(title))], undefined);
});

Then("the pack answer is {string}", function (state) {
  assert.equal(this.frBody.pack && this.frBody.pack.stateLabel, state);
});

Then("the pack for {string} is stored as sent by {string}", async function (title, actor) {
  const r = await pool.query("SELECT sent_at, sent_by FROM welcome_packs WHERE fundraiser_id = $1", [await fundraiserId(title)]);
  assert.ok(r.rows[0] && r.rows[0].sent_at, "the pack is not stored as sent");
  assert.equal(r.rows[0].sent_by, actor);
});

Then("nothing is ticked in the pack for {string}", async function (title) {
  const r = await pool.query(
    "SELECT count(*)::int AS n FROM welcome_pack_items i JOIN welcome_packs p ON p.id = i.pack_id WHERE p.fundraiser_id = $1",
    [await fundraiserId(title)],
  );
  assert.equal(r.rows[0].n, 0);
});

Then("the history of {string} says {string} of its pack", async function (title, words) {
  const r = await pool.query(
    "SELECT data->>'words' AS words FROM audit_log WHERE entity = 'fundraiser' AND entity_id = $1 AND action = 'fundraiser.pack_updated' ORDER BY id",
    [await fundraiserId(title)],
  );
  const all = r.rows.map((row) => row.words);
  assert.ok(all.includes(words), `"${words}" is not in the history: ${all.join("; ")}`);
});

Then("the print view shows {string}", function (words) {
  // The page escapes an apostrophe as &#39;.
  const page = String(this.packPage || "").replace(/&#39;/g, "'");
  assert.ok(page.includes(words), `"${words}" is not in the print view`);
});

Then("the print view has {int} copies of the A4 poster", function (copies) {
  assert.ok(String(this.packPage || "").includes(`data-pack-piece="posters_a4" data-copies="${copies}"`), "the A4 poster's copies are not as expected");
});
