const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for admin-2fa.feature (admin-management Phase 3 · TASK-188, mandatory email 2FA). Reuses
// the shared @admin Before hook + "an admin user {string} with password {string}" Given and the
// step-1 login When/Then steps already defined in admin-auth.steps.js (same email suffix
// '%admin.bdd@example.com' cleanup); this file only adds what step 1 doesn't already cover: driving
// POST /api/admin/login/2fa and asserting the step-1 2FA-challenge shape (step/devCode/deviceToken).
//
// "the code from the login response" / "a wrong code for" read `this.adminLoginDevCode`, NOT
// `this.adminBody.devCode` directly — admin-auth.steps.js's step-1 login step stashes it there
// separately, because a deliberate wrong-code attempt (or several, for the lockout scenario)
// overwrites `this.adminBody` with the 401 response before the real code is ever used.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function postTwoFactor(body) {
  const res = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// A code guaranteed to differ from the real devCode (increment mod 1e6, zero-padded) rather than a
// fixed literal, so this can never flake by coincidentally guessing the real 6-digit code.
function wrongCodeFor(devCode) {
  const next = (Number(devCode) + 1) % 1_000_000;
  return String(next).padStart(6, "0");
}

Then("the admin response requires a one-time code", function () {
  assert.equal(this.adminBody.step, "2fa", `expected step "2fa", got ${JSON.stringify(this.adminBody)}`);
});

Then("the admin response does not require a one-time code", function () {
  assert.ok(!this.adminBody.step, `expected no step field, got ${JSON.stringify(this.adminBody)}`);
});

Then("the admin response includes a one-time code for this non-production environment", function () {
  assert.match(this.adminBody.devCode, /^\d{6}$/, `expected a 6-digit devCode, got ${this.adminBody.devCode}`);
});

Then("the admin response has a device token", function () {
  assert.ok(this.adminBody.deviceToken && this.adminBody.deviceToken.length > 0, "expected a deviceToken");
});

When(
  "I POST to admin login 2fa with email {string} and the code from the login response",
  async function (email) {
    const { status, body } = await postTwoFactor({ email, code: this.adminLoginDevCode });
    this.adminStatus = status;
    this.adminBody = body;
  },
);

When(
  "I POST to admin login 2fa with email {string} and the code from the login response, remembering the device",
  async function (email) {
    const { status, body } = await postTwoFactor({ email, code: this.adminLoginDevCode, remember: true });
    this.adminStatus = status;
    this.adminBody = body;
  },
);

When("I POST to admin login 2fa with a wrong code for {string}", async function (email) {
  const { status, body } = await postTwoFactor({ email, code: wrongCodeFor(this.adminLoginDevCode) });
  this.adminStatus = status;
  this.adminBody = body;
});

When("I submit {int} wrong admin 2FA code(s) for {string}", async function (times, email) {
  const code = wrongCodeFor(this.adminLoginDevCode);
  let result;
  for (let i = 0; i < times; i += 1) {
    result = await postTwoFactor({ email, code });
  }
  this.adminStatus = result.status;
  this.adminBody = result.body;
});

When(
  "I POST to admin login with email {string}, password {string} and the device token from the 2fa response",
  async function (email, password) {
    const deviceToken = this.adminBody.deviceToken;
    const res = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, deviceToken }),
    });
    this.adminStatus = res.status;
    this.adminBody = await res.json().catch(() => ({}));
  },
);
