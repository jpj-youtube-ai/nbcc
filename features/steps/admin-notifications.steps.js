"use strict";

const assert = require("node:assert/strict");
const { When, Then } = require("@cucumber/cucumber");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Phone notifications (TASK-619). These steps exist mainly for one scenario.
//
// Three of these handlers originally answered 401 themselves AFTER authorizeAny had already sent
// one. Express throws ERR_HTTP_HEADERS_SENT from the second res.json, and because the handlers
// are async nothing catches it: an unhandled rejection, which Node ends the process on. The whole
// site shares that process and that load balancer, so an anonymous POST with no credentials took
// everything down.
//
// Which is why "the site is still answering" is a step. Asserting the 401 alone would have passed
// against the broken code: the 401 WAS sent. The fault was everything after it.

When("I send a {word} to the admin path {string} without a token", async function (method, path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: method.toUpperCase(),
    headers: { "Content-Type": "application/json" },
    body: method.toUpperCase() === "GET" ? undefined : JSON.stringify({}),
  });
  this.adminStatus = res.status;
  this.adminBody = await res.text();
});

Then("the site is still answering", async function () {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200, "the server died answering the previous request");
});
