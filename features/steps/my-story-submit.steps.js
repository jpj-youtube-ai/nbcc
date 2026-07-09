const { When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for my-story-submit.feature (Task B1). Connects to the SEPARATE `stories`
// database (STORIES_DATABASE_URL) to assert on persisted rows directly — never the
// main `charity` DATABASE_URL pool used by the other steps files. Mirrors the
// pool + Before/After cleanup pattern of gift-aid.steps.js.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const storiesPool = new Pool({ connectionString: process.env.STORIES_DATABASE_URL });

// Self-contained cleanup: every BDD-seeded story_text in this feature carries a
// "(bdd-..." marker or a distinctive sentence, deleted before and after each scenario
// so reruns are idempotent and this feature never depends on another's cleanup.
async function clean() {
  await storiesPool.query(
    "DELETE FROM stories WHERE story_text LIKE '%(bdd-json)%' OR story_text LIKE '%(bdd-form)%' " +
      "OR story_text = 'Missing the confirm checkbox.' OR story_text = 'A bot submission that should never be stored.'",
  );
}

Before({ tags: "@my-story-submit" }, clean);
After({ tags: "@my-story-submit" }, clean);
AfterAll(async function () {
  await storiesPool.end();
});

When("I POST the my-story form with storyText {string}", async function (storyText) {
  const body = new URLSearchParams({
    submitterRole: "supported",
    storyText,
    useScope: "internal_only",
    confirmOver16: "on",
  });
  const res = await fetch(`${BASE_URL}/api/my-story`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  this.statusCode = res.status;
  this.text = await res.text();
});

Then("the stories table should contain a story with text {string}", async function (storyText) {
  const r = await storiesPool.query("SELECT id FROM stories WHERE story_text = $1", [storyText]);
  assert.ok(r.rows.length > 0, `expected a stored story with text "${storyText}"`);
});

Then("the stories table should not contain a story with text {string}", async function (storyText) {
  const r = await storiesPool.query("SELECT id FROM stories WHERE story_text = $1", [storyText]);
  assert.equal(r.rows.length, 0, `expected NO stored story with text "${storyText}"`);
});
