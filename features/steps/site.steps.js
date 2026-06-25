const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Extra steps for the marketing-site feature. Reuses the shared steps in
// health.steps.js ("I GET", "status should be", "body should contain").
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

When("I GET {string} without following redirects", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  this.statusCode = res.status;
  this.location = res.headers.get("location");
});

When("I POST {string}", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST" });
  this.statusCode = res.status;
  this.text = await res.text();
});

Then("the response should redirect to {string}", function (location) {
  assert.equal(this.location, location);
});
