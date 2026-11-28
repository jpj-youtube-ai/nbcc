const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");

// Steps for workshop.feature (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md). Every
// name and address here is invented, and each run makes its own address.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const unique = (who) => `${who}.${randomBytes(4).toString("hex")}@example.com`;

async function postDropOff(world, body) {
  const res = await fetch(`${BASE_URL}/api/workshop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  world.workshopStatus = res.status;
  world.workshopEmail = body.email;
  world.workshopBrought = body.brought;
}

When("somebody drops off {string} at the workshop and ticks the newsletter box", async function (brought) {
  await postDropOff(this, { name: "Robin Example", email: unique("robin"), brought, groupName: "Church group", newsletter: true });
});

When("a bot fills the hidden box on the workshop form", async function () {
  await postDropOff(this, { name: "Bot Example", email: unique("bot"), brought: "Nothing", website: "spam.example" });
});

When("somebody opens the workshop page", async function () {
  const res = await fetch(`${BASE_URL}/workshop`);
  this.workshopStatus = res.status;
  this.workshopHtml = await res.text();
});

Then("the workshop answers {int}", function (status) {
  assert.equal(this.workshopStatus, status);
});

Then("the drop-off is saved with what they brought", async function () {
  const { rows } = await pool.query("SELECT brought, group_name, newsletter FROM workshop_dropoffs WHERE email = $1", [this.workshopEmail]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brought, this.workshopBrought);
  assert.equal(rows[0].group_name, "Church group");
  assert.equal(rows[0].newsletter, true);
});

Then("they are on the newsletter list, signed up at the workshop", async function () {
  const { rows } = await pool.query(
    `SELECT s.consent_source FROM list_subscribers s JOIN subscriber_lists l ON l.id = s.list_id
      WHERE l.slug = 'newsletter' AND s.email = $1`,
    [this.workshopEmail],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].consent_source, "workshop");
});

Then("no drop-off is saved for the bot", async function () {
  const { rows } = await pool.query("SELECT 1 FROM workshop_dropoffs WHERE email = $1", [this.workshopEmail]);
  assert.equal(rows.length, 0);
});

Then("the workshop page asks search engines not to list it", function () {
  assert.match(this.workshopHtml, /<meta name="robots" content="noindex"/);
});
