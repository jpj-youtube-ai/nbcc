const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for ball-report.feature (TASK-464). Drives /api/admin/ball-report over HTTP and checks the
// main database. The staff come from the shared @admin steps (their addresses end
// "admin.bdd@example.com", which the @admin hooks remove); every address here is invented. The
// report is switched off and emptied before and after each scenario, because other features read
// the Ball's settings and must see them as shipped.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = "report-pw-123";
const DAY_MS = 86_400_000;

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    return (await res2.json().catch(() => ({}))).token;
  }
  throw new Error(`could not sign in as ${email}: ${JSON.stringify(body)}`);
}

async function call(world, token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  world.reportStatus = res.status;
  world.reportBody = await res.json().catch(() => ({}));
  return world.reportBody;
}

// "Cal <cal@example.com>, Alex <alex@example.com>" as the list the admin form sends.
function people(list) {
  if (!list.trim()) return [];
  return list.split(/,\s*(?=[^,]*<)/).map((entry) => {
    const m = entry.match(/^\s*(.*?)\s*<(.*)>\s*$/);
    return { name: m[1], email: m[2] };
  });
}

async function reset() {
  await pool.query("UPDATE ball_settings SET report_on = false, report_recipients = '[]'::jsonb WHERE id = 1");
  await pool.query("DELETE FROM ball_report_sends WHERE sent_by LIKE '%report.admin.bdd@example.com'");
  await pool.query("DELETE FROM ball_bookings WHERE buyer_email LIKE '%.report.bdd@example.com'");
  await pool.query("DELETE FROM ball_waiting_list WHERE email LIKE '%.report.bdd@example.com'");
  await pool.query("DELETE FROM audit_log WHERE action = 'ball_report.send_failed'");
}

Before({ tags: "@ball-report" }, reset);
After({ tags: "@ball-report" }, reset);
AfterAll(async function () {
  await pool.end();
});

When("I read the ticket report settings without a session", async function () {
  await call(this, null, "GET", "/api/admin/ball-report");
});

When("{string} reads the ticket report settings", async function (email) {
  await call(this, await login(email), "GET", "/api/admin/ball-report");
});

When("{string} saves the ticket report for {string}", async function (email, list) {
  await call(this, await login(email), "PUT", "/api/admin/ball-report", { reportOn: false, recipients: people(list) });
});

When("{string} saves the ticket report for {string} switched on", async function (email, list) {
  await call(this, await login(email), "PUT", "/api/admin/ball-report", { reportOn: true, recipients: people(list) });
});

When("{string} sends a test ticket report", async function (email) {
  await call(this, await login(email), "POST", "/api/admin/ball-report/test", {});
});

Then("the report status should be {int}", function (status) {
  assert.equal(this.reportStatus, status, JSON.stringify(this.reportBody));
});

Then("the report is switched off", async function () {
  const r = await pool.query("SELECT report_on FROM ball_settings WHERE id = 1");
  assert.equal(r.rows[0].report_on, false);
});

Then("the report is switched on", async function () {
  const r = await pool.query("SELECT report_on FROM ball_settings WHERE id = 1");
  assert.equal(r.rows[0].report_on, true);
});

Then("the report goes to {string} in that order", function (list) {
  assert.deepEqual(
    this.reportBody.recipients.map((r) => r.email),
    list.split(", "),
  );
});

