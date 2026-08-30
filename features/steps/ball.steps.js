const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert");
const { Client } = require("pg");

// TASK-313: BDD steps for the public Festive Ball availability feed. Talks to the database
// directly to arrange capacity (there is no admin write endpoint until plan 4), then reads
// the public JSON endpoint over HTTP, like the other @db features do.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function withDb(fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

Given(
  "the ball is reset to {int} tables of {int} with {int} held back",
  async function (tables, seats, held) {
    await withDb(async (db) => {
      await db.query("DELETE FROM ball_reservations");
      await db.query("DELETE FROM ball_bookings");
      await db.query(
        `UPDATE ball_settings
            SET total_tables = $1, seats_per_table = $2, held_seats = $3,
                sales_closed = false, sales_close_at = NULL
          WHERE id = 1`,
        [tables, seats, held],
      );
    });
  },
);

Given("ball sales are closed by hand", async function () {
  await withDb((db) => db.query("UPDATE ball_settings SET sales_closed = true WHERE id = 1"));
});

When("I request the ball availability", async function () {
  const res = await fetch(`${BASE_URL}/api/ball/availability`);
  this.ballStatus = res.status;
  this.ballBody = await res.json();
});

Then("the ball response status should be {int}", function (expected) {
  assert.strictEqual(this.ballStatus, expected);
});

Then("the ball availability should show {int} seats remaining", function (n) {
  assert.strictEqual(this.ballBody.seatsRemaining, n);
});

Then("the ball availability should show {int} tables remaining", function (n) {
  assert.strictEqual(this.ballBody.tablesRemaining, n);
});

Then("the ball availability should say sales are open", function () {
  assert.strictEqual(this.ballBody.salesOpen, true);
});

Then("the ball availability should say sales are closed", function () {
  assert.strictEqual(this.ballBody.salesOpen, false);
});

Then("the ball availability should not contain buyer details", function () {
  const body = JSON.stringify(this.ballBody).toLowerCase();
  assert.ok(!body.includes("email"), "availability must not leak buyer emails");
  assert.ok(!body.includes("buyer"), "availability must not leak buyer names");
  assert.ok(!body.includes("reference"), "availability must not leak booking references");
});
