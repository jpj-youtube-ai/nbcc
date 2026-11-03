const { Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");

// Steps for admin-get-involved.feature: the admin page's own markup, as it is served. "When the
// admin page is read" is in fundraising-invite-types.steps.js and leaves the page in this.adminHtml.
// Nothing here signs in or touches the database.

// The words on each menu entry, in order.
function menuEntries(html) {
  return [...html.matchAll(/<button class="admin-nav-link[^"]*"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
}
// What is on the page for a person to read: no comments, no scripts.
function shown(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
}

Then("the admin menu has a {string} entry", function (label) {
  assert.equal(menuEntries(this.adminHtml).filter((e) => e === label).length, 1, `the menu should have one ${label} entry`);
});

Then("the admin menu has no {string} entry", function (label) {
  assert.ok(!menuEntries(this.adminHtml).includes(label), `the menu still has ${label}`);
});

Then(
  "Get involved offers the sections {string}, {string}, {string}, {string} and {string}",
  function (a, b, c, d, e) {
    const row = (this.adminHtml.match(/<div[^>]*id="giSections"[^>]*>[\s\S]*?<\/div>/) || [""])[0];
    const sections = [...row.matchAll(/<button[^>]*data-gi-section="[a-z]+"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
    assert.deepEqual(sections, [a, b, c, d, e]);
  },
);

Then("the admin page asks {string}", function (question) {
  assert.ok(shown(this.adminHtml).includes(question), `the page does not ask: ${question}`);
});

Then("the admin page nowhere says {string}", function (words) {
  assert.ok(!shown(this.adminHtml).includes(words), `the page still says: ${words}`);
});
