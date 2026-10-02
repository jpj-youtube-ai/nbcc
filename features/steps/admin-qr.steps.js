const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for admin-qr.feature (TASK-492). Drives /api/admin/qr-codes over HTTP. The staff member
// comes from the shared @admin steps (the address ends "admin.bdd@example.com", which the @admin
// hooks remove). Nothing here writes to the database.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "qr-pw-123";

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
  world.qrTokens = world.qrTokens || {};
  if (!world.qrTokens[email]) world.qrTokens[email] = await login(email);
  return world.qrTokens[email];
}

async function get(world, path, email) {
  const headers = email ? { Authorization: `Bearer ${await tokenFor(world, email)}` } : {};
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  world.qrStatus = res.status;
  world.qrHeaders = res.headers;
  const type = res.headers.get("content-type") || "";
  world.qrBody = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
}

When("I ask for the QR codes without a session", async function () {
  await get(this, "/api/admin/qr-codes", null);
});

When("{string} lists the QR codes", async function (email) {
  await get(this, "/api/admin/qr-codes", email);
});

When("{string} downloads the {string} code for {string}", async function (email, format, path) {
  await get(this, `/api/admin/qr-codes/image?path=${encodeURIComponent(path)}&format=${format}`, email);
});

Then("the QR answer is {int}", function (status) {
  assert.equal(this.qrStatus, status, JSON.stringify(this.qrBody).slice(0, 300));
});

Then("the home page and the donate page are listed with their codes", function () {
  const pages = this.qrBody.pages || [];
  for (const path of ["/", "/donate"]) {
    const page = pages.find((p) => p.path === path);
    assert.ok(page, `${path} is listed`);
    assert.ok(String(page.svg).startsWith("<svg"), `${path} has its code`);
  }
});

Then("the donate page's code carries {string}", function (link) {
  const page = (this.qrBody.pages || []).find((p) => p.path === "/donate");
  assert.equal(page.link, link);
});

Then("the download is {string} named {string}", function (type, name) {
  assert.ok((this.qrHeaders.get("content-type") || "").startsWith(type), this.qrHeaders.get("content-type"));
  assert.equal(this.qrHeaders.get("content-disposition"), `attachment; filename="${name}"`);
  assert.ok(this.qrBody.length > 100, "the file has something in it");
});
