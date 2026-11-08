const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Whether the Festive Ball's night has been and gone, by the UK day, for the steps whose right answer
// changes on that night (TASK-598): the "a week to go" reminder refuses after it, and the Overview
// stops showing the Ball's seats. The night is read from the app's own BALL_EVENT_DATE
// (src/ball/run-up-runner.ts), so setting next year's Ball moves these steps with it. No step
// definitions here.

const SOURCE = resolve(__dirname, "../../src/ball/run-up-runner.ts");

function ballNight() {
  const m = /BALL_EVENT_DATE\s*=\s*new Date\("([^"]+)"\)/.exec(readFileSync(SOURCE, "utf8"));
  if (!m) throw new Error("BALL_EVENT_DATE not found in src/ball/run-up-runner.ts");
  return new Date(m[1]);
}

const ukDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

/** True once the UK day is after the Ball's night, as the app's own daysToBall counts it. */
function ballIsOver(now = new Date()) {
  return ukDay(now) > ukDay(ballNight());
}

module.exports = { ballIsOver };
