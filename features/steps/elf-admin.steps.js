const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for features/elf-admin.feature: Head Elf HQ, the Elf Detective School's own admin section
// (docs/superpowers/specs/2026-11-05-elf-admin-design.md). The families come from the elf join steps
// (features/steps/elf-join.steps.js, whose @elf-school hooks clear them) and the staff from "an admin
// user {string} with role {string} and password {string}" (features/steps/admin-api.steps.js, whose
// @admin hooks clear them). Every family and person here is invented.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

/** A real admin session, through the sign in and its emailed code (the code is handed back here,
 *  outside production), as features/steps/admin-api.steps.js signs in. */
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

When("{string} with password {string} reads Head Elf HQ", async function (email, password) {
  const token = await login(email, password);
  const res = await fetch(`${BASE_URL}/api/admin/elf/hq`, { headers: { Authorization: `Bearer ${token}` } });
  this.hqStatus = res.status;
  this.hqBody = await res.json().catch(() => ({}));
});

Then("Head Elf HQ answers {int}", function (status) {
  assert.equal(this.hqStatus, status, JSON.stringify(this.hqBody));
});

Then("Head Elf HQ counts {int} family and {int} name to check", function (families, names) {
  assert.equal(this.hqStatus, 200, JSON.stringify(this.hqBody));
  assert.equal(this.hqBody.numbers.families, families);
  assert.equal(this.hqBody.numbers.namesToCheck, names);
  assert.ok(this.hqBody.quests.some((q) => q.id === "names"), JSON.stringify(this.hqBody.quests));
});
