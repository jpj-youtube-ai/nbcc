const { Before } = require("@cucumber/cucumber");

// /sleigh is up until its switch off day, 31 January 2027 unless staff change it (sleigh_settings.off_on),
// then forwards to the home page. These scenarios run against the real clock, so past that day the ones
// tagged @while-sleigh-on are skipped rather than failing every pull request. The steps themselves are
// the shared ones in site-pages.steps.js and checkout.steps.js.
const UK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
Before({ tags: "@while-sleigh-on" }, function () {
  return UK_DAY.format(new Date()) >= "2027-01-31" ? "skipped" : undefined;
});
