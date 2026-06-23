const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// BASE_URL is localhost for PR/local runs, the staging ALB URL on staging.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

When("I GET {string}", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`);
  this.statusCode = res.status;
  this.body = await res.json().catch(() => ({}));
});

Then("the response status should be {int}", function (expected) {
  assert.equal(this.statusCode, expected);
});

Then("the response field {string} should be {string}", function (field, value) {
  assert.equal(this.body[field], value);
});
