const { Given, When, Then, Before } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
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
  // Two shapes on purpose: the acting admins are audit.<role>.bdd@…, the invited/seeded
  // recipients are <name>.audit.bdd@… — both must go or a local re-run collides on the
  // users_email_key unique constraint (CI starts fresh and never sees this).
  await pool.query(
    "DELETE FROM email_log WHERE recipient LIKE '%.audit.bdd@example.com' OR recipient LIKE 'audit.%.bdd@example.com'",
  );
  await pool.query(
    "DELETE FROM users WHERE email LIKE '%.audit.bdd@example.com' OR email LIKE 'audit.%.bdd@example.com'",
  );
  // TASK-562: what the removal scenarios leave behind: the removals themselves, and the blocks
  // that "Remove and stop emails" (or a scenario's own seeding) puts on these addresses. With a
  // "%" at the end too: one scenario's address is badly formed on purpose, with a trailing full stop.
  await pool.query("DELETE FROM email_log WHERE recipient LIKE '%.audit.bdd@example.com.'");
  await pool.query("DELETE FROM email_audit_removals WHERE email LIKE '%.audit.bdd@example.com%'");
  await pool.query("DELETE FROM email_suppressions WHERE lower(email) LIKE '%.audit.bdd@example.com%'");
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
async function bounceArrives(messageId, email, at) {
  const sesEvent = {
    eventType: "Bounce",
    mail: { timestamp: at, destination: [email], messageId },
    bounce: { timestamp: at, bounceType: "Permanent", bounceSubType: "General" },
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
        Timestamp: at,
      }),
    },
  );
  assert.strictEqual(res.status, 200, "expected the SES webhook to accept the event");
}

// The bounce's own time is the database's clock, not this process's. TASK-562 compares that time
// with times the database stamps (when an address was removed from the band), and the two clocks
// need not agree to the millisecond: a database in a container can run behind or ahead.
When(
  "a bounce arrives for message id {string} to {string}",
  async function (messageId, email) {
    const { rows } = await pool.query("SELECT now() AS at");
    await bounceArrives(messageId, email, new Date(rows[0].at).toISOString());
  },
);

