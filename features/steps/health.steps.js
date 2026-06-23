const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// BASE_URL is localhost for PR/local runs, the staging ALB URL on staging.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

When("I GET {string}", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`);
  this.statusCode = res.status;
  // Keep the raw text (HTML responses) and parse JSON when the body is JSON.
  this.text = await res.text();
  try {
    this.body = JSON.parse(this.text);
  } catch {
    this.body = {};
  }
});

Then("the response status should be {int}", function (expected) {
  assert.equal(this.statusCode, expected);
});

Then("the response field {string} should be {string}", function (field, value) {
  assert.equal(this.body[field], value);
});

Then("the response body should contain {string}", function (expected) {
  assert.ok(
    this.text.includes(expected),
    `expected response body to contain "${expected}"`,
  );
});
