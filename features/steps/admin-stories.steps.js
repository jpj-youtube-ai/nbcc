const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for admin-stories.feature (Task C). Seeds/reads stories via the SEPARATE stories DB
// (STORIES_DATABASE_URL) — never the main `charity` DATABASE_URL pool — mirroring
// my-story-submit.steps.js's storiesPool pattern. Admin auth (login) reuses the same
// login-via-POST-/api/admin/login flow as admin-api.steps.js / admin-auth.steps.js; the admin
// user rows themselves live in the main charity DB and are seeded/cleaned by admin-auth.steps.js's
// shared @admin Before hook.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const storiesPool = new Pool({ connectionString: process.env.STORIES_DATABASE_URL });

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return body.token;
}

// Self-contained cleanup: every story this feature seeds carries the "(bdd-admin-stories)" marker,
// deleted before and after each scenario so reruns are idempotent (mirrors my-story-submit.steps.js).
async function clean() {
  await storiesPool.query("DELETE FROM stories WHERE story_text LIKE '%(bdd-admin-stories)%'");
}
Before({ tags: "@admin-stories" }, clean);
After({ tags: "@admin-stories" }, clean);

Given("a submitted story with text {string}", async function (storyText) {
  const row = await storiesPool.query(
    `INSERT INTO stories (submitter_role, story_text, use_scope, confirmed_over_16)
     VALUES ('supported', $1, 'internal_only', true) RETURNING id`,
    [storyText],
  );
  this.adminStoryId = row.rows[0].id;
});

When("I GET the admin stories list without a token", async function () {
  const res = await fetch(`${BASE_URL}/api/admin/stories`);
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

When(
  "I GET the admin stories list as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/stories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

Then("the admin stories list contains the seeded story", function () {
  const results = this.adminBody.results || [];
  assert.ok(
    results.some((r) => r.id === this.adminStoryId),
    `expected story id ${this.adminStoryId} in the list, got ${JSON.stringify(results)}`,
  );
});

When(
  "I GET the admin story detail as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/stories/${this.adminStoryId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I PATCH the admin story status to {string} as {string} with password {string}",
  async function (status, email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/stories/${this.adminStoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

Then("the story is withdrawn in the stories database", async function () {
  const row = await storiesPool.query("SELECT status FROM stories WHERE id = $1", [this.adminStoryId]);
  assert.equal(row.rows[0].status, "withdrawn");
});

// G2 item 6: real hard-delete (erasure), distinct from the withdraw PATCH above.
When(
  "I DELETE the admin story as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/stories/${this.adminStoryId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

When(
  "I DELETE a non existent admin story as {string} with password {string}",
  async function (email, password) {
    const token = await login(email, password);
    const res = await fetch(`${BASE_URL}/api/admin/stories/999999999`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);

Then("the story still exists in the stories database", async function () {
  const row = await storiesPool.query("SELECT id FROM stories WHERE id = $1", [this.adminStoryId]);
  assert.equal(row.rowCount, 1);
});

Then("the story no longer exists in the stories database", async function () {
  const row = await storiesPool.query("SELECT id FROM stories WHERE id = $1", [this.adminStoryId]);
  assert.equal(row.rowCount, 0);
});

// "the admin response status should be {int}" and "the admin response field {string} should be
// {string}" are defined in admin-auth.steps.js / admin-api.steps.js (shared @admin).

AfterAll(async function () {
  await storiesPool.end();
});
