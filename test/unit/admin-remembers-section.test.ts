import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-443: a refresh used to drop you back on the overview. That is maddening halfway through
// working a list — you lose your place and have to navigate back, every single time.

const ROOT = resolve(__dirname, "../..");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

describe("remembering where you were", () => {
  it("records the section every time you move", () => {
    expect(app).toContain("function rememberView(name)");
    // Written inside selectView, so it cannot drift from what is actually on screen: every route
    // into a section goes through there, including the ones that jump programmatically.
    // Get involved: an old tab's name (events, fundraising) becomes the tab's own first, so what is
    // remembered is a section that still has a menu entry. Nothing else comes before it.
    const start = app.slice(app.indexOf("function selectView(name)"), app.indexOf("closeNav(\"chosen\")"));
    expect(start).toMatch(/name = GI_VIEW;\s*\}\s*rememberView\(name\);/);
    expect(start.replace(/\/\/.*$/gm, "")).toMatch(/function selectView\(name\) \{\s*var giSection = null;\s*if \(GI_OLD_VIEWS\[name\]\) \{/);
  });

  it("returns you there on sign-in, rather than always the overview", () => {
    expect(app).toContain("var resume = restorableView();");
    expect(app).toContain('selectView(resume || "overview")');
  });

  // sessionStorage, matching where the session token lives. It survives a refresh, which is the
  // complaint, and dies with the tab, so a shared machine never reopens on somebody else's screen.
  it("keeps it for the tab, not for the device", () => {
    const fn = app.slice(app.indexOf("function rememberView"), app.indexOf("function restorableView"));
    expect(fn).toContain("sessionStorage.setItem");
    expect(fn).not.toContain("localStorage");
  });

  // THE guard. Permissions change. Restoring a viewer onto a section their role no longer reaches
  // would land them on a blank panel with nothing explaining why.
  it("only restores a section this user can still see", () => {
    const fn = app.slice(app.indexOf("function restorableView"), app.indexOf("function selectView"));
    expect(fn).toContain(".admin-nav-link[data-view=");
    expect(fn).toContain("link.hidden");
    expect(fn).toContain("link.offsetParent === null");
  });

  // Storage throws in private mode. Losing your place is an annoyance; an exception here would
  // break navigation outright.
  it("survives storage being unavailable", () => {
    const between = app.slice(app.indexOf("var VIEW_KEY"), app.indexOf("function selectView"));
    expect((between.match(/try \{/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
