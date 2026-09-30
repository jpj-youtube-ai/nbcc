import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-454: the admin fits a phone. At 390px every screen was wider than the phone (535px as
// reported, 556px measured here with a 26-character email address), so a phone zoomed the whole
// admin out to fit it and every word on it shrank.
//
// Two things did it. The top bar was one row that could not wrap: the email, the role badge and both
// buttons came to 459px on their own, and pushed the page past the edge of the screen. And below
// 760px the menu was one line of twenty buttons that scrolled sideways inside its own strip (2247px
// of buttons in 366px), as did the Festive Ball's jump bar. The client's standing rule for this admin
// is that nothing scrolls sideways, inside a box or otherwise: a section you have to swipe to find is
// a section nobody opens.
//
// Measured in a real browser at 390px after the fix: every screen's scrollWidth equals the viewport
// width, and nothing on any screen scrolls sideways (TASK-455 found one box that still did, the list
// of events, and TASK-460 fixed it). These are the rules that make that true, so the next change to
// the shell cannot quietly undo it.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
// Comments explaining the old strip would otherwise read as rules re-introducing it, and spacing
// varies across the file, so rules are compared in one canonical form: no comments, no optional
// whitespace.
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([{};:,>])\s*/g, "$1");

type Rule = { media: string | null; selectors: string[]; body: string };

// Every declaration block in the file, with the media or container query it sits in (null at the
// top level).
function parse(src: string, media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    let depth = 0;
    let end = open;
    for (; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}" && --depth === 0) break;
    }
    // After the last ";" so a statement at-rule (@import, @charset) cannot swallow the rule after it.
    const prelude = src.slice(i, open).split(";").pop()!.trim();
    const body = src.slice(open + 1, end);
    if (/^@(media|supports|container)\b/.test(prelude)) rules.push(...parse(body, prelude));
    else if (!prelude.startsWith("@")) rules.push({ media, selectors: prelude.split(","), body });
    i = end + 1;
  }
  return rules;
}
const RULES = parse(css);
const PHONE = "@media (max-width:860px)";

// The declarations that apply to exactly `selector`, at the top level or inside `media`.
function rule(selector: string, media: string | null = null): string {
  const bodies = RULES.filter((r) => r.media === media && r.selectors.includes(selector)).map((r) => r.body);
  expect(bodies.length, `a rule for ${selector}${media ? " in " + media : ""}`).toBeGreaterThan(0);
  return bodies.join(";");
}

describe("the top bar wraps, rather than pushing the page wider than the screen", () => {
  it("lets the brand and the signed-in details share rows as the screen narrows", () => {
    expect(rule(".admin-topbar")).toContain("flex-wrap:wrap");
  });

  it("wraps who is signed in, and the two buttons, as groups that can each shrink", () => {
    for (const group of [".admin-user", ".admin-user-who", ".admin-user-actions"]) {
      expect(rule(group), group).toContain("flex-wrap:wrap");
      expect(rule(group), group).toContain("min-width:0");
    }
  });

  // Grouped, so a narrow screen breaks between the email and the buttons, never leaving "Sign out"
  // on a line of its own because this particular email happened to be the length that did that.
  it("keeps the email with its role and the buttons together, in the markup", () => {
    const who = html.match(/<span class="admin-user-who">([\s\S]*?)<\/span>\s*<span class="admin-user-actions">([\s\S]*?)<\/span>/);
    expect(who, "the who and actions groups, in that order").not.toBeNull();
    expect(who![1]).toContain('id="userEmail"');
    expect(who![1]).toContain('id="userRole"');
    expect(who![2]).toContain('id="accountBtn"');
    expect(who![2]).toContain('id="logoutBtn"');
  });

  // `anywhere`, not `break-word`, for the reason TASK-442 found in the tables: only `anywhere` counts
  // the break when the browser works out the smallest the element can be, so only `anywhere` stops a
  // long address setting the width of the whole bar.
  it("breaks a long email address instead of letting it set the width", () => {
    expect(rule(".admin-user-email")).toContain("overflow-wrap:anywhere");
    expect(rule(".admin-user-email")).toContain("min-width:0");
  });
});

