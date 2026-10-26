const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Pool } = require("pg");

// Steps for ball-chase.feature (TASK-575). The seeding, the menu, the ball reset and saving guests are
// ball.steps.js's; this file adds what the chase needs on top: the deadline and the volunteers' list
// written straight into ball_settings, the two passes run as the 8am task runs them (the compiled app,
// with a chosen time, as the team pass steps do), and the email log read back. Every address is
// invented: the booker addresses end ".chase.bdd@example.com" and the volunteers' ".chase.bdd@nbcc.scot",
// which is what the clean up below looks for.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const KINDS = ["ballRunUp", "ballChaseList"];

async function reset() {
  await pool.query("UPDATE ball_settings SET guest_details_lock_at = NULL, chase_recipients = '[]'::jsonb, menu_options = NULL, menu_note = NULL WHERE id = 1");
  await pool.query("DELETE FROM ball_chase_sends");
  await pool.query("DELETE FROM email_log WHERE recipient LIKE '%.chase.bdd@example.com' OR recipient LIKE '%.chase.bdd@nbcc.scot'");
  await pool.query("DELETE FROM ball_bookings WHERE guest_token LIKE 'chase-%'");
}

Before({ tags: "@ball-chase" }, reset);
After({ tags: "@ball-chase" }, reset);
AfterAll(async function () {
  await pool.end();
});

Given("the guest details close at {string}", async function (iso) {
  await pool.query("UPDATE ball_settings SET guest_details_lock_at = $1 WHERE id = 1", [iso]);
});

Given("the guest details deadline is not set", async function () {
  await pool.query("UPDATE ball_settings SET guest_details_lock_at = NULL WHERE id = 1");
});

Given("the volunteers' chase list goes to {string} and {string}", async function (first, second) {
  const list = [
    { name: "First Volunteer", email: first },
    { name: "Second Volunteer", email: second },
  ];
  await pool.query("UPDATE ball_settings SET chase_recipients = $1::jsonb WHERE id = 1", [JSON.stringify(list)]);
});

// The seeded bookings all share one buyer address; the chase is per address, so each gets its own.
Given("the booker of {string} is {string}", async function (token, email) {
  const r = await pool.query("UPDATE ball_bookings SET buyer_email = $2 WHERE guest_token = $1", [token, email]);
  assert.equal(r.rowCount, 1, `no booking with the guest token ${token}`);
});

// Saving a guest emails the booker a read-back (also kind ballRunUp), so a scenario clears the log
// once its bookings are set up and before the pass it is checking.
Given("the chase emails logged so far are cleared", async function () {
  await pool.query("DELETE FROM email_log WHERE recipient LIKE '%.chase.bdd@example.com' OR recipient LIKE '%.chase.bdd@nbcc.scot'");
});

When("the daily chase pass runs at {string}", async function (iso) {
  const { runBallChase } = require(path.resolve(__dirname, "../../dist/ball/chase-runner.js"));
  this.chaseResult = await runBallChase(new Date(iso));
});

// The pass that used to send the guest chase and last call. It still sends the week-to-go email.
When("the old run-up pass runs at {string}", async function (iso) {
  const { runBallRunUp } = require(path.resolve(__dirname, "../../dist/ball/run-up-runner.js"));
  this.runUpResult = await runBallRunUp(new Date(iso));
});

// The run-up pass stamps a booking with the database's own clock (now()), not the time it was given,
// so after running it for a chosen morning the stamp is moved to that morning, which is what it would
// be on the real day.
When("the week-to-go stamps are moved to {string}", async function (iso) {
  await pool.query("UPDATE ball_bookings SET reminder_sent_at = $1 WHERE reminder_sent_at IS NOT NULL AND guest_token LIKE 'chase-%'", [iso]);
});

Then("the chase pass should say it is not a chase day", function () {
  assert.equal(this.chaseResult.day, null, JSON.stringify(this.chaseResult));
});

async function countFor(kind, email) {
  const r = await pool.query("SELECT count(*)::int AS n FROM email_log WHERE kind = $1 AND lower(recipient) = lower($2)", [kind, email]);
  return r.rows[0].n;
}

Then("the email log should hold {int} {string} email(s) to {string}", async function (n, kind, email) {
  assert.equal(await countFor(kind, email), n, `${kind} emails to ${email}`);
});

Then("no chase email should have been logged", async function () {
  const r = await pool.query(
    "SELECT kind, recipient FROM email_log WHERE kind = ANY($1) AND (recipient LIKE '%.chase.bdd@example.com' OR recipient LIKE '%.chase.bdd@nbcc.scot')",
    [KINDS],
  );
  assert.deepEqual(r.rows, [], "a chase email was logged");
});