// TASK-562: a bounce carries its own time, and that time is what dates the problem. Here it is a
// minute after the address was removed, worked out by the database from the removal itself, so
// the scenario does not hang on this process's clock and the database's agreeing to the millisecond.
When(
  "a minute later a bounce arrives for message id {string} to {string}",
  async function (messageId, email) {
    const { rows } = await pool.query(
      "SELECT max(removed_at) + interval '1 minute' AS at FROM email_audit_removals WHERE email = lower($1)",
      [email],
    );
    assert.ok(rows[0].at, `${email} has not been removed`);
    await bounceArrives(messageId, email, new Date(rows[0].at).toISOString());
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

// TASK-464: one email to several people, as the Ball's ticket report goes: a row each, one SES id.
Given("one send to {string} is on record, id {string}", async function (list, messageId) {
  this.sharedTo = list.split(", ");
  await pool.query("DELETE FROM email_suppressions WHERE lower(email) = ANY($1)", [this.sharedTo]);
  for (const email of this.sharedTo) {
    await pool.query(
      `INSERT INTO email_log (kind, recipient, subject, status, ses_message_id)
       VALUES ('ballReport', lower($1), 'Festive Ball tickets', 'sent', $2)`,
      [email, messageId],
    );
  }
});

When(
  "a bounce arrives for message id {string}, naming only {string}",
  async function (messageId, bounced) {
    const now = new Date().toISOString();
    const sesEvent = {
      eventType: "Bounce",
      mail: { timestamp: now, destination: this.sharedTo, messageId },
      bounce: {
        timestamp: now,
        bounceType: "Permanent",
        bounceSubType: "General",
        bouncedRecipients: [{ emailAddress: bounced, diagnosticCode: "550 5.1.1 user unknown" }],
      },
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
  "the send with id {string} to {string} should be marked {string}",
  async function (messageId, email, expected) {
    const res = await pool.query(
      "SELECT delivery_status FROM email_log WHERE ses_message_id = $1 AND recipient = lower($2)",
      [messageId, email],
    );
    assert.strictEqual(res.rowCount, 1, `expected one row for ${email} on ${messageId}`);
    assert.strictEqual(res.rows[0].delivery_status, expected === "nothing" ? null : expected);
  },
);

Then("{string} is taken off future sends, and {string} is not", async function (gone, kept) {
  const active = (email) =>
    pool.query("SELECT 1 FROM email_suppressions WHERE lower(email) = lower($1) AND removed_at IS NULL", [email]);
  assert.strictEqual((await active(gone)).rowCount, 1, `${gone} was not taken off future sends`);
  assert.strictEqual((await active(kept)).rowCount, 0, `${kept} was taken off future sends`);
});

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

// ---- TASK-562: removing an address from the red band, and putting it back ----

async function postEmailAudit(world, action, body) {
  const res = await fetch(`${BASE_URL}/api/admin/email-log/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${world.token}` },
    body: JSON.stringify(body),
  });
  world.eaStatus = res.status;
  world.eaBody = await res.json().catch(() => ({}));
}

When("I tidy {string} away in the email audit", async function (email) {
  await postEmailAudit(this, "remove", { email, stop: false });
});

When("I remove {string} from the email audit and stop emails to it", async function (email) {
  await postEmailAudit(this, "remove", { email, stop: true });
});

When("I put {string} back in the email audit", async function (email) {
  await postEmailAudit(this, "put-back", { email });
});

Then("the email audit failures should not include {string}", function (email) {
  const hit = (this.eaBody.failures || []).find((r) => r.recipient === email.toLowerCase());
  assert.equal(hit, undefined, `${email} is still in the red band: ${JSON.stringify(this.eaBody.failures)}`);
});

// Nothing is deleted: the row is still in the full list, and says who removed it and how.
Then(
  "the email audit log still lists {string}, marked as removed by {string}, kind {string}",
  function (email, by, kind) {
    const rows = (this.eaBody.results || []).filter((r) => r.recipient === email.toLowerCase());
    assert.ok(rows.length > 0, `expected ${email} in the full list: ${JSON.stringify(this.eaBody.results)}`);
    for (const r of rows) {
      assert.equal(r.removedKind, kind, JSON.stringify(r));
      assert.equal(r.removedBy, by, JSON.stringify(r));
      assert.ok(r.removedAt, "a removed row says when");
    }
  },
);

// The Overview counts the red band's rows ("N emails failed or bounced in the last 2 weeks"), and
// says nothing at all when there are none. Other scenarios may leave problems of their own, so the
// count is compared with what it was, not with a number.
async function overviewEmailProblems(world) {
  const res = await fetch(`${BASE_URL}/api/admin/overview`, { headers: { Authorization: `Bearer ${world.token}` } });
  assert.equal(res.status, 200, "expected the overview to answer");
  const body = await res.json();
  assert.ok(!(body.failed || []).includes("Email audit"), `the overview could not count the emails: ${JSON.stringify(body.failed)}`);
  const need = (body.needs || []).find((n) => n.key === "emailFailures");
  return need ? Number.parseInt(need.text, 10) : 0;
}

Given("I note how many email problems the Overview counts", async function () {
  this.eaOverviewBefore = await overviewEmailProblems(this);
  assert.ok(this.eaOverviewBefore >= 1, "the seeded failure should already be counted");
});

Then("the Overview counts {int} fewer email problem", async function (fewer) {
  assert.equal(await overviewEmailProblems(this), this.eaOverviewBefore - fewer);
});

const activeBlock = (email) =>
  pool.query("SELECT reason FROM email_suppressions WHERE lower(email) = lower($1) AND removed_at IS NULL", [email]);

Given("{string} is already blocked because its mail bounced", async function (email) {
  await pool.query(
    "INSERT INTO email_suppressions (email, reason, detail) VALUES (lower($1), 'bounced', '550 5.1.1 user unknown')",
    [email],
  );
});

Then("{string} is blocked by staff", async function (email) {
  const found = await activeBlock(email);
  assert.equal(found.rowCount, 1, `${email} is not blocked`);
  assert.equal(found.rows[0].reason, "manual");
});

Then("{string} is not blocked", async function (email) {
  assert.equal((await activeBlock(email)).rowCount, 0, `${email} is blocked`);
});

async function blockedForBouncing(email) {
  const found = await activeBlock(email);
  assert.equal(found.rowCount, 1, `${email} is not blocked`);
  assert.equal(found.rows[0].reason, "bounced");
}

Then("{string} is still blocked because its mail bounced", blockedForBouncing);

Then("{string} is blocked because its mail bounced", blockedForBouncing);

// A bounced row is a problem too: "sent" by us, "bounced" by the mailbox, some time later.
Then("the email audit failures should include a bounce to {string}", function (email) {
  const hit = (this.eaBody.failures || []).find((r) => r.recipient === email.toLowerCase() && r.deliveryStatus === "bounced");
  assert.ok(hit, `expected a bounce to ${email} in the red band: ${JSON.stringify(this.eaBody.failures)}`);
});

Then("the email audit failures should not include a failed send to {string}", function (email) {
  const hit = (this.eaBody.failures || []).find((r) => r.recipient === email.toLowerCase() && r.status === "failed");
  assert.equal(hit, undefined, `the failed send to ${email} is back in the red band`);
});

// Newsletter > Blocked addresses > Unblock, as the screen does it. Code that knows nothing of
// removals: what the band shows afterwards is decided when the band is read.
When("I unblock {string} under Newsletter", async function (email) {
  const res = await fetch(`${BASE_URL}/api/admin/newsletters/suppressions/lift`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200, "expected the address to be unblocked");
});

// The two older paths that forget a person in the log delete or overwrite its rows directly.
When("every email to {string} is deleted from the log", async function (email) {
  await pool.query("DELETE FROM email_log WHERE recipient = lower($1)", [email]);
});

// The daily task's own prune. No route runs it, so unlike the bounce above it cannot go through
// the app: it is run from the compiled app (dist/, built before the BDD step in CI) in this
// process against the same database, as the fundraising steps run their daily passes.
When("the daily email log prune runs", async function () {
  const { pruneEmailLog } = require(path.resolve(__dirname, "../../dist/db/email-log.js"));
  await pruneEmailLog(new Date());
});

const removalsFor = (email) => pool.query("SELECT 1 FROM email_audit_removals WHERE email = lower($1)", [email]);

Then("the email audit keeps no removal for {string}", async function (email) {
  assert.equal((await removalsFor(email)).rowCount, 0, `a removal for ${email} outlived its emails`);
});

Then("the email audit still keeps a removal for {string}", async function (email) {
  assert.ok((await removalsFor(email)).rowCount > 0, `the removal for ${email} was pruned though its emails are still in the log`);
});
