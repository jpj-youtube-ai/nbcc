const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Pool } = require("pg");
const { randomBytes, scryptSync } = require("node:crypto");

// Steps for red-bag-list.feature. Drives /api/admin/red-bag-list and the public page /fill over
// HTTP against the real database. The staff come from the shared @admin steps (emails ending
// admin.bdd@example.com, which its Before hook clears).
//
// LEAVING NOTHING BEHIND. Other scenarios read /fill and expect the list written in the code, and
// the app keeps the published list for a minute, so deleting rows here is not enough by itself:
// the app would go on drawing a list that is no longer in the table. So before and after every
// scenario, if anything was published, the original list is put back and published THROUGH THE API
// (which makes the app read the list again at once), and only then are the rows removed. The page
// is then drawn from a list that says exactly what the code's list says, until the minute is up.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const API = "/api/admin/red-bag-list";
const HOOK_ADMIN = "hook.redbaglist.admin.bdd@example.com";
const HOOK_PASSWORD = "redbag-list-hook-pw-1";
const PASSWORD = "redbag-list-pw-1";
const MIGRATION = path.resolve(__dirname, "../../migrations/1791200000270_red-bag-lists.js");
// The sections that existed when saved matrices arrived (as admin-permissions-backfill.steps.js).
const SECTIONS_BEFORE = ["overview", "search", "donations", "claims", "gasds", "subscriptions", "stories", "ticker", "contact", "newsletter", "thank-you", "audit", "team"];

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function login(email, password = PASSWORD) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
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

