const { Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for ball-bags.feature (red bags at the Festive Ball). The POST, the status and the
// metadata field checks are the shared ones in checkout.steps.js and health.steps.js; these add
// the two "is not there" checks the red bags scenarios need.

// A red bags gift is always paid on Stripe's own page, so the response never carries the
// client secret our own page would mount.
Then("the response field {string} should be missing", function (field) {
  const body = this.body || {};
  assert.ok(!(field in body), `expected no field "${field}" in the response, got ${JSON.stringify(body[field])}`);
});

// The stub echo nests the stamped metadata: body.session = { id, metadata, mode }.
Then("the session metadata should have no field {string}", function (field) {
  const md = (this.body && this.body.session && this.body.session.metadata) || {};
  assert.ok(!(field in md), `expected no session metadata "${field}", got ${JSON.stringify(md[field])}`);
});
