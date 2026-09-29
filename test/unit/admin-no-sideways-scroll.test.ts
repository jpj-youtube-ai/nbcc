import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-442: nothing in the admin may scroll sideways inside a box.
//
// The cause was one line: .admin-table th/td carried white-space:nowrap, so any cell that could not
// wrap made its table wider than its container, and .admin-table-wrap's overflow-x turned that into
// a scrollbar inside a panel. Content hidden inside a box is content nobody finds, and on an admin
// screen that means a job nobody does.
//
// Four panels had already patched it individually before anybody noticed the default was the
// problem. This file is the guard that stops it being reintroduced, because the next person to add
// a table will copy whatever the base rule says.

const ROOT = resolve(__dirname, "../..");
const raw = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
// Comments explaining the nowrap history would otherwise read as rules re-introducing it.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

// The declaration block for the shared table cells, whitespace-insensitive.
function tableCellRule(): string {
  const start = css.indexOf(".admin-table th,.admin-table td{");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("the shared table cells", () => {
  it("wrap by default, rather than forcing the table wider than its box", () => {
    expect(tableCellRule()).toContain("white-space:normal");
  });

  it("never carry white-space:nowrap", () => {
    expect(tableCellRule()).not.toContain("nowrap");
  });

  // `anywhere`, not `break-word`. Both break a long word that will not fit a line, but ONLY
  // `anywhere` counts that break when the browser computes the table's MINIMUM width. With
  // break-word a long email address still sized its column as though unbreakable, and the table
  // kept demanding more room than its card had: measured 854px inside an 843px box.
  it("breaks long values in a way that also shrinks the table's minimum width", () => {
    expect(tableCellRule()).toContain("overflow-wrap:anywhere");
    expect(tableCellRule()).not.toContain("break-word");
  });
});

describe("cells line up with each other", () => {
  // A table cell defaults to vertical-align:middle. That was barely visible while nothing wrapped,
  // and became obvious the moment everything did: a date floating halfway down beside a two line
  // name, reading as though the columns had come apart. The newsletter and email-audit panels had
  // already set this locally, which is the same tell the nowrap default gave.
  it("start at the top, so a one line value sits level with a wrapped one", () => {
    expect(tableCellRule()).toContain("vertical-align:top");
  });
});

describe("the shared table itself", () => {
  // Wrapping stops a long VALUE widening a table. It does nothing about a table with too many
  // COLUMNS: ten columns of padding and minimum content measured 1243px inside a 1058px card.
  // Fixed layout makes them share the width available rather than demand what they would like.
  it("shares the available width rather than demanding more", () => {
    const start = css.indexOf(".admin-table{");
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf("}", start))).toContain("table-layout:fixed");
  });
});

// THE trap, and it cost two rounds of "still broken". With table-layout:fixed a cell that cannot
// wrap does not widen its column - it paints OVER the next one. "Gift in kind: An Afternoon Tea"
// ran across two neighbours because its column was sized for "£50".
describe("no table cell is stopped from wrapping", () => {
  it("has no nowrap on any admin table cell, however specific the selector", () => {
    const offenders = css
      .split("}")
      .map((b) => b.trim())
      .filter((b) => /white-space:\s*nowrap/.test(b))
      // The visually-hidden header pattern legitimately needs it: the element is clipped to a
      // single pixel and never painted, so it cannot overlap anything.
      .filter((b) => !/clip:\s*rect/.test(b))
      .filter((b) => /-table\b[^{]*(th|td)|td:nth-child|th:nth-child/.test(b));
    expect(offenders).toEqual([]);
  });
});

describe("no admin panel re-introduces nowrap on a table", () => {
  // A per-panel override is how this went unnoticed for so long: each one looked local and
  // reasonable, and together they hid that the default was wrong.
  it("has no rule setting nowrap on admin-table cells", () => {
    const offenders = css
      .split("}")
      .map((block) => block.trim())
      .filter((block) => /admin-table\b[^{]*\{/.test(block) && /white-space:\s*nowrap/.test(block));
    expect(offenders).toEqual([]);
  });
});
