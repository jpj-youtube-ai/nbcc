const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for admin-qr-named.feature (TASK-588). Drives /api/admin/qr-codes/named and the public
// /q/c<id> short links over HTTP. The staff come from the shared @admin steps (addresses ending
// "admin.bdd@example.com", which the @admin hooks remove). The codes these scenarios make stay in
// the test database: a code is never deleted, because a printed one must keep working.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "qr-pw-123";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PREVIEW = "WhatsApp/2.23.20 A";

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    return (await res2.json().catch(() => ({}))).token;
  }
  throw new Error(`could not sign in as ${email}: ${JSON.stringify(body)}`);
}

// One sign-in per person per scenario: each one mints and spends a 2FA code.
async function tokenFor(world, email) {
  world.qrnTokens = world.qrnTokens || {};
  if (!world.qrnTokens[email]) world.qrnTokens[email] = await login(email);
  return world.qrnTokens[email];
}

async function send(world, method, path, email, body) {
  const headers = email ? { Authorization: `Bearer ${await tokenFor(world, email)}` } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  world.qrnStatus = res.status;
  world.qrnHeaders = res.headers;
  const type = res.headers.get("content-type") || "";
  world.qrnBody = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
}

async function scan(world, path, ua) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual", headers: { "User-Agent": ua } });
  world.scanStatus = res.status;
  world.scanLocation = res.headers.get("location");
  world.scanCache = res.headers.get("cache-control");
}

When("I ask for the named QR codes without a session", async function () {
  await send(this, "GET", "/api/admin/qr-codes/named", null);
});

When("{string} lists the named QR codes", async function (email) {
  await send(this, "GET", "/api/admin/qr-codes/named", email);
});

When("{string} makes a named QR code {string} going to {string}", async function (email, name, target) {
  // A name of this run's own, so a code made by an earlier run of the same scenario is never found.
  this.qrnName = `${name} ${Date.now()}`;
  await send(this, "POST", "/api/admin/qr-codes/named", email, { name: this.qrnName, target });
  if (this.qrnStatus === 201) this.qrnId = this.qrnBody.id;
});

When("{string} changes the new code to go to {string}", async function (email, target) {
  await send(this, "PATCH", `/api/admin/qr-codes/named/${this.qrnId}`, email, { target });
});

When("{string} hides the new code", async function (email) {
  await send(this, "PATCH", `/api/admin/qr-codes/named/${this.qrnId}`, email, { hidden: true });
});

When("{string} downloads the new code as {string}", async function (email, format) {
  await send(this, "GET", `/api/admin/qr-codes/named/${this.qrnId}/image?format=${format}`, email);
});

When("a phone scans the new code", async function () {
  await scan(this, `/q/c${this.qrnId}`, PHONE);
});

When("a link preview fetches the new code", async function () {
  await scan(this, `/q/c${this.qrnId}`, PREVIEW);
});

When("a phone scans the short link {string}", async function (path) {
  await scan(this, path, PHONE);
});

Then("the named QR answer is {int}", function (status) {
  assert.equal(this.qrnStatus, status, JSON.stringify(this.qrnBody).slice(0, 300));
});

Then("the scan answer is {int}", function (status) {
  assert.equal(this.scanStatus, status);
});

Then("the new code's link is its short link", function () {
  assert.equal(this.qrnBody.link, `https://nbcc.scot/q/c${this.qrnId}`);
});

Then("the scan is forwarded to {string} tagged as that code", function (to) {
  assert.equal(this.scanStatus, 302);
  assert.equal(this.scanLocation, `${to}?utm_medium=qr&utm_campaign=c${this.qrnId}`);
  assert.equal(this.scanCache, "no-store");
});

Then("the scan is forwarded to exactly {string}", function (to) {
  assert.equal(this.scanStatus, 302);
  assert.equal(this.scanLocation, to);
});

Then("the new code is listed with {int} scan(s), going to {string}", async function (scans, title) {
  // The count is written just after the scan is answered, so give it a moment to land.
  let code;
  for (let i = 0; i < 20; i++) {
    code = (this.qrnBody.codes || []).find((c) => c.id === this.qrnId);
    if (code && code.scans.total >= scans) break;
    await new Promise((r) => setTimeout(r, 100));
    const res = await fetch(`${BASE_URL}/api/admin/qr-codes/named`, {
      headers: { Authorization: `Bearer ${this.qrnTokens["ann.qrnamed.admin.bdd@example.com"]}` },
    });
    this.qrnBody = await res.json();
  }
  code = (this.qrnBody.codes || []).find((c) => c.id === this.qrnId);
  assert.ok(code, "the new code is listed");
  assert.equal(code.name, this.qrnName);
  assert.equal(code.targetTitle, title);
  assert.equal(code.scans.total, scans, "a phone counts, a link preview does not");
  assert.ok(String(code.svg).startsWith("<svg"), "it has its preview");
});
