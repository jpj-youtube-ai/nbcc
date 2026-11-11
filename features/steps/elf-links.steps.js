// Steps for features/elf-links.feature (TASK-613): Elf Detective School switched on early, with nothing
// on the site linking to it until 10am on Friday 13 November 2026. The pages come from "I request the
// elf path {string}" (features/steps/elf-join.steps.js, whose @elf-school hooks switch it off again).
// Each check reads the real clock (elf-links-moment.js), so it passes on either side of the moment.
const { Then } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { elfLinksLive } = require("./elf-links-moment");

const CARD = 'id="elfCard"';

function when() {
  return elfLinksLive() ? "from 10am on Friday 13 November" : "before 10am on Friday 13 November";
}

Then("the page carries the Elf Detective School card only from Friday 13 November at 10am", function () {
  assert.equal(this.elfStatus, 200, this.elfText.slice(0, 200));
  assert.equal(this.elfText.includes(CARD), elfLinksLive(), `the card ${elfLinksLive() ? "should" : "must not"} be on the page ${when()}`);
});

Then("the page links to Elf Detective School only from Friday 13 November at 10am", function () {
  assert.equal(this.elfStatus, 200, this.elfText.slice(0, 200));
  assert.equal(this.elfText.includes('href="/elf"'), elfLinksLive(), `a link to /elf ${elfLinksLive() ? "should" : "must not"} be on the page ${when()}`);
});

Then("the page does not link to Elf Detective School", function () {
  assert.equal(this.elfStatus, 200, this.elfText.slice(0, 200));
  assert.ok(!this.elfText.includes('href="/elf'), "no link to /elf while Elf Detective School is switched off");
  assert.ok(!this.elfText.includes(CARD), "no card while Elf Detective School is switched off");
});
