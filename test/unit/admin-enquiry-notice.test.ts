import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-425. The notice bar is markup in admin.html joined to behaviour in app.js by nothing but
// matching id strings, which nothing type-checks. Remove or rename one and app.js's el() returns
// null, the code returns early, and the bar simply never appears again: no error, no failing test,
// just enquiries quietly going unanswered exactly as before. Same silent-join risk the Festive
// Ball view is guarded against in admin-ball-layout.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const admin = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appJs = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");

describe("the enquiry notice survives in the markup", () => {
  it.each([["enquiryNotice"], ["enquiryNoticeText"], ["enquiryNoticeGo"]])(
    "admin.html still has #%s, which app.js reaches for",
    (id) => {
      expect(admin).toContain(`id="${id}"`);
      expect(appJs).toContain(`"${id}"`);
    },
  );

  // First child of .admin-content, so it is above whichever view is open rather than buried in
  // one of them. The whole point is that it is seen without going looking.
  it("sits above the views, not inside one", () => {
    const content = admin.indexOf('<div class="admin-content">');
    const notice = admin.indexOf('id="enquiryNotice"');
    const firstView = admin.indexOf('<section class="admin-view"');
    expect(notice).toBeGreaterThan(content);
    expect(notice).toBeLessThan(firstView);
  });

  // Starts hidden, and is only ever revealed when the server says something is waiting. A bar
  // that is always present is furniture, and people stop seeing furniture.
  it("starts hidden", () => {
    const tag = admin.slice(admin.indexOf('id="enquiryNotice"'));
    expect(tag.slice(0, tag.indexOf(">"))).toContain("hidden");
  });

  it("announces itself to screen readers when it appears", () => {
    const tag = admin.slice(admin.indexOf("<div class=\"admin-notice\""));
    const openTag = tag.slice(0, tag.indexOf(">"));
    expect(openTag).toContain('role="status"');
    expect(openTag).toContain('aria-live="polite"');
  });
});

describe("the styles it depends on exist", () => {
  it.each([[".admin-notice{"], [".admin-notice-text{"], [".admin-notice-action{"], [".admin-replied-by{"]])(
    "admin.css defines %s",
    (selector) => {
      expect(css).toContain(selector);
    },
  );

  // [hidden] loses to display:flex without an explicit override, so the bar would be permanently
  // visible and empty. Easy to lose in a refactor, invisible until someone looks at the page.
  it("keeps [hidden] winning over display:flex", () => {
    expect(css).toMatch(/\.admin-notice\[hidden\]\{display:none\}/);
  });

  it("gives the phone target the 44px WCAG asks for", () => {
    const narrow = css.slice(css.indexOf("@media (max-width:760px)"));
    expect(narrow).toMatch(/\.admin-notice-action\{[^}]*min-height:44px/);
  });
});