describe("below 860px the menu stops being a column beside the content", () => {
  it("stacks the menu above the content", () => {
    expect(rule(".admin-body-grid", PHONE)).toContain("display:block");
  });

  // Pinned, because the complaint that made it pinned in the first place still stands: changing
  // section should never mean scrolling back up a long page to find the menu.
  it("keeps the menu within reach, as one pinned button that opens the whole list", () => {
    expect(rule(".admin-nav-toggle")).toContain("display:none");
    expect(rule(".admin-nav-toggle", PHONE)).toContain("display:flex");
    expect(rule(".admin-nav", PHONE)).toContain("position:sticky");
    // The top bar would otherwise pin itself over the menu.
    expect(rule(".admin-topbar", PHONE)).toContain("position:static");
  });

  it("wraps the open list into its groups, rather than one row that scrolls", () => {
    expect(rule(".admin-nav ul", PHONE)).toContain("flex-wrap:wrap");
    expect(rule(".admin-nav-group", PHONE)).toContain("flex-basis:100%");
  });

  // A pinned list taller than the screen cannot be scrolled to its end, and giving it a scrollbar of
  // its own would be the scrolling box the client has ruled out. Open, it takes its place in the page
  // like everything else.
  it("puts the open list in the page, so however long it is nothing scrolls inside it", () => {
    expect(rule(".admin-nav.is-open", PHONE)).toContain("position:static");
  });

  // THE trap. TASK-443's restorableView treats a menu link with no offsetParent as a section your
  // permissions hide, and display:none gives every link inside it no offsetParent. Closed that way,
  // the menu would make every section look forbidden, and a refresh on a phone would always land on
  // the Overview instead of where you were.
  it("hides the closed list without display:none, so a refresh still returns you to your section", () => {
    const closed = rule(".admin-nav:not(.is-open) ul", PHONE);
    expect(closed).toContain("visibility:hidden");
    expect(closed).not.toContain("display:none");
  });

  // WCAG 2.5.5, the size this file already holds its other phone controls to.
  it("gives every control in the menu a target a thumb can hit", () => {
    expect(rule(".admin-nav-toggle", PHONE)).toContain("min-height:44px");
    expect(rule(".admin-nav-link", PHONE)).toContain("min-height:44px");
  });

  it("wires the button to the list it opens", () => {
    const toggle = html.match(/<button[^>]*id="adminNavToggle"[^>]*>/);
    expect(toggle, "the menu button").not.toBeNull();
    expect(toggle![0]).toContain('aria-expanded="false"');
    expect(toggle![0]).toContain('aria-controls="adminNavList"');
    expect(html).toMatch(/<ul[^>]*\bid="adminNavList"/);
  });
});

// app.js closes the menu when the screen widens past it (a phone or tablet turned on its side), so it
// has to be listening at the same width the CSS turns the menu into a button. Where the menu leaves
// you as it opens and closes is behaviour, and admin-app.test.ts drives the real app.js through it.
describe("app.js and admin.css agree on where the phone menu starts", () => {
  const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

  it("listens at the same breakpoint the stylesheet uses", () => {
    expect(RULES.some((r) => r.media === PHONE)).toBe(true);
    expect(app).toContain('matchMedia("(max-width:860px)")');
  });
});

describe("nothing in the menu or the jump bar scrolls sideways", () => {
  it("has no rule, at any width, that lines them up in a row wider than the screen", () => {
    const offenders = RULES.filter((r) => r.selectors.some((s) => /admin-nav|admin-jump/.test(s)))
      // overflow as well as overflow-x: the shorthand makes a scroller just the same. The closed
      // list's overflow:hidden is a collapse, not a scroller, and is not matched.
      .filter((r) => /overflow(-x)?:(auto|scroll)|white-space:nowrap|flex-wrap:nowrap/.test(r.body))
      .map((r) => `${r.media ?? ""} ${r.selectors.join(",")}{${r.body}}`);
    expect(offenders).toEqual([]);
  });
});

// TASK-455: the one screen TASK-454 left too wide. The Events page switch (TASK-453) was flex:none,
// so it kept its whole label on one line: at 320px, 302px of "Put the page on the website" in a
// card with 246px to give it, and 317px once the page is on and it reads "Take the page off the
// website". The Events screen scrolled sideways on the smallest phones, by 34px when the page was
// on. Wherever the label already fits on one line, a tablet or a desktop, nothing may change.
describe("the Events page switch fits the smallest phones", () => {
  it("lets the button shrink to its card and wrap its label, rather than push past the edge", () => {
    const button = rule("#view-events .ev-switch .btn");
    expect(button).toContain("flex:0 1 auto");
    expect(button).toContain("max-width:100%");
  });

  // What keeps a tablet or a desktop exactly as it was: in a row that wraps, the button shares a
  // line with the words only when both fit, so it shrinks only when it is alone and too wide.
  it("keeps the switch a row that wraps, so the button shrinks only on a line of its own", () => {
    expect(rule("#view-events .ev-switch")).toContain("flex-wrap:wrap");
  });

  // A later rule, or one for a narrower screen, could quietly hold it to one line again.
  it("has no rule, at any width, that stops the button shrinking or its label wrapping", () => {
    const offenders = RULES.filter((r) => r.selectors.some((s) => /ev-switch|evSwitchBtn/.test(s)))
      .filter((r) => /flex:(none|0 0)|flex-shrink:0|white-space:(nowrap|pre)|max-width:none|min-width:(max-content|fit-content)/.test(r.body))
      .map((r) => `${r.media ?? ""} ${r.selectors.join(",")}{${r.body}}`);
    expect(offenders).toEqual([]);
  });
});

