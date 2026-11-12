"use strict";

const assert = require("node:assert/strict");
const { Then } = require("@cucumber/cucumber");

// The admin as a home-screen app. The request step lives in site-pages.steps.js; this adds the one
// assertion it had no need for: a manifest served as text/html is ignored by the phone without any
// error, so the content type is part of the behaviour, not a detail.

Then("the site response content type should contain {string}", function (expected) {
  assert.ok(
    (this.siteContentType || "").includes(expected),
    `expected content-type to contain "${expected}", got "${this.siteContentType}"`,
  );
});
