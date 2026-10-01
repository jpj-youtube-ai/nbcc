const { Given, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Pool } = require("pg");

// Steps for the TASK-463 scenarios in admin-permissions.feature: access saved before three sections
// existed (ball, site, outreach) is brought up to date by the backfill migration, which leaves the
// email audit alone and records each key it adds in audit_log. CI's database is empty when migrations
// run, so the migration never meets an old matrix there. These steps run its own SQL against the real
// database inside a transaction that is always rolled back: proof on Postgres, with nothing left
// behind for any other scenario. Users are seeded with emails ending admin.bdd@example.com, which the
// shared @admin Before hook (admin-auth.steps.js) clears.

const BACKFILL = path.resolve(__dirname, "../../migrations/1790788129056_permissions-backfill-missed-sections.js");
// TASK-479: the site analytics section arrived with its own backfill, run the same way.
const ANALYTICS_BACKFILL = path.resolve(__dirname, "../../migrations/1791000000001_permissions-analytics.js");

// The sections that existed when saved matrices arrived (TASK-186). A matrix saved before the four
// late sections names these and none of them.
const SECTIONS_WHEN_MATRICES_ARRIVED = [
  "overview", "search", "donations", "claims", "gasds", "subscriptions", "stories", "ticker",
  "contact", "newsletter", "thank-you", "audit", "team",
];
const LATE_SECTIONS = ["ball", "email-audit", "site", "outreach"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed(email, role, matrix) {
  await pool.query(
    "INSERT INTO users (email, full_name, role, permissions) VALUES ($1, 'Saved Access', $2, $3)",
    [email, role, JSON.stringify(matrix)],
  );
}

function oldMatrix() {
  const matrix = {};
  for (const s of SECTIONS_WHEN_MATRICES_ARRIVED) matrix[s] = s === "team" ? "none" : "view";
  return matrix;
}

function savedAccess(world, email) {
  const permissions = world.backfilled && world.backfilled[email];
  assert.ok(permissions, `no saved access found for ${email}`);
  return permissions;
}

Given(
  "a user {string} with role {string} whose saved access predates the four late sections",
  async function (email, role) {
    await seed(email, role, oldMatrix());
  },
);

Given(
  "a user {string} with role {string} whose saved access already sets the four late sections to {string}",
  async function (email, role, level) {
    const matrix = oldMatrix();
    for (const s of LATE_SECTIONS) matrix[s] = level;
    await seed(email, role, matrix);
  },
);

When("the TASK-463 permissions backfill runs", async function () {
  await runBackfill(this, BACKFILL);
});

When("the TASK-479 analytics permissions backfill runs", async function () {
  await runBackfill(this, ANALYTICS_BACKFILL);
});

// Run a backfill migration's own SQL inside a transaction that is always rolled back, keeping what
// it did to the BDD users (and what it logged) on the world for the Then steps.
async function runBackfill(world, file) {
  const statements = [];
  require(file).up({ sql: (text) => statements.push(text) });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const text of statements) await client.query(text);
    const users = await client.query(
      "SELECT email, permissions FROM users WHERE email LIKE '%admin.bdd@example.com'",
    );
    world.backfilled = Object.fromEntries(users.rows.map((row) => [row.email, row.permissions]));
    const logged = await client.query(
      `SELECT u.email, a.actor, a.data FROM audit_log a JOIN users u ON u.id = a.entity_id
        WHERE a.action = 'admin_user.permissions_backfilled' AND u.email LIKE '%admin.bdd@example.com'`,
    );
    world.backfillLog = logged.rows;
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

Then("the backfilled access of {string} gives {string} as {string}", function (email, section, level) {
  assert.equal(savedAccess(this, email)[section], level, `${email}: ${section}`);
});

Then("the backfilled access of {string} does not mention {string}", function (email, section) {
  assert.ok(!(section in savedAccess(this, email)), `${email} should have no ${section} key`);
});

Then("the backfilled access of {string} is still empty", function (email) {
  assert.deepEqual(savedAccess(this, email), {});
});

Then("the backfill logged {string} as {string} for {string}", function (section, level, email) {
  const rows = this.backfillLog.filter((row) => row.email === email && row.data.section === section);
  assert.equal(rows.length, 1, `one audit row for ${email}: ${section}`);
  assert.equal(rows[0].actor, "migration:TASK-463");
  assert.equal(rows[0].data.level, level);
});

Then("the analytics backfill logged {string} for {string}", function (level, email) {
  const rows = this.backfillLog.filter((row) => row.email === email && row.data.section === "analytics");
  assert.equal(rows.length, 1, `one audit row for ${email}: analytics`);
  assert.equal(rows[0].actor, "migration:TASK-479");
  assert.equal(rows[0].data.level, level);
});

Then("the backfill logged nothing for {string}", function (email) {
  assert.deepEqual(this.backfillLog.filter((row) => row.email === email), []);
});

AfterAll(async function () {
  await pool.end();
});
