const { Given, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Pool } = require("pg");

// Steps for the TASK-463 scenarios in admin-permissions.feature: access saved before four sections
// existed (ball, email-audit, site, outreach) is brought up to date by the backfill migration. CI's
// database is empty when migrations run, so the migration never meets an old matrix there. These
// steps run its own SQL against the real database inside a transaction that is always rolled back:
// proof on Postgres, with nothing left behind for any other scenario. Users are seeded with emails
// ending admin.bdd@example.com, which the shared @admin Before hook (admin-auth.steps.js) clears.

const BACKFILL = path.resolve(__dirname, "../../migrations/1790788129056_permissions-backfill-missed-sections.js");

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
  const statements = [];
  require(BACKFILL).up({ sql: (text) => statements.push(text) });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const text of statements) await client.query(text);
    const { rows } = await client.query(
      "SELECT email, permissions FROM users WHERE email LIKE '%admin.bdd@example.com'",
    );
    this.backfilled = Object.fromEntries(rows.map((row) => [row.email, row.permissions]));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

Then("the backfilled access of {string} gives {string} as {string}", function (email, section, level) {
  const permissions = this.backfilled && this.backfilled[email];
  assert.ok(permissions, `no saved access found for ${email}`);
  assert.equal(permissions[section], level, `${email}: ${section}`);
});

AfterAll(async function () {
  await pool.end();
});