async function call(method, urlPath, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const stampOf = (state) => ({ version: state.draft ? state.draft.version : 0, publishedId: state.publishedId });

// The website back on the list written in the code, the app told so, and the table empty.
async function reset() {
  const published = await pool.query("SELECT 1 FROM red_bag_lists WHERE status = 'published' LIMIT 1");
  if (published.rows.length) {
    await pool.query("DELETE FROM users WHERE email = $1", [HOOK_ADMIN]);
    await pool.query("INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'Hook Testperson', 'admin', $2)", [HOOK_ADMIN, hashPassword(HOOK_PASSWORD)]);
    const token = await login(HOOK_ADMIN, HOOK_PASSWORD);
    const state = (await call("GET", API, token)).body;
    const put = await call("POST", `${API}/restore`, token, { from: "original", ...stampOf(state) });
    assert.equal(put.status, 200, `could not put the original list back: ${JSON.stringify(put.body)}`);
    // Refused as "nothing to publish" when the website already says what the original says: fine.
    const done = await call("POST", `${API}/publish`, token, { version: put.body.draft.version });
    assert.ok(done.status === 200 || done.status === 400, `could not publish the original list: ${JSON.stringify(done.body)}`);
    await pool.query("DELETE FROM users WHERE email = $1", [HOOK_ADMIN]);
  }
  await pool.query("DELETE FROM red_bag_lists");
}
Before({ tags: "@red-bag-list" }, reset);
After({ tags: "@red-bag-list" }, reset);
AfterAll(async () => {
  await pool.end();
});

// A stored map is a complete statement of access: this section at this level, and nothing else.
Given("{string} has {string} access to the Fill a Red Bag list and nothing else", async function (email, level) {
  await pool.query("UPDATE users SET permissions = $2::jsonb WHERE email = $1", [email, JSON.stringify({ "red-bag": level })]);
});

async function editor(world, email) {
  const token = email ? await login(email) : null;
  world.rblToken = token;
  world.rbl = await call("GET", API, token);
  return world.rbl;
}

When("someone with no session reads the Fill a Red Bag list editor", async function () {
  await editor(this, null);
});

When("{string} reads the Fill a Red Bag list editor", async function (email) {
  await editor(this, email);
});

// The whole list as the editor has it, with one item's price changed, saved against `stamp`.
async function saveDraft(world, email, key, pence, stamp) {
  const token = await login(email);
  const state = (await call("GET", API, token)).body;
  // Someone who may not read the editor has no list to change: send the smallest thing a save takes.
  const list = state.draft ? state.draft.data : state.website;
  const data = list ? JSON.parse(JSON.stringify(list)) : { v: 1, items: [], examples: [] };
  const item = (data.items || []).find((i) => i.key === key);
  if (item) item.pence = pence;
  world.rblStampBefore = list ? stampOf(state) : { version: 0, publishedId: null };
  world.rbl = await call("PUT", `${API}/draft`, token, { data, ...(stamp || world.rblStampBefore) });
  return world.rbl;
}

When("{string} saves a draft pricing {string} at {int} pence", async function (email, key, pence) {
  await saveDraft(this, email, key, pence);
});

Given("{string} has saved a draft pricing {string} at {int} pence", async function (email, key, pence) {
  const stampBefore = stampOf((await call("GET", API, await login(email))).body);
  const res = await saveDraft(this, email, key, pence);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  this.rblStampBeforeFirstSave = stampBefore;
});

When("{string} saves a draft pricing {string} at {int} pence against the stamp from before that save", async function (email, key, pence) {
  assert.ok(this.rblStampBeforeFirstSave, "no earlier save in this scenario");
  await saveDraft(this, email, key, pence, this.rblStampBeforeFirstSave);
});

async function publish(world, email) {
  const token = await login(email);
  const state = (await call("GET", API, token)).body;
  world.rbl = await call("POST", `${API}/publish`, token, { version: state.draft ? state.draft.version : 0 });
  return world.rbl;
}

When("{string} publishes the Fill a Red Bag draft", async function (email) {
  await publish(this, email);
});

Given("{string} has published the Fill a Red Bag draft", async function (email) {
  const res = await publish(this, email);
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

When("{string} throws the Fill a Red Bag draft away", async function (email) {
  const token = await login(email);
  const state = (await call("GET", API, token)).body;
  this.rbl = await call("POST", `${API}/discard`, token, { version: state.draft ? state.draft.version : 0 });
});

When("{string} puts the original Fill a Red Bag list back as a draft", async function (email) {
  const token = await login(email);
  const state = (await call("GET", API, token)).body;
  this.rbl = await call("POST", `${API}/restore`, token, { from: "original", ...stampOf(state) });
});

Then("the Fill a Red Bag list answer is {int}", function (status) {
  assert.equal(this.rbl.status, status, JSON.stringify(this.rbl.body));
});

Then("the Fill a Red Bag list answer says {string}", function (words) {
  assert.equal(this.rbl.body.error, words);
});

Then("the Fill a Red Bag list editor says {int} change(s) is/are waiting", function (n) {
  assert.equal(this.rbl.body.changes.length, n, JSON.stringify(this.rbl.body.changes));
});

Then("the Fill a Red Bag list editor says this person may not change it", function () {
  assert.equal(this.rbl.body.mayEdit, false);
});

Then("the Fill a Red Bag list editor has no draft", function () {
  assert.equal(this.rbl.body.draft, null);
});

Then("the Fill a Red Bag draft prices {string} at {int} pence", function (key, pence) {
  assert.ok(this.rbl.body.draft, "there is no draft");
  assert.equal(this.rbl.body.draft.data.items.find((i) => i.key === key).pence, pence);
});

Then("the Fill a Red Bag list history has {int} publish(es), the latest saying {string}", function (n, words) {
  const history = this.rbl.body.history;
  assert.equal(history.length, n, JSON.stringify(history));
  assert.ok(history[0].summary.includes(words), `"${history[0].summary}" does not say "${words}"`);
  assert.ok(history[0].publishedByName, "the latest publish names nobody");
  // Newest first.
  for (let i = 1; i < history.length; i += 1) assert.ok(history[i - 1].publishedAt >= history[i].publishedAt, "the history is not newest first");
});

Then("the audit log has a {string} row by {string}", async function (action, actor) {
  const found = await pool.query("SELECT 1 FROM audit_log WHERE action = $1 AND actor = $2 AND entity = 'red_bag_list' AND created_at > now() - interval '5 minutes'", [action, actor]);
  assert.ok(found.rows.length >= 1, `no ${action} row by ${actor}`);
});

// ---- the public page ----
async function readPage(world, urlPath, token) {
  const res = await fetch(`${BASE_URL}${urlPath}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  world.rblPage = { status: res.status, html: await res.text(), cache: res.headers.get("cache-control"), robots: res.headers.get("x-robots-tag") };
}

When("I read the Fill a Red Bag page", async function () {
  await readPage(this, "/fill");
});

When("I read the Fill a Red Bag draft preview with no session", async function () {
  await readPage(this, "/fill?preview=draft");
});

When("{string} reads the Fill a Red Bag draft preview", async function (email) {
  await readPage(this, "/fill?preview=draft", await login(email));
});

Then("the Fill a Red Bag page prices {string} at {int} pence", function (key, pence) {
  assert.equal(this.rblPage.status, 200);
  const row = new RegExp(`data-rb-item="${key}" data-pence="(\\d+)"`).exec(this.rblPage.html);
  assert.ok(row, `no row for ${key} on the page`);
  assert.equal(Number(row[1]), pence);
});

Then("the Fill a Red Bag page has no draft strip", function () {
  assert.ok(!this.rblPage.html.includes("Draft preview"), "the page has the draft strip");
  assert.ok(this.rblPage.html.includes('id="rbDetailsForm"'), "the page has no details form");
});

Then("the Fill a Red Bag page has the draft strip", function () {
  assert.ok(this.rblPage.html.includes("Draft preview: not on the website yet"), "the page has no draft strip");
});

Then("the Fill a Red Bag page has giving switched off", function () {
  assert.ok(!this.rblPage.html.includes('id="rbDetailsForm"'), "the draft preview has the details form");
  assert.ok(this.rblPage.html.includes('data-rb-draft="true"'), "the draft preview is not marked as one");
  assert.ok(this.rblPage.html.includes("This is a preview. Giving is switched off here."));
});

Then("the Fill a Red Bag page is never cached and never indexed", function () {
  assert.equal(this.rblPage.cache, "private, no-store");
  assert.equal(this.rblPage.robots, "noindex, nofollow");
});

// ---- the migration's backfill, on Postgres, inside a transaction that is always rolled back ----
When("the Fill a Red Bag list permissions backfill runs", async function () {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(require(MIGRATION).PERMISSIONS_BACKFILL);
    const users = await client.query("SELECT email, permissions FROM users WHERE email LIKE '%admin.bdd@example.com'");
    this.backfilled = Object.fromEntries(users.rows.map((row) => [row.email, row.permissions]));
    this.backfillLog = [];
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
});

// Kept beside the step that uses it, so it reads as one thing: what a matrix saved long ago names.
module.exports = { SECTIONS_BEFORE };
