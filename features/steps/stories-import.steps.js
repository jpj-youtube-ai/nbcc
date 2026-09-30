const { When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createHash } = require("node:crypto");

// Steps for stories-import.feature (TASK-461). Reads the SEPARATE stories database, as
// admin-stories.steps.js does. Every story here is invented and carries "(bdd-stories-import)", and
// is removed before and after each scenario. The staff come from the shared @admin steps.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const storiesPool = new Pool({ connectionString: process.env.STORIES_DATABASE_URL });
const MARK = "(bdd-stories-import)";
const PASSWORD = "import-pw-123";

// The old form's header row: its questions, not anyone's answers.
const HEADER = [
  "Submission date",
  "Your story",
  "Short quote. This is a  short sentence we could use as a quote if you are happy for your story to be shared",
  "Are you happy for us to share your story publicly?",
  "If you selected 'Yes' above, are you happy for us to share your first name?",
  "If you selected 'Yes' above, are you happy for us to share your Town/Area?",
  "If you select ‘No’ above, are you happy for us to use your story internally only (for volunteer training, impact reporting or service improvement?",
  "Is there anything else you'd like to share with us, such as feedback, ideas or things we could do better?",
  "First name (leave this blank if you wish to be anonymous)",
  "Email (optional, just in case you're happy for us to contact you about your story). ",
  "Phone (optional, just in case you're happy for us to contact you about your story). ",
  "Your age",
  "How do you describe your gender?",
  "Your Town/Area",
  "The Red Bag went to a:",
  "How did you hear about us?",
  "I confirm that I am over 16 and that the information I’ve provided is accurate.",
];

function submission({ sent, story, first, email, town }) {
  return [sent, `${story} ${MARK}`, "", "Yes", "Yes", "Yes", "", "", first, email, "", "25 to 44", "", town, "Child", "", "Checked"];
}

const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvOf = (rows) => [HEADER, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

// Three invented submissions, newest first as the old site exported them: Morag's, then Callum's
// story sent twice, two minutes and twenty seconds apart.
const SUBMISSIONS = [
  submission({
    sent: "2026-07-06T19:30:12.345Z",
    story: "The Red Bag made our Christmas.",
    first: "Morag",
    email: "morag.import.bdd@example.com",
    town: "Irvine",
  }),
  submission({
    sent: "2026-07-02T10:02:20.000Z",
    story: "We volunteer every year, second go.",
    first: "Callum",
    email: "callum.import.bdd@example.com",
    town: "Troon",
  }),
  submission({
    sent: "2026-07-02T10:00:00.000Z",
    story: "We volunteer every year, first go.",
    first: "Callum",
    email: "callum.import.bdd@example.com",
    town: "Troon",
  }),
];
const EXPORT = csvOf(SUBMISSIONS);

// TASK-475: the fingerprint erasing one of these leaves in erased_stories (src/stories/old-site-
// import.ts erasedFingerprint: a sha256 of the moment it was sent and its words), so clean() can
// forget them again and every scenario starts from nothing.
const FINGERPRINTS = SUBMISSIONS.map(([sent, story]) =>
  createHash("sha256").update(`${new Date(sent).toISOString()}|${story}`, "utf8").digest("hex"),
);

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

async function send(world, token, csv, commit) {
  const res = await fetch(`${BASE_URL}/api/admin/stories/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(commit ? { csv, commit: true } : { csv }),
  });
  world.importStatus = res.status;
  world.importBody = await res.json().catch(() => ({}));
}

async function savedCount() {
  const r = await storiesPool.query("SELECT count(*)::int AS n FROM stories WHERE story_text LIKE $1", [`%${MARK}%`]);
  return r.rows[0].n;
}

async function clean() {
  await storiesPool.query("DELETE FROM stories WHERE story_text LIKE $1", [`%${MARK}%`]);
  await storiesPool.query("DELETE FROM erased_stories WHERE fingerprint = ANY($1::text[])", [FINGERPRINTS]);
}

Before({ tags: "@stories-import" }, clean);
After({ tags: "@stories-import" }, clean);
AfterAll(async function () {
  await storiesPool.end();
});

When("{string} reads the old website's export", async function (email) {
  await send(this, await login(email), EXPORT, false);
});

When("{string} adds the old website's export", async function (email) {
  await send(this, await login(email), EXPORT, true);
});

When("I read the old website's export without a session", async function () {
  await send(this, null, EXPORT, false);
});

When("{string} reads a CSV with the columns {string}", async function (email, columns) {
  await send(this, await login(email), `${columns}\r\nsomething,something\r\n`, false);
});

// Erasing needs the story archived first and a reason (TASK-311), as it does in the admin.
When("{string} archives and erases Morag's story", async function (email) {
  const r = await storiesPool.query("SELECT id FROM stories WHERE submitter_email = 'morag.import.bdd@example.com'");
  assert.equal(r.rows.length, 1);
  const token = await login(email);
  const url = `${BASE_URL}/api/admin/stories/${r.rows[0].id}`;
  const archived = await fetch(`${url}/archive`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(archived.status, 200);
  const erased = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Asked for it to be erased (bdd)" }),
  });
  this.eraseStatus = erased.status;
});

Then("the erase status should be {int}", function (status) {
  assert.equal(this.eraseStatus, status);
});

Then("the import status should be {int}", function (status) {
  assert.equal(this.importStatus, status, JSON.stringify(this.importBody));
});

Then("it would add {int} stories and leave out {int}, because {string}", function (adding, leaving, why) {
  assert.equal(this.importBody.adding.length, adding);
  assert.equal(this.importBody.skipping.length, leaving);
  assert.ok(this.importBody.skipping[0].reason.startsWith(why), this.importBody.skipping[0].reason);
});

Then("{int} stories from the old website's export are saved", async function (n) {
  assert.equal(await savedCount(), n);
});

Then("{int} more stories are added", function (n) {
  assert.equal(this.importBody.added, n);
});

Then(
  "Morag's story is saved as sent at {string}, public with her first name and town, and new",
  async function (sent) {
    const r = await storiesPool.query(
      `SELECT created_at, consent_captured_at, use_scope, consent_share_first_name, consent_share_town,
              contact_for_more, status, admin_notes, submitter_first_name, submitter_town
         FROM stories WHERE submitter_email = 'morag.import.bdd@example.com'`,
    );
    assert.equal(r.rows.length, 1);
    const s = r.rows[0];
    assert.equal(s.created_at.toISOString(), sent);
    assert.equal(s.consent_captured_at.toISOString(), sent);
    assert.equal(s.use_scope, "public");
    assert.equal(s.consent_share_first_name, true);
    assert.equal(s.consent_share_town, true);
    assert.equal(s.contact_for_more, true);
    assert.equal(s.status, "new");
    assert.equal(s.submitter_first_name, "Morag");
    assert.equal(s.submitter_town, "Irvine");
    assert.match(s.admin_notes, /^Brought in from the old website's My Story form on /);
  },
);

Then("the refusal says it has no {string} column", function (column) {
  assert.ok(String(this.importBody.error).includes(`no "${column}" column`), this.importBody.error);
});
