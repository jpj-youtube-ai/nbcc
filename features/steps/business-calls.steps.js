const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");

// Steps for business-calls.feature (TASK-491): the reminder to phone each business that gives
// monthly. Businesses are seeded straight into Postgres (a company donor, a paid monthly gift dated
// when they started, and their fulfilment record), then the real admin routes are driven over HTTP.
// The admin user ends admin.bdd@example.com, which the shared @admin Before (admin-auth.steps.js)
// clears. "an admin user ... with password ..." and "the admin response status should be ..." are
// shared.
//
// Kept apart from every other feature's cleanup (review of #614). The stripe-webhook Before deletes
// any donor whose email ends bdd@example.com, or whose donation's subscription matches sub_bdd_%, and
// it knows nothing of fulfilment records, so a row of ours left behind made it fail on the foreign
// key. So: our businesses use their own domain (@calls.bdd.example.com, which no other pattern
// matches) and their own subscription prefix (sub_callsbdd_), and everything we create is removed
// both before AND after each of our scenarios, leaving nothing for anybody else to trip over.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const BACKFILL = path.resolve(__dirname, "../../migrations/1791100000000_business-supporter-calls.js");
const MARKER = "%@calls.bdd.example.com";
const SUBSCRIPTION_PREFIX = "sub_callsbdd_";

async function removeOurRows() {
  const { rows } = await pool.query("SELECT id FROM donors WHERE email LIKE $1", [MARKER]);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  // Children first (FK RESTRICT to donors). business_supporter_calls cascades with its fulfilment.
  await pool.query("DELETE FROM business_outreach WHERE donor_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM business_supporter_fulfilment WHERE donor_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM subscription_dunning WHERE donor_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM donations WHERE donor_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM donors WHERE id = ANY($1)", [ids]);
}

Before({ tags: "@business-calls" }, removeOurRows);
After({ tags: "@business-calls" }, removeOurRows);

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  // Mandatory email 2FA (TASK-188): outside production the code comes back as devCode.
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    const body2 = await res2.json().catch(() => ({}));
    return body2.token;
  }
  return undefined;
}

// One sign in per person per scenario, rather than one per step.
async function tokenFor(world, email, password) {
  world.callTokens = world.callTokens || {};
  if (!world.callTokens[email]) world.callTokens[email] = await login(email, password);
  return world.callTokens[email];
}

async function adminCall(world, method, urlPath, email, password, body) {
  const token = await tokenFor(world, email, password);
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  world.adminStatus = res.status;
  world.adminBody = await res.json().catch(() => ({}));
  return world.adminBody;
}

async function fulfilmentIdFor(email) {
  const { rows } = await pool.query(
    `SELECT f.id FROM business_supporter_fulfilment f JOIN donors dn ON dn.id = f.donor_id WHERE dn.email = $1`,
    [email],
  );
  assert.ok(rows[0], `no fulfilment record for ${email}`);
  return rows[0].id;
}

function listedRow(world, email) {
  assert.ok(world.callList, "the business supporters list has not been read");
  const row = world.callList.find((r) => r.email === email);
  assert.ok(row, `${email} is not in the business supporters list`);
  return row;
}

// --- seeding ------------------------------------------------------------------------------------

Given(
  "a business {string} with email {string} has given monthly since {string}",
  async function (businessName, email, since) {
    const donor = await pool.query(
      `INSERT INTO donors (donor_type, full_name, business_name, email)
       VALUES ('company', 'Calls Contact', $1, $2) RETURNING id`,
      [businessName, email],
    );
    const donorId = donor.rows[0].id;
    const subscription = `${SUBSCRIPTION_PREFIX}${donorId}`;
    await pool.query(
      `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status,
                              stripe_subscription_id, created_at)
       VALUES ($1, 'monthly', 5000, false, 'not_eligible', 'paid', $2, $3::timestamptz)`,
      [donorId, subscription, `${since}T10:00:00Z`],
    );
    await pool.query(
      `INSERT INTO business_supporter_fulfilment (donor_id, band, token) VALUES ($1, 'gold', $2)`,
      [donorId, randomBytes(16).toString("hex")],
    );
  },
);

async function setDunning(email, status, cancelled) {
  await pool.query(
    `INSERT INTO subscription_dunning (donor_id, stripe_subscription_id, status, failed_attempts, cancelled_at)
     SELECT dn.id, d.stripe_subscription_id, $2, 0, CASE WHEN $3::boolean THEN now() ELSE NULL END
       FROM donors dn JOIN donations d ON d.donor_id = dn.id
      WHERE dn.email = $1 AND d.mode = 'monthly'
      ORDER BY d.id ASC LIMIT 1
     ON CONFLICT (stripe_subscription_id)
       DO UPDATE SET status = EXCLUDED.status, cancelled_at = EXCLUDED.cancelled_at`,
    [email, status, cancelled],
  );
}

Given("the monthly gift of the business with email {string} is {string}", async function (email, status) {
  await setDunning(email, status, false);
});

Given("the business with email {string} cancelled its monthly gift", async function (email) {
  // Stripe keeps a cancelled subscription 'active' until its period ends; cancelled_at is the truth.
  await setDunning(email, "active", true);
});

