const { Given, When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for fundraising-materials-v2.feature (TASK-512). The fundraisers, the switch, signing in and
// the clean up are fundraising.steps.js's and fundraising-private.steps.js's; the visitor steps are
// events.steps.js's; opening a piece is fundraising-materials.steps.js's. Every name and address is
// invented.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function idOf(title) {
  const r = await pool.query("SELECT id, slug FROM fundraisers WHERE title = $1 ORDER BY id DESC LIMIT 1", [title]);
  assert.ok(r.rows[0], `no fundraiser called ${title}`);
  return r.rows[0];
}

When("someone scans the {string} code of {string}", async function (size, title) {
  const { id } = await idOf(title);
  const res = await fetch(`${BASE_URL}/q/${id}-${size}`, { redirect: "manual" });
  this.scanStatus = res.status;
  this.scanLocation = res.headers.get("location");
  this.scanId = id;
});

Then("the scan is sent to the page of {string} tagged {string}", async function (title, size) {
  const { id, slug } = await idOf(title);
  assert.equal(this.scanStatus, 302);
  assert.equal(this.scanLocation, `/fundraise/${slug}?utm_medium=qr&utm_campaign=f${id}-${size}`);
});

Given("staff change the address of {string} to {string}", async function (title, slug) {
  const { id } = await idOf(title);
  await pool.query("UPDATE fundraisers SET slug = $2 WHERE id = $1", [id, slug]);
});

Then("the scan is sent to {string} tagged {string}", function (path, size) {
  assert.equal(this.scanStatus, 302);
  assert.equal(this.scanLocation, `${path}?utm_medium=qr&utm_campaign=f${this.scanId}-${size}`);
});

When("the signed in organiser asks us to print {int} A4 and {int} A3 posters for {string}", async function (a4, a3, title) {
  const { id } = await idOf(title);
  const res = await fetch(`${BASE_URL}/api/fundraise/manage/fundraisers/${id}/print-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", Cookie: `nbcc_fr_session=${this.frSession}` },
    body: JSON.stringify({ kind: "posters", a4, a3 }),
  });
  this.printStatus = res.status;
  this.printBody = await res.json();
});

Then("the print answer is {int}", function (status) {
  assert.equal(this.printStatus, status, JSON.stringify(this.printBody));
});

Then("{string} has a posters request to send, {int} asked for", async function (title, asked) {
  const { id } = await idOf(title);
  const r = await pool.query(
    `SELECT r.status, r.note, (f.wants->>'posterCount')::int AS asked
       FROM fundraiser_requests r JOIN fundraisers f ON f.id = r.fundraiser_id
      WHERE r.fundraiser_id = $1 AND r.kind = 'posters'`,
    [id],
  );
  assert.ok(r.rows[0], "no posters request");
  assert.equal(r.rows[0].status, "to_send");
  assert.equal(r.rows[0].asked, asked);
  assert.match(r.rows[0].note, /A4 posters and 2 A3 posters/);
});
