const { Before } = require("@cucumber/cucumber");

// The Ball's moment (src/site/after-ball.ts): 20:00 UTC on 7 November 2026. A scenario about the
// Ball's promotion on the public pages is tagged @until-the-ball, because these scenarios run against
// the real clock and the promotion comes down by itself. Past the moment they are skipped rather than
// failing every pull request; the tidy up after the Ball removes them with the promotion.
const AFTER_BALL_AT = Date.UTC(2026, 10, 7, 20, 0, 0);

Before({ tags: "@until-the-ball" }, function () {
  return Date.now() >= AFTER_BALL_AT ? "skipped" : undefined;
});
