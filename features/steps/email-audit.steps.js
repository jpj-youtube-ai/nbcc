const { Given, When, Then, Before } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for email-audit.feature. Reuses the newsletter steps' "a newsletter admin … with role …"
// Given (which seeds a user and logs in, leaving this.token), then exercises the real
// GET /api/admin/email-log route. Send rows come from a REAL send through the app (a team
// invite email — stubbed sends still log) plus one directly-seeded failure, because the CI stub
// provider cannot be made to fail on demand and the red band's job is to show failed rows
// however they got there.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Re-runnable on a lived-in local DB: clear this feature's own rows (marked by the .bdd@ suffix)
// before each scenario, so counts and "every result" assertions cannot be polluted by an earlier
// run. CI starts fresh and is unaffected.
Before({ tags: "@email-audit" }, async function () {
  await pool.query("DELETE FROM email_log WHERE recipient LIKE '%.audit.bdd@example.com'");
  await pool.query("DELETE FROM users WHERE email LIKE '%.audit.bdd@example.com'");
});

When("I invite {string} named {string} to the team", async function (email, fullName) {
  const res = await fetch(`${BASE_URL}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
    body: JSON.stringify({ email, fullName, role: "viewer" }),
  });
  assert.equal(res.status, 201, "expected the team invite to be created");
});

Given("a failed {string} email to {string} is on record", async function (kind, email) {
  await pool.query(
    `INSERT INTO email_log (kind, recipient, subject, status, error)
     VALUES ($1, lower($2), 'Winter update', 'failed', 'SES send responded 400: address rejected')`,
    [kind, email],
  );
});

// TASK-346: two sends to ONE address, minutes apart, each with its own SES id. This is the
// shape that broke the old correlation - and it is now the ordinary case, since a ball buyer
// gets a confirmation and then a guest-details read-back.
Given(
  "two sends to {string} are on record, ids {string} and {string}",
  async function (email, firstId, secondId) {
    await pool.query(
      `INSERT INTO email_log (kind, recipient, subject, status, ses_message_id, created_at)
       VALUES ('ballConfirmation', lower($1), 'Your booking', 'sent', $2, now() - interval '10 minutes'),
              ('ballGuests',       lower($1), 'Your guests', 'sent', $3, now() - interval '2 minutes')`,
      [email, firstId, secondId],
    );
  },
);

// Through the REAL webhook, exactly as SNS delivers it, rather than by importing the app's
// database module into this process: that would open a second pool nothing closes, and it would
// test a copy of the path rather than the path.
When(
  "a bounce arrives for message id {string} to {string}",
  async function (messageId, email) {
    const now = new Date().toISOString();
    const sesEvent = {
      eventType: "Bounce",
      mail: { timestamp: now, destination: [email], messageId },
      bounce: { timestamp: now, bounceType: "Permanent", bounceSubType: "General" },
    };
    const res = await fetch(
      `${BASE_URL}/api/webhooks/ses/${process.env.SES_WEBHOOK_TOKEN || "ci-ses-webhook-token"}`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
        body: JSON.stringify({
          Type: "Notification",
          MessageId: `sns-${messageId}`,
          TopicArn: "arn:aws:sns:eu-west-1:000000000000:bdd-ses-events",
          Message: JSON.stringify(sesEvent),
          Timestamp: now,
        }),
      },
    );
    assert.strictEqual(res.status, 200, "expected the SES webhook to accept the event");
  },
);

Then(
  "the send with id {string} should be marked {string}",
  async function (messageId, expected) {
    const res = await pool.query(
      "SELECT delivery_status FROM email_log WHERE ses_message_id = $1",
      [messageId],
    );
    assert.strictEqual(res.rowCount, 1, `expected one row for ${messageId}`);
    assert.strictEqual(res.rows[0].delivery_status, expected === "nothing" ? null : expected);
  },
);

async function fetchEmailAudit(world, query) {
  const res = await fetch(`${BASE_URL}/api/admin/email-log${query || ""}`, {
    headers: { Authorization: `Bearer ${world.token}` },
  });
  world.eaStatus = res.status;
  world.eaBody = await res.json().catch(() => ({}));
}

When("I fetch the email audit log", async function () {
  await fetchEmailAudit(this);
});

When("I search the email audit log for {string}", async function (q) {
  await fetchEmailAudit(this, `?q=${encodeURIComponent(q)}`);
});

When("I filter the email audit log by type {string}", async function (type) {
  await fetchEmailAudit(this, `?type=${encodeURIComponent(type)}`);
});

Then("the email audit response status should be {int}", function (expected) {
  assert.equal(this.eaStatus, expected, JSON.stringify(this.eaBody));
});

Then("the email audit log should include a {string} email to {string}", function (kind, email) {
  const hit = (this.eaBody.results || []).find((r) => r.kind === kind && r.recipient === email.toLowerCase());
  assert.ok(hit, `expected a ${kind} row to ${email} in ${JSON.stringify(this.eaBody.results)}`);
  assert.equal(hit.status, "sent"); // the stubbed send still logs as sent — the page works end to end
});

Then("the email audit failures should include {string}", function (email) {
  const hit = (this.eaBody.failures || []).find((r) => r.recipient === email.toLowerCase());
  assert.ok(hit, `expected ${email} in the red band: ${JSON.stringify(this.eaBody.failures)}`);
  assert.equal(hit.status, "failed");
  assert.ok(hit.error, "a failed row carries its reason");
});

Then("every email audit result should be to {string}", function (email) {
  const rows = this.eaBody.results || [];
  assert.ok(rows.length > 0, "expected the search to find at least one row");
  for (const r of rows) assert.equal(r.recipient, email.toLowerCase(), JSON.stringify(rows));
});

Then("every email audit result should be of type {string}", function (kind) {
  for (const r of this.eaBody.results || []) assert.equal(r.kind, kind, JSON.stringify(this.eaBody.results));
});
