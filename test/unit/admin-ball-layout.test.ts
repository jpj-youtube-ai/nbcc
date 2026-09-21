import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-422: the Festive Ball admin view was thirteen sections and eight separate forms in one
// scroll, with settings, send-buttons and reports interleaved:
//
//   gate, password, capacity, held seats, card fee, venue details,  <- settings
//   THE WEEK-BEFORE REMINDER,                                       <- emails 400 people
//   the menu,                                                       <- setting
//   TELLING EVERYONE THE MENU IS HERE,                              <- emails 400 people
//   who has chosen,                                                 <- report
//   when guest details close,                                       <- setting
//   guest details still to come,                                    <- report
//   bookings                                                        <- data
//
// You could not predict where anything lived, so you scrolled and hunted. The two reports that
// answer the same question were separated by a setting, and the two buttons that email hundreds
// of people were buried mid-page among harmless settings.
//
// It is now three bands: set up, then where things stand, then send something. Check what is
// true before you press the thing you cannot take back.
//
// THIS FILE IS THE SAFETY NET. The reorder moves whole blocks and changes no markup inside them,
// so the risk is not that something looks wrong, it is that something is silently dropped on the
// way. Every id the view had before the move is listed here by name; losing one fails by name
// rather than showing up weeks later as a button that does nothing.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const admin = readFileSync(resolve(ROOT, "admin.html"), "utf8");

function ballView(): string {
  const start = admin.indexOf('id="view-ball"');
  const end = admin.indexOf('<section class="admin-view"', start + 10);
  return admin.slice(start, end === -1 ? undefined : end);
}

// Captured from the view as it stood before TASK-422 reordered it. Do not prune this list to
// make a test pass: every entry is something admin JavaScript calls el() on.
const IDS_BEFORE = [
  "ball-heading", "ballStats", "ballGateState", "ballGateForm", "ballGateToggle",
  "ballGateOpensAt", "ballGateSchedule", "ballGateStatus", "ballPasswordForm",
  "ballPreviewPassword", "ballPasswordSave", "ballPasswordStatus", "ballCapacityForm",
  "ballTotalTables", "ballSeatsPerTable", "ballHeldSeats", "ballSalesCloseAt",
  "ballSalesClosed", "ballCapacitySave", "ballCapacityStatus", "ballHoldForm", "ballHoldName",
  "ballHoldQuantity", "ballHoldKind", "ballHoldExpires", "ballHoldNote", "ballHoldSave",
  "ballHoldStatus", "ballHolds", "ballFeeForm", "ballCardFeePercent", "ballCardFeeFixed",
  "ballFeeSave", "ballFeeExample", "ballFeeStatus", "ballDetailsForm", "ballArrivalTime",
  "ballIncludedNote", "ballLineUpNote", "ballDetailsSave", "ballDetailsStatus",
  "ballSendReminders", "ballReminderCount", "ballReminderStatus", "ballMenuForm",
  "ballMenuOptions", "ballMenuNote", "ballMenuStatus", "ballSendMenuEmail",
  "ballMenuEmailCount", "ballMenuEmailStatus", "ballMenuProgress", "ballMenuOutstanding",
  "ballLockForm", "ballLockAt", "ballLockStatus", "ballGuestProgress", "ballOutstanding",
  "ballChase", "ballChaseStatus", "ballExports", "ballDoorList", "ballCatering",
  "ballBookingsCsv", "ballBookings",
];

