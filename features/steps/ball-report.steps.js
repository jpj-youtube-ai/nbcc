const { When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
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
