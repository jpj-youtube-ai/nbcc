const { Before, After, Given, When, Then, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { REMOVE_DOUBLES_SQL } = require("../../migrations/1791200000400_donation-renewal-invoice.js");

// Steps for monthly-renewals.feature (TASK-596). The first scenario goes through the real webhook with
// stripe-webhook.steps.js's signed events (its @stripe-webhook hook clears the sub_bdd_ rows). The
// second writes donations as the webhook used to, each renewal with its audit line and its event in
// the webhook ledger, then runs the migration's own tidy (REMOVE_DOUBLES_SQL) on Postgres. Its giver
// has an invented address ending "tidy.monthly.bdd@example.com", its subscription ids start
// "sub_tidy_bdd_" and its event ids "evt_tidy_bdd_"; the hooks below remove them, and their kept
// aside rows. Audit lines are append only, so they stay.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MINE = "%tidy.monthly.bdd@example.com";

async function cleanUp() {
  await pool.query("DELETE FROM donations_removed_duplicates WHERE donation_row->>'stripe_subscription_id' LIKE 'sub_tidy_bdd_%'");
  await pool.query("DELETE FROM donations WHERE stripe_subscription_id LIKE 'sub_tidy_bdd_%'");
  await pool.query("DELETE FROM donors WHERE email LIKE $1", [MINE]);
  await pool.query("DELETE FROM stripe_webhook_events WHERE id LIKE 'evt_tidy_bdd_%'");
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

// A row as the webhook wrote a renewal before TASK-596: no session, payment intent, charge or invoice,
// with its audit line naming the event that made it, and that event in the webhook ledger.
let evt = 0;
async function renewal(world, at, eventType, claimStatus = "not_eligible") {
  const r = await pool.query(
    `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status,
                            payment_channel, stripe_subscription_id, created_at)
     VALUES ($1, 'monthly', 1000, false, $4, 'paid', 'online', $2, $3) RETURNING id`,
    [world.tidyDonor, world.tidySub, at, claimStatus],
  );
  const id = r.rows[0].id;
  evt += 1;
  const eventId = `evt_tidy_bdd_${Date.now()}_${evt}`;
  await pool.query("INSERT INTO stripe_webhook_events (id, type) VALUES ($1, $2)", [eventId, eventType]);
  await pool.query(
    "INSERT INTO audit_log (actor, action, entity, entity_id, data) VALUES ('stripe', 'donation.recurring', 'donation', $1, $2)",
    [id, JSON.stringify({ eventId, donorId: world.tidyDonor, subscriptionId: world.tidySub })],
  );
  return id;
}
const PAID = "invoice.paid";
const SUCCEEDED = "invoice.payment_succeeded";

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
     VALUES ($1, 'monthly', 1000, false, 'not_eligible', 'paid', 'online', $2, $3, '2026-06-05T10:00:00Z') RETURNING id`,
    [this.tidyDonor, this.tidySub, `cs_tidy_bdd_${Date.now()}`],
  );
  this.tidyKeep = [first.rows[0].id];
  this.tidyGone = [];
  const kept = await renewal(this, "2026-07-05T10:00:01Z", PAID);
  const gone = await renewal(this, "2026-07-05T10:01:01Z", SUCCEEDED);
  this.tidyKeep.push(kept);
  this.tidyGone.push([gone, kept]);
});

Given("a renewal recorded twice whose two events were handled together, the repeat stamped first", async function () {
  const kept = await renewal(this, "2026-08-05T10:00:02Z", PAID);
  const gone = await renewal(this, "2026-08-05T10:00:01Z", SUCCEEDED);
  this.tidyKeep.push(kept);
  this.tidyGone.push([gone, kept]);
});

Given("two different invoices paid seconds apart, each recorded twice", async function () {
  // A giver catching up on two missed months at once: two real payments, four rows.
  const p1 = await renewal(this, "2026-09-05T10:00:01Z", PAID);
  const s1 = await renewal(this, "2026-09-05T10:00:02Z", SUCCEEDED);
  const p2 = await renewal(this, "2026-09-05T10:00:05Z", PAID);
  const s2 = await renewal(this, "2026-09-05T10:00:06Z", SUCCEEDED);
  this.tidyKeep.push(p1, p2);
  this.tidyGone.push([s1, p1], [s2, p2]);
});

Given("a renewal recorded twice whose repeat is in a Gift Aid claim", async function () {
  const twin = await renewal(this, "2026-10-05T10:00:01Z", PAID);
  const claimed = await renewal(this, "2026-10-05T10:00:30Z", SUCCEEDED, "claimed");
  this.tidyClaimed = claimed;
  this.tidyKeep.push(claimed);
  this.tidyGone.push([twin, claimed]);
});

Given("a renewal recorded twice where both are in a Gift Aid claim", async function () {
  const a = await renewal(this, "2026-11-05T10:00:01Z", PAID, "claimed");
  const b = await renewal(this, "2026-11-05T10:00:30Z", SUCCEEDED, "claimed");
  this.tidyBothClaimed = [a, b];
  this.tidyKeep.push(a, b);
});

Given("their next renewal, a month later, was recorded once", async function () {
  this.tidyKeep.push(await renewal(this, "2026-12-05T10:00:01Z", PAID));
});

When("the renewals recorded twice are tidied", async function () {
  const r = await pool.query(REMOVE_DOUBLES_SQL);
  this.tidyRemoved = r.rowCount;
});

Then("each repeat is taken out of donations and kept aside beside the gift it repeated", async function () {
  for (const [gone, of] of this.tidyGone) {
    const there = await pool.query("SELECT 1 FROM donations WHERE id = $1", [gone]);
    assert.equal(there.rowCount, 0, `donation ${gone} should be taken out`);
    const kept = await pool.query(
      "SELECT duplicate_of, (donation_row->>'amount_pence')::int AS amount, donation_row->>'stripe_subscription_id' AS sub FROM donations_removed_duplicates WHERE donation_id = $1",
      [gone],
    );
    assert.deepEqual(kept.rows, [{ duplicate_of: of, amount: 1000, sub: this.tidySub }]);
  }
  assert.equal(this.tidyRemoved, this.tidyGone.length);
});

Then("an audit line says each repeat was taken out", async function () {
  for (const [gone, of] of this.tidyGone) {
    const r = await pool.query(
      "SELECT (data->>'duplicateOf')::int AS of FROM audit_log WHERE action = 'donation.duplicate_removed' AND entity = 'donation' AND entity_id = $1",
      [gone],
    );
    assert.deepEqual(r.rows, [{ of }]);
  }
});

Then("the gift in the claim is kept and its twin is taken out instead", async function () {
  const r = await pool.query("SELECT claim_status FROM donations WHERE id = $1", [this.tidyClaimed]);
  assert.deepEqual(r.rows, [{ claim_status: "claimed" }]);
});

Then("the pair both in a claim is left, and an audit line names it", async function () {
  const [a, b] = this.tidyBothClaimed;
  const r = await pool.query(
    "SELECT 1 FROM audit_log WHERE action = 'donation.duplicates_left' AND data->'pairs' @> $1::jsonb",
    [JSON.stringify([{ kept: a, repeat: b }])],
  );
  assert.equal(r.rowCount, 1);
});

Then("one gift for each payment is still in donations", async function () {
  const r = await pool.query("SELECT id FROM donations WHERE stripe_subscription_id = $1 ORDER BY id", [this.tidySub]);
  assert.deepEqual(
    r.rows.map((x) => x.id),
    [...this.tidyKeep].sort((a, b) => a - b),
  );
});

Then("nothing more is taken out", function () {
  assert.equal(this.tidyRemoved, 0);
});
