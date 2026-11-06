const { Before, After, Given, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { REMOVE_DOUBLES_SQL } = require("../../migrations/1791200000400_donation-renewal-invoice.js");

// Steps for monthly-renewals.feature (TASK-596). The first scenario goes through the real webhook with
// stripe-webhook.steps.js's signed events (its @stripe-webhook hook clears the sub_bdd_ rows). The
// second writes donations as the webhook used to, a renewal twice a minute apart, then runs the
// migration's own tidy (REMOVE_DOUBLES_SQL) on Postgres. Its giver has an invented address ending
// "tidy.monthly.bdd@example.com" and its subscription ids start "sub_tidy_bdd_"; the hooks below
// remove them, and their kept aside rows. Audit lines are append only, so they stay.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MINE = "%tidy.monthly.bdd@example.com";

async function cleanUp() {
  await pool.query("DELETE FROM donations_removed_duplicates WHERE donation_row->>'stripe_subscription_id' LIKE 'sub_tidy_bdd_%'");
  await pool.query("DELETE FROM donations WHERE stripe_subscription_id LIKE 'sub_tidy_bdd_%'");
  await pool.query("DELETE FROM donors WHERE email LIKE $1", [MINE]);
}

Before({ tags: "@monthly-renewals" }, cleanUp);
After({ tags: "@monthly-renewals" }, cleanUp);

AfterAll(async function () {
  await pool.end();
});

Then("there should be exactly {int} donations for subscription {string}", async function (count, sub) {
  const r = await pool.query("SELECT count(*)::int AS n FROM donations WHERE stripe_subscription_id = $1", [sub]);
  assert.equal(r.rows[0].n, count);
});

Then("the renewal for subscription {string} keeps the invoice {string}", async function (sub, invoice) {
  const r = await pool.query(
    "SELECT stripe_invoice_id FROM donations WHERE stripe_subscription_id = $1 AND stripe_session_id IS NULL",
    [sub],
  );
  assert.deepEqual(
    r.rows.map((x) => x.stripe_invoice_id),
    [invoice],
  );
});

// A row as the webhook wrote a renewal before TASK-596: no session, payment intent, charge or invoice.
async function renewal(world, at, refunded = 0) {
  const r = await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status,
                            payment_channel, stripe_subscription_id, refunded_amount_pence, created_at)
     VALUES ($1, 'monthly', 1000, false, 'not_eligible', 'paid', 'online', $2, $3, $4) RETURNING id`,
    [world.tidyDonor, world.tidySub, refunded, at],
  );
  return r.rows[0].id;
}

Given("a monthly giver whose renewal was recorded twice, a minute apart", async function () {
  this.tidySub = `sub_tidy_bdd_${Date.now()}`;
  const donor = await pool.query(
    "INSERT INTO donors (donor_type, full_name, email) VALUES ('individual', 'Tilly Tidy', $1) RETURNING id",
    [`tilly.${Date.now()}.tidy.monthly.bdd@example.com`],
  );
  this.tidyDonor = donor.rows[0].id;
  // The monthly gift's own checkout: it has a session, so it is never anyone's double.
  const first = await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status,
                            payment_channel, stripe_subscription_id, stripe_session_id, created_at)
     VALUES ($1, 'monthly', 1000, false, 'not_eligible', 'paid', 'online', $2, $3, '2026-09-05T10:00:00Z') RETURNING id`,
    [this.tidyDonor, this.tidySub, `cs_tidy_bdd_${Date.now()}`],
  );
  this.tidyFirst = first.rows[0].id;
  this.tidyRenewal = await renewal(this, "2026-10-05T10:00:01Z");
  this.tidyRepeat = await renewal(this, "2026-10-05T10:01:01Z");
});

Given("their next renewal, a month later, was recorded once", async function () {
  this.tidyNext = await renewal(this, "2026-11-05T10:00:01Z");
});

Given("a later renewal recorded twice whose repeat was refunded", async function () {
  this.tidyLater = await renewal(this, "2026-12-05T10:00:01Z");
  this.tidyRefunded = await renewal(this, "2026-12-05T10:00:30Z", 1000);
});

When("the renewals recorded twice are tidied", async function () {
  const r = await pool.query(REMOVE_DOUBLES_SQL);
  this.tidyRemoved = r.rowCount;
});

Then("the repeat is taken out of donations and kept aside beside the gift it repeated", async function () {
  const gone = await pool.query("SELECT 1 FROM donations WHERE id = $1", [this.tidyRepeat]);
  assert.equal(gone.rowCount, 0);
  const kept = await pool.query(
    "SELECT duplicate_of, (donation_row->>'amount_pence')::int AS amount, donation_row->>'stripe_subscription_id' AS sub FROM donations_removed_duplicates WHERE donation_id = $1",
    [this.tidyRepeat],
  );
  assert.deepEqual(kept.rows, [{ duplicate_of: this.tidyRenewal, amount: 1000, sub: this.tidySub }]);
});

Then("an audit line says the repeat was taken out", async function () {
  const r = await pool.query(
    "SELECT (data->>'duplicateOf')::int AS of FROM audit_log WHERE action = 'donation.duplicate_removed' AND entity = 'donation' AND entity_id = $1",
    [this.tidyRepeat],
  );
  assert.deepEqual(r.rows, [{ of: this.tidyRenewal }]);
});

Then("the first gift, both renewals, next month's renewal and the refunded repeat are all still in donations", async function () {
  const want = [this.tidyFirst, this.tidyRenewal, this.tidyNext, this.tidyLater, this.tidyRefunded].sort((a, b) => a - b);
  const r = await pool.query("SELECT id FROM donations WHERE stripe_subscription_id = $1 ORDER BY id", [this.tidySub]);
  assert.deepEqual(
    r.rows.map((x) => x.id),
    want,
  );
});

Then("nothing more is taken out", function () {
  assert.equal(this.tidyRemoved, 0);
});