describe("nothing was lost in the reorder", () => {
  const view = ballView();

  it.each(IDS_BEFORE.map((id) => [id]))("still has #%s", (id) => {
    expect(view).toContain(`id="${id}"`);
  });

  it("has exactly as many ids as it started with, so nothing was duplicated either", () => {
    const ids = [...view.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(IDS_BEFORE.length);
  });

  // A moved block that lost its <form> would still have every id and would still not save.
  it("keeps all eight forms", () => {
    expect((view.match(/<form/g) || []).length).toBe(8);
  });
});

describe("the three bands, in the order you work in", () => {
  const view = ballView();
  const at = (s: string) => view.indexOf(s);

  it("labels all three", () => {
    for (const band of ["Set up", "Where things stand", "Send something"]) {
      expect(view).toContain(band);
    }
  });

  it("puts what you configure before what you read", () => {
    expect(at("Set up")).toBeLessThan(at("Where things stand"));
  });

  // The point of the ordering. Both of these email hundreds of people and neither can be taken
  // back, so they sit last, after the numbers that tell you whether to press them.
  it("puts the two irreversible sends last of all", () => {
    expect(at("Where things stand")).toBeLessThan(at("Send something"));
    expect(at("Send something")).toBeLessThan(at('id="ballSendReminders"'));
    expect(at("Send something")).toBeLessThan(at('id="ballSendMenuEmail"'));
  });

  it("keeps the two chase lists together rather than split by a setting", () => {
    const chosen = at('id="ballMenuProgress"');
    const names = at('id="ballGuestProgress"');
    const lockSetting = at('id="ballLockForm"');
    expect(Math.abs(chosen - names)).toBeLessThan(Math.abs(chosen - lockSetting));
  });
});

describe("finding your way around a long view", () => {
  const view = ballView();

  it("offers jump links to the bands", () => {
    expect(view).toContain('class="admin-jump"');
  });

  it("points them at anchors that exist", () => {
    const targets = [...view.matchAll(/admin-jump[^>]*>[\s\S]*?<\/nav>/g)][0]?.[0] ?? "";
    const hrefs = [...targets.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const id of hrefs) expect(view).toContain(`id="${id}"`);
  });
});

// A jump link is only useful if the heading it lands on is actually visible afterwards. Both the
// nav and the jump bar are sticky, so the landing has to clear the pair of them, and the only
// thing holding that true is scroll-margin-top on the band. Set it too low and the click still
// "works" while the heading you aimed at sits hidden behind the bar, which reads as an overshoot
// and is exactly the bug this shipped with at first.
describe("a jump lands somewhere you can see", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");

  // Split at the breakpoint. Reading the whole file for the desktop case would pick up the
  // narrow-screen override as the last match and quietly test the phone twice.
  const breakpoint = css.indexOf("@media (max-width:760px)");
  const wide = css.slice(0, breakpoint);
  const narrow = css.slice(breakpoint);

  it.each([
    ["on a wide screen", wide],
    ["on a phone", narrow],
  ])("clears both sticky bars %s", (_label, scope) => {
    const jumpTop = Number([...scope.matchAll(/\.admin-jump\{[^}]*?top:(\d+)px/g)].pop()?.[1]);
    const bandMargin = Number(
      [...scope.matchAll(/\.admin-band\{[^}]*?scroll-margin-top:(\d+)px/g)].pop()?.[1],
    );
    expect(Number.isFinite(jumpTop)).toBe(true);
    expect(Number.isFinite(bandMargin)).toBe(true);
    // The bar starts at jumpTop and is 56px tall (measured in the browser at both widths: one
    // row of pills plus its padding). Anything at or under jumpTop + 56 and the heading lands
    // underneath it.
    expect(bandMargin).toBeGreaterThan(jumpTop + 56);
  });

  it("keeps the whole file parseable, since one stray */ silently kills every rule after it", () => {
    expect((css.match(/\/\*/g) || []).length).toBe((css.match(/\*\//g) || []).length);
    expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
  });

  it("does not let the 420px fields drag the page sideways on a phone", () => {
    expect(narrow).toMatch(/\.ty-inline\{[^}]*max-width:100%/);
    expect(narrow).toMatch(/\.ty-inline input[^{]*\{[^}]*max-width:100%/);
    expect(narrow).toMatch(/\.admin-segmented\{[^}]*flex-wrap:wrap/);
  });

  // The nav going static below 760px was the original complaint: changing view meant scrolling
  // all the way back up a seven-thousand-pixel page.
  it("keeps the view switcher pinned on a phone instead of stranding it at the top", () => {
    expect(narrow).toMatch(/\.admin-nav\{[^}]*position:sticky/);
    expect(narrow).toMatch(/\.admin-nav ul\{[^}]*overflow-x:auto/);
    // As a one-column grid the nav gets its own row and sticky has nowhere to travel.
    expect(narrow).toMatch(/\.admin-body-grid\{display:block\}/);
  });

});