// A fresh subscription after a cancellation, paid without trouble, so (like a real one) it has no
// subscription_dunning row of its own.
Given(
  "the business with email {string} started giving monthly again on a new subscription on {string}",
  async function (email, since) {
    await pool.query(
      `INSERT INTO donations (donor_id, mode, amount_pence, gift_aid, claim_status, payment_status,
                              stripe_subscription_id, created_at)
       SELECT dn.id, 'monthly', 5000, false, 'not_eligible', 'paid', $2::text || dn.id::text || '_again', $3::timestamptz
         FROM donors dn WHERE dn.email = $1`,
      [email, SUBSCRIPTION_PREFIX, `${since}T10:00:00Z`],
    );
  },
);

Given("the business with email {string} already has the phone {string}", async function (email, phone) {
  await pool.query("UPDATE business_supporter_fulfilment SET phone = $2 WHERE id = $1", [
    await fulfilmentIdFor(email),
    phone,
  ]);
});

Given(
  "Contact businesses holds the phone {string} for the business with email {string}",
  async function (phone, email) {
    await pool.query(
      `INSERT INTO business_outreach (business_name, business_type, contact_phone, donor_id)
       SELECT dn.business_name, 'company', $2, dn.id FROM donors dn WHERE dn.email = $1`,
      [email, phone],
    );
  },
);

// --- actions ------------------------------------------------------------------------------------

When("I list the business supporters as {string} with password {string}", async function (email, password) {
  const body = await adminCall(this, "GET", "/api/admin/fulfilments", email, password);
  assert.equal(this.adminStatus, 200, `list failed: ${JSON.stringify(body)}`);
  // The list carries the donor id, not the email; join it back here so the steps can name a business.
  const { rows } = await pool.query("SELECT id, email FROM donors WHERE email LIKE $1", [MARKER]);
  const emailById = Object.fromEntries(rows.map((r) => [r.id, r.email]));
  this.callList = (body.results || []).map((r) => ({ ...r, email: emailById[r.donor_id] }));
});

When(
  "I mark the business with email {string} as called with the note {string} as {string} with password {string}",
  async function (business, note, email, password) {
    const id = await fulfilmentIdFor(business);
    await adminCall(this, "POST", `/api/admin/fulfilments/${id}/calls`, email, password, { note });
  },
);

When(
  "I set the phone of the business with email {string} to {string} as {string} with password {string}",
  async function (business, phone, email, password) {
    const id = await fulfilmentIdFor(business);
    await adminCall(this, "PUT", `/api/admin/fulfilments/${id}/phone`, email, password, { phone });
  },
);

// Run the migration's own backfill SQL inside a transaction that is always rolled back (CI's
// database is empty when migrations run, so the migration itself never meets an outreach row).
When("the TASK-491 phone backfill runs", async function () {
  const { BACKFILL_PHONE_SQL } = require(BACKFILL);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(BACKFILL_PHONE_SQL);
    const phones = await client.query(
      `SELECT dn.email, f.id, f.phone FROM business_supporter_fulfilment f JOIN donors dn ON dn.id = f.donor_id
        WHERE dn.email LIKE $1`,
      [MARKER],
    );
    this.backfilledPhones = Object.fromEntries(phones.rows.map((r) => [r.email, r.phone]));
    const ids = phones.rows.map((r) => r.id);
    const logged = await client.query(
      `SELECT entity_id FROM audit_log
        WHERE action = 'fulfilment.phone' AND actor = 'migration:TASK-491' AND entity_id = ANY($1)`,
      [ids],
    );
    const emailById = Object.fromEntries(phones.rows.map((r) => [r.id, r.email]));
    this.backfillLogged = logged.rows.map((r) => emailById[r.entity_id]);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
});

// --- outcomes -----------------------------------------------------------------------------------

Then("the business with email {string} is due a call", function (email) {
  assert.equal(listedRow(this, email).callDue, true);
});

Then("the business with email {string} is not due a call", function (email) {
  assert.equal(listedRow(this, email).callDue, false);
});

Then(
  "the business with email {string} was last called by {string} with the note {string}",
  function (email, by, note) {
    const row = listedRow(this, email);
    assert.equal(row.last_called_by, by);
    assert.equal(row.last_call_note, note);
    assert.ok(row.last_called_at, "expected a last called date");
  },
);

Then("the business with email {string} has the phone {string}", function (email, phone) {
  assert.equal(listedRow(this, email).phone, phone);
});

Then("the History of the business with email {string} includes {string}", async function (email, action) {
  const id = await fulfilmentIdFor(email);
  const { rows } = await pool.query(
    `SELECT action FROM audit_log WHERE entity = 'business_supporter_fulfilment' AND entity_id = $1`,
    [id],
  );
  assert.ok(
    rows.some((r) => r.action === action),
    `expected ${action} in History, got ${rows.map((r) => r.action).join(", ")}`,
  );
});

Then("the backfilled phone of the business with email {string} is {string}", function (email, phone) {
  assert.equal(this.backfilledPhones[email], phone);
});

Then("the backfilled phone of the business with email {string} is empty", function (email) {
  assert.equal(this.backfilledPhones[email], null);
});

Then("the backfill logged a phone copy for the business with email {string}", function (email) {
  assert.ok(this.backfillLogged.includes(email), `no fulfilment.phone audit row for ${email}`);
});

AfterAll(async function () {
  await pool.end();
});
