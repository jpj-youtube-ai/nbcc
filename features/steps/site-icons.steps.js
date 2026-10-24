const { When, Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for site-icons.feature (TASK-575). Plain GETs against the running app; no database.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

When("a browser asks for the site icon at {string}", async function (path) {
  const res = await fetch(`${BASE_URL}${path}`);
  this.iconStatus = res.status;
  this.iconType = res.headers.get("content-type") || "";
  this.iconBody = Buffer.from(await res.arrayBuffer());
});

Then("the icon answers 200 with the content type {string}", function (type) {
  assert.equal(this.iconStatus, 200);
  assert.ok(this.iconType.includes(type), `content type was ${this.iconType}`);
  assert.ok(this.iconBody.length > 0, "the answer was empty");
});

Then("the page names {string} and {string} in its head", function (first, second) {
  const html = this.iconBody.toString("utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  assert.ok(head.includes(`href="${first}"`), `${first} is not in the head`);
  assert.ok(head.includes(`href="${second}"`), `${second} is not in the head`);
});

Then("the manifest's short name is {string} and it opens in the browser", function (name) {
  const manifest = JSON.parse(this.iconBody.toString("utf8"));
  assert.equal(manifest.short_name, name);
  assert.equal(manifest.display, "browser");
});
