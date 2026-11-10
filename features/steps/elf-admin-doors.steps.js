const { Given, When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for features/elf-admin-doors.feature: Head Elf HQ > Doors. The staff come from "an admin user
// {string} with role {string} and password {string}" (features/steps/admin-api.steps.js, whose @admin hooks
// clear them). The server uses the real clock, so a door whose clue 1 is out cannot change its times or
// clues. The @elf-doors hook therefore moves the school to next year, whose December is still ahead
// whenever the tests run, and puts the year back afterwards. Every place and person here is invented.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let yearBefore = null;
const testYear = () => new Date().getFullYear() + 1;

/** Takes the test year's doors away (their names and clues go with them). */
async function clearDoors() {
  await pool.query("DELETE FROM elf_doors WHERE year = $1", [testYear()]);
}
Before({ tags: "@elf-doors" }, async function () {
  const r = await pool.query("SELECT year FROM elf_settings WHERE id = 1");
  yearBefore = r.rows[0] ? r.rows[0].year : null;
  await pool.query("UPDATE elf_settings SET year = $1 WHERE id = 1", [testYear()]);
  await clearDoors();
});
After({ tags: "@elf-doors" }, async function () {
  await clearDoors();
  if (yearBefore !== null) await pool.query("UPDATE elf_settings SET year = $1 WHERE id = 1", [yearBefore]);
});
AfterAll(async () => {
  await pool.end();
});

/** A real admin session, through the sign in and its emailed code (handed back here outside production). */
async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
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

/** Sends one request as `email`, and keeps the answer (and the door it holds, and the one before). */
async function send(world, email, password, method, path, json) {
  world.doorTokens = world.doorTokens || {};
  if (!world.doorTokens[email]) world.doorTokens[email] = await login(email, password);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${world.doorTokens[email]}`, ...(json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  world.doorsStatus = res.status;
  world.doorsBody = await res.json().catch(() => ({}));
  if (world.doorsBody && world.doorsBody.door) {
    world.previousDoor = world.lastDoor;
    world.lastDoor = world.doorsBody.door;
  }
}

Given("{string} has {string} access to the Elf Detective School in the admin", async function (email, level) {
  await pool.query("UPDATE users SET permissions = $2::jsonb WHERE email = $1", [email, JSON.stringify({ elf: level })]);
});

// The list makes the year's 24 door rows, so a door can be changed after it has been opened.
Given("{string} with password {string} has opened the doors list", async function (email, password) {
  await send(this, email, password, "GET", "/api/admin/elf/doors");
  assert.equal(this.doorsStatus, 200, JSON.stringify(this.doorsBody));
});

When("{string} with password {string} sends {word} to {string}", async function (email, password, method, path) {
  await send(this, email, password, method, path);
});

When("{string} with password {string} sends {word} to {string} with:", async function (email, password, method, path, docString) {
  await send(this, email, password, method, path, JSON.parse(docString));
});

When("{string} with password {string} takes the name {string} off door {int}", async function (email, password, name, door) {
  await send(this, email, password, "GET", `/api/admin/elf/doors/${door}`);
  const found = this.lastDoor.names.find((n) => n.name === name);
  assert.ok(found, `door ${door} has no name ${name}`);
  await send(this, email, password, "DELETE", `/api/admin/elf/doors/${door}/names/${found.id}`);
});

Then("the doors answer is {int}", function (status) {
  assert.equal(this.doorsStatus, status, JSON.stringify(this.doorsBody));
});

Then("the doors answer has {int} doors", function (count) {
  assert.equal(this.doorsBody.doors.length, count);
});

Then("the doors answer can be edited by this head elf", function () {
  assert.equal(this.doorsBody.canEdit, true);
});

Then("the tile for door {int} shows the place {string} and {int} to do", function (door, place, toDo) {
  const tile = this.doorsBody.doors.find((d) => d.door === door);
  assert.ok(tile, `no tile for door ${door}`);
  assert.equal(tile.placeName, place);
  assert.equal(tile.toDo, toDo);
});

Then("the first problem says {string}", function (words) {
  assert.ok(this.doorsBody.problems.length > 0, "no problems");
  assert.equal(this.doorsBody.problems[0].message, words);
});

Then("clue {int} of the door reads {string}", function (n, words) {
  assert.equal(this.lastDoor.clues.find((c) => c.n === n).words, words);
});

Then("clue {int} of the door has no words", function (n) {
  assert.equal(this.lastDoor.clues.find((c) => c.n === n).words, null);
});

// A time comes back from the database with seconds, so only "HH:MM" is compared.
const TIME_FIELDS = ["closesAt", "clue1Time", "clue2Time", "clue3Time", "revealTime"];

Then("the door has these details", function (docString) {
  for (const [key, want] of Object.entries(JSON.parse(docString))) {
    const got = TIME_FIELDS.includes(key) ? String(this.lastDoor[key]).slice(0, 5) : this.lastDoor[key];
    assert.equal(got, want, `${key}: wanted ${want}, got ${got}`);
  }
});

Then("the door has a name {string}", function (name) {
  assert.ok(this.lastDoor.names.some((n) => n.name === name), JSON.stringify(this.lastDoor.names));
});

Then("the door has no name {string}", function (name) {
  assert.ok(!this.lastDoor.names.some((n) => n.name === name), JSON.stringify(this.lastDoor.names));
});

Then("the door's word is not the one before", function () {
  assert.ok(this.previousDoor && this.previousDoor.tagWord, "no word to compare with");
  assert.ok(this.lastDoor.tagWord, "no new word");
  assert.notEqual(this.lastDoor.tagWord, this.previousDoor.tagWord);
});

Then("the door's {string} is ticked", function (field) {
  assert.equal(this.doorsStatus, 200, JSON.stringify(this.doorsBody));
  assert.ok(this.lastDoor[field], `${field} is not ticked`);
  const by = field === "droppedOffAt" ? this.lastDoor.droppedOffBy : this.lastDoor.thankedBy;
  assert.ok(by, "nobody is named as the one who ticked it");
});

Then("the door's {string} is not ticked", function (field) {
  assert.equal(this.doorsStatus, 200, JSON.stringify(this.doorsBody));
  assert.equal(this.lastDoor[field], null);
});