Then(
  "the audit log records the report saved by {string}, adding {int} people",
  async function (email, count) {
    const r = await pool.query(
      `SELECT actor, data FROM audit_log WHERE action = 'ball_report.settings_saved' ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(r.rows.length, 1, "no audit row for the report");
    assert.equal(r.rows[0].actor, `admin:${email}`);
    assert.equal(r.rows[0].data.added.length, count);
  },
);

Then("the test went only to {string}", function (email) {
  assert.deepEqual(this.reportBody.sentTo, [email]);
});

Then(
  "the email log shows a ticket report to {string} and not to {string}",
  async function (to, notTo) {
    const r = await pool.query(
      `SELECT recipient FROM email_log WHERE kind = 'ballReport' AND recipient IN ($1, $2) ORDER BY id DESC`,
      [to.toLowerCase(), notTo.toLowerCase()],
    );
    const recipients = r.rows.map((row) => row.recipient);
    assert.ok(recipients.includes(to.toLowerCase()), "the test is not in the email log");
    assert.ok(!recipients.includes(notTo.toLowerCase()), "the test went to someone on the list");
  },
);

Then("the report records a test sent by {string}", async function (email) {
  const r = await pool.query(
    `SELECT kind, status, recipients FROM ball_report_sends WHERE sent_by = $1 ORDER BY id DESC LIMIT 1`,
    [`admin:${email}`],
  );
  assert.equal(r.rows.length, 1, "no record of the test send");
  assert.equal(r.rows[0].kind, "test");
  assert.equal(r.rows[0].status, "sent");
  assert.deepEqual(r.rows[0].recipients, [email]);
});

Then("the preview is the Festive Ball ticket report, with no money and no one's details in it", function () {
  const preview = this.reportBody.preview;
  assert.match(preview.subject, /^Festive Ball tickets: .+ update$/);
  assert.ok(preview.html.includes("seats"), "the preview has no numbers");
  assert.ok(!preview.html.includes("£"), "the preview shows money");
  const addresses = preview.html.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
  assert.deepEqual([...new Set(addresses)], ["events@nbcc.scot"]);
});

Then("the refusal points at the {string} of person {int}", function (field, n) {
  assert.deepEqual(this.reportBody.path, [n - 1, field]);
});

Then("the audit log records a test sent by {string}", async function (email) {
  const r = await pool.query(
    `SELECT actor, data FROM audit_log WHERE action = 'ball_report.test_sent' ORDER BY id DESC LIMIT 1`,
  );
  assert.equal(r.rows.length, 1, "no audit row for the test");
  assert.equal(r.rows[0].actor, `admin:${email}`);
  assert.equal(r.rows[0].data.to, email);
});

// Invented buyers, one row per line of the table. "paid days ago" is blank for a booking that was
// never paid.
Given("these Festive Ball bookings exist:", async function (table) {
  let n = 0;
  for (const row of table.hashes()) {
    n += 1;
    const ago = row["paid days ago"];
    await pool.query(
      `INSERT INTO ball_bookings
         (reference, kind, quantity, seats, buyer_name, buyer_email, tickets_pence, total_pence, status, paid_at)
       VALUES ($1, $2, $3, $4, 'Report Buyer', $5, 0, 0, $6, $7)`,
      [
        `BALL-RPT${String(n).padStart(3, "0")}`,
        row.kind,
        Number(row.quantity),
        Number(row.seats),
        `buyer${n}.report.bdd@example.com`,
        row.status,
        ago ? new Date(Date.now() - Number(ago) * DAY_MS) : null,
      ],
    );
  }
});

// A scheduled report that went before, marked with this feature's sender so the reset removes it.
Given("the last ticket report counted up to {int} days ago", async function (days) {
  const at = new Date(Date.now() - days * DAY_MS);
  await pool.query(
    `INSERT INTO ball_report_sends (sent_on, kind, status, recipients, figures, counted_to, sent_at, sent_by)
     VALUES ($1::date, 'scheduled', 'sent', '{}', '{}'::jsonb, $2, $2, 'system:schedule.report.admin.bdd@example.com')`,
    [at.toISOString().slice(0, 10), at],
  );
});

// The waiting list is emptied first, as "the ball is reset" empties the bookings: the count must be
// this scenario's own. The first person wants the seats the others do not.
Given(
  "{int} people want {int} seats on the Ball's waiting list, and {int} more has been offered a place",
  async function (people, seats, offered) {
    await pool.query("DELETE FROM ball_waiting_list");
    for (let i = 0; i < people; i++) {
      await pool.query(
        "INSERT INTO ball_waiting_list (name, email, seats_wanted) VALUES ('Waiting Person', $1, $2)",
        [`waiting${i}.report.bdd@example.com`, i === 0 ? seats - (people - 1) : 1],
      );
    }
    for (let i = 0; i < offered; i++) {
      await pool.query(
        "INSERT INTO ball_waiting_list (name, email, seats_wanted, offered_at) VALUES ('Offered Person', $1, 3, now())",
        [`offered${i}.report.bdd@example.com`],
      );
    }
  },
);

Then("the preview says {string}", function (words) {
  assert.ok(this.reportBody.preview.html.includes(words), `the preview does not say "${words}"`);
});

const dayOf = (daysAgo) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);

Given("the ticket report could not be sent {int} day(s) ago", async function (days) {
  await pool.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, data, created_at)
     VALUES ('system:schedule', 'ball_report.send_failed', 'ball_report', NULL, $1, now() - $2::interval)`,
    [{ sentOn: dayOf(days) }, `${days} days`],
  );
});

Then("the card says the report of {int} day(s) ago could not be sent", function (days) {
  assert.deepEqual(this.reportBody.lastFailure && this.reportBody.lastFailure.sentOn, dayOf(days));
});

Then("the card shows no failed report", function () {
  assert.equal(this.reportBody.lastFailure, null);
});
