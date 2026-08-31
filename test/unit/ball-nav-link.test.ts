import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { addBallNavLink, BALL_NAV_ITEM } from "../../src/ball/nav-link";

// TASK-326: the nav must say the same thing on every page, before and after launch.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const navOf = (html: string) => html.match(/<ul[^>]*class="nav-links"[\s\S]*?<\/ul>/i)?.[0] ?? "";
const footerOf = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/i)?.[0] ?? "";

const PAGES = [
  "index.html", "about.html", "donate.html", "contact.html", "supporters.html",
  "ball.html", "ball-terms.html", "my-story.html", "privacy.html", "gift-aid.html",
  "thank-you.html", "portal.html", "business-thank-you.html",
];

describe("adding the ball link to a page's nav", () => {
  it.each(PAGES)("puts it in the NAV on %s", (page) => {
    const out = addBallNavLink(read(page));
    expect(navOf(out)).toContain('href="/ball"');
  });

  // The whole reason this matches the LIST and not a link inside it. supporters.html's own nav
  // item carries class="active", so matching `<li><a href="/supporters">…` finds the FOOTER's
  // copy first and quietly puts the ball link there instead.
  it("never puts it in the footer, even on supporters.html where the nav item is active", () => {
    for (const page of PAGES) {
      const out = addBallNavLink(read(page));
      const explore = footerOf(out);
      expect(explore.includes('href="/ball"'), `${page} put the link in the footer`).toBe(false);
    }
  });

  it("adds exactly one, however many times it runs", () => {
    const once = addBallNavLink(read("about.html"));
    const twice = addBallNavLink(once);
    expect(twice).toBe(once);
    expect(once.split(BALL_NAV_ITEM).length - 1).toBe(1);
  });

  // hub.html and set-password.html have no site nav at all.
  it("leaves a page with no nav completely untouched", () => {
    const hub = read("hub.html");
    expect(addBallNavLink(hub)).toBe(hub);
  });

  it("is not fooled by /ball links elsewhere on the page", () => {
    // ball.html already links to /ball/terms in its own body copy.
    const out = addBallNavLink(read("ball.html"));
    expect(navOf(out)).toContain('href="/ball"');
  });

  it("changes nothing but the nav", () => {
    const before = read("about.html");
    const after = addBallNavLink(before);
    expect(after.replace(navOf(after), "")).toBe(before.replace(navOf(before), ""));
  });
});
