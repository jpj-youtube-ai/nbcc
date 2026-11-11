const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Whether the site may link to Elf Detective School yet, by the real clock, for the steps whose right
// answer changes at that moment (TASK-613): 10am UK time on Friday 13 November 2026. Before it, a page
// must not link to Elf Detective School even while it is switched on; from it, the links are there. The
// moment is read from the app's own file (src/elf/links-at.ts), as ball-night.js reads the Ball's night,
// so the suite passes on either side of it. No step definitions here.

const SOURCE = resolve(__dirname, "../../src/elf/links-at.ts");

function linksAt() {
  const m = /AT_MS\s*=\s*Date\.UTC\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/.exec(readFileSync(SOURCE, "utf8"));
  if (!m) throw new Error("AT_MS not found in src/elf/links-at.ts");
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  return Date.UTC(year, month, day, hour, minute, second);
}

/** True from the moment the site may link to Elf Detective School. */
function elfLinksLive(now = new Date()) {
  return now.getTime() >= linksAt();
}

module.exports = { elfLinksLive };