// TASK-460: the Events list is a five-column table that needs about 850px. Wherever the list is
// narrower (phones, most tablets, and laptops up to about 1150px, where the side menu takes 210px)
// its buttons broke their own labels ("Ed / it"), times broke mid-word, the day and time ran into
// the event's name, and on a phone the list scrolled sideways inside its box. There, each event is
// now a compact row instead. The switch is measured on the list's own width, because that is what
// runs out. It depends on the side menu, the page's padding, its 1280px cap and the scrollbar, so a
// screen width standing in for it (about 1190px today) would drift whenever any of those changed.
describe("the Events list becomes compact rows wherever its table does not fit", () => {
  const NARROW = "@container evlist (max-width:899px)";

  it("measures the list itself, so the side menu's squeeze counts as well as a small screen", () => {
    expect(rule("#view-events #evList")).toContain("container:evlist / inline-size");
    expect(RULES.some((r) => r.media === NARROW)).toBe(true);
  });

  it("stops laying the events out as a table, one row per event", () => {
    expect(rule("#view-events .ev-admin-table", NARROW)).toContain("display:block");
    expect(rule("#view-events .ev-admin-table tbody", NARROW)).toContain("display:block");
    expect(rule("#view-events .ev-admin-table tr", NARROW)).toContain("display:grid");
    expect(rule("#view-events .ev-admin-table td", NARROW)).toContain("display:block");
  });

  // Top to bottom, like a diary entry: the date and time, the event, who runs it, then where it
  // stands and the button, sharing the last line.
  it("reads each event top to bottom, with its status and button on the last line", () => {
    expect(rule("#view-events .ev-admin-table tr", NARROW)).toContain(
      'grid-template-areas:"when when" "event event" "run run" "state open"',
    );
    ["when", "event", "run", "state", "open"].forEach((area, i) => {
      expect(rule(`#view-events .ev-admin-table td:nth-child(${i + 1})`, NARROW), area).toContain(`grid-area:${area}`);
    });
  });

  // Without its column heading, "NBCC" on its own could be anything.
  it("says who runs it in words, since the column heading is out of sight", () => {
    expect(rule("#view-events .ev-admin-table td:nth-child(3)::before", NARROW)).toContain('content:"Run by "');
  });

  // Hidden the way the house stacks hide theirs: out of sight, but still read out, so a screen
  // reader keeps the headings.
  it("keeps the headings for screen readers rather than removing them", () => {
    const head = rule("#view-events .ev-admin-table thead", NARROW);
    expect(head).toContain("clip:rect(0 0 0 0)");
    expect(head).not.toContain("display:none");
  });

  // A value that cannot wrap would push a compact row wider than its list: the fault this replaces.
  it("has no rule in the list, at any width, that stops its words wrapping", () => {
    const offenders = RULES.filter((r) => r.selectors.some((s) => /ev-admin|evList/.test(s)))
      .filter((r) => /white-space:(nowrap|pre)/.test(r.body))
      .map((r) => `${r.media ?? ""} ${r.selectors.join(",")}{${r.body}}`);
    expect(offenders).toEqual([]);
  });

  // A later rule could undo the compact rows while every rule above still exists: a row put back to
  // table-row, or a column width that outranks the cells' width:auto (the trap .ty-sent-table's
  // comment describes). Only the compact rows may say how the list's rows and cells lay out.
  it("lets no other rule, at any width, change how the list's rows and cells lay out", () => {
    const layout = RULES.filter((r) => r.selectors.some((s) => /\.ev-admin-table (tbody|tr|td)/.test(s)));
    const offenders = [
      ...layout.filter((r) => r.media !== NARROW && /(^|;)display:/.test(r.body)),
      ...layout.filter((r) => r.selectors.some((s) => /\.ev-admin-table[^,]*\btd\b/.test(s)) && /(^|;)width:(?!auto)/.test(r.body)),
    ].map((r) => `${r.media ?? ""} ${r.selectors.join(",")}{${r.body}}`);
    expect(offenders).toEqual([]);
  });

  // The rows place each cell by its position and write "Run by " before the third, so they are only
  // right while the table keeps these columns in this order. A new or moved column moves them too.
  it("depends on the columns app.js draws, in the order it draws them", () => {
    const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
    expect(app).toContain("<th>Date</th><th>Event</th><th>Run by</th><th>Website</th><th>");
  });

  // WCAG 2.5.5, the size this file already holds the admin's other phone controls to.
  it("gives each event's button a target a thumb can hit", () => {
    expect(rule("#view-events .ev-admin-table .ev-admin-edit", NARROW)).toContain("min-height:44px");
  });
});
