const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for checkout.feature (REQ-029). Reuses the shared "response status should
// be" assertion from health.steps.js; adds a JSON-body POST and a prefix check.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

When("I POST {string} with JSON:", async function (path, docString) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: docString,
  });
  this.statusCode = res.status;
  this.text = await res.text();
  try {
    this.body = JSON.parse(this.text);
  } catch {
    this.body = {};
  }
});

// TASK-321: the stub echo returns the session's stamped metadata, so a scenario can assert
// what the WEBHOOK will later read — which is what decides the recorded gift and its Gift Aid.
Then("the session metadata field {string} should be {string}", function (field, value) {
  const md = (this.body && this.body.metadata) || {};
  assert.strictEqual(
    String(md[field]),
    value,
    `expected session metadata "${field}" to be "${value}", got "${md[field]}"`,
  );
});

Then("the response field {string} should start with {string}", function (field, prefix) {
  const value = this.body[field];
  assert.ok(
    typeof value === "string" && value.startsWith(prefix),
    `expected field "${field}" (${value}) to start with "${prefix}"`,
  );
});

Then("the response field {string} should contain {string}", function (field, substring) {
  const value = this.body[field];
  assert.ok(
    typeof value === "string" && value.includes(substring),
    `expected field "${field}" (${value}) to contain "${substring}"`,
  );
});
