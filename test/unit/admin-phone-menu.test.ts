// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// The admin's menu on a phone, in the Donations look (2026-11-12,
// docs/superpowers/specs/2026-11-12-overview-contact-phone-menu-design.md).
//
// Jaimie: the main menu and navigation bars "are all over the place" on a phone. They were: the top
// bar took about 300px of the first screen (the logo, the email, the role, two buttons), and the
// open menu was 27 plain-text links wrapping like a word cloud, none of them looking tappable. Now
// one maroon bar holds the logo and the Menu button, pinned; the open menu is a two-column grid of
// tiles; and who is signed in, My account and Sign out sit at its foot.
//
// Only the phone changes. The banner on a laptop is test/unit/admin-top-banner.test.ts's, untouched.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin-overview.css"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const GiftLog = require(resolve(ROOT, "assets/js/admin/gift-log.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const rulesOnly = css.replace(/\/\*[\s\S]*?\*\//g, "");
/** Where the first `@media (max-width: 860px)` block sits in the stylesheet, braces counted. */
function phoneRange(rules: string): { start: number; end: number; body: string } {
  const start = rules.indexOf("@media (max-width: 860px)");
  expect(start, "a phone block in admin-overview.css").toBeGreaterThan(-1);
  const open = rules.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    if (rules[i] === "}" && --depth === 0) return { start, end: i + 1, body: rules.slice(open + 1, i) };
  }
  throw new Error("unclosed phone block");
}
const range = phoneRange(rulesOnly);
const phone = range.body;
const ruleFor = (block: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\}|,)\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`).exec(block);
  return m ? m[1] : "";
};

const doc = new DOMParser().parseFromString(html, "text/html");

describe("the markup", () => {
  it("puts a small logo in the pinned bar, beside the Menu button", () => {
    const nav = doc.querySelector(".admin-nav")!;
    const brand = nav.querySelector("a.pm-brand");
    expect(brand).not.toBeNull();
    expect(brand!.getAttribute("href")).toBe("/admin");
    expect(brand!.textContent!.trim()).toBe("NBCC Admin");
    expect(nav.querySelector("#adminNavToggle")).not.toBeNull();
  });

  it("gives the menu a foot with who is signed in, My account and Sign out", () => {
    const me = doc.querySelector(".admin-nav .pm-me")!;
    expect(me).not.toBeNull();
    expect(me.querySelector("#pmWho")).not.toBeNull();
    expect(me.querySelector("#pmAccountBtn")!.textContent!.trim()).toBe("My account");
    expect(me.querySelector("#pmLogoutBtn")!.textContent!.trim()).toBe("Sign out");
  });

  // The banner counts its groups and screens; neither addition may be one of them.
  it("adds no group and no screen to the menu, so the banner still counts its own", () => {
    expect(doc.querySelector("#adminNavList .pm-me, #adminNavList .pm-brand")).toBeNull();
    expect(doc.querySelectorAll("#adminNavList > li.admin-nav-group")).toHaveLength(5);
    expect(doc.querySelector(".pm-brand.admin-nav-link, .pm-me .admin-nav-link")).toBeNull();
  });
});

describe("on a phone", () => {
  it("hides the tall top bar, the logo having moved into the pinned one", () => {
    expect(ruleFor(phone, ".admin-topbar")).toMatch(/display:\s*none/);
    expect(ruleFor(phone, ".pm-brand")).toMatch(/display:\s*flex/);
  });

  it("makes the pinned bar maroon, the logo and the Menu button on one line", () => {
    const bar = ruleFor(phone, ".admin-nav");
    expect(bar).toMatch(/background:\s*var\(--ov-maroon\)/);
    expect(bar).toMatch(/display:\s*flex/);
  });

  it("draws the open menu as a two-column grid of tiles", () => {
    expect(ruleFor(phone, ".admin-nav .admin-nav-panel")).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    const tile = ruleFor(phone, ".admin-nav .admin-nav-link");
    expect(tile).toMatch(/border:\s*var\(--ov-line\)/);
    expect(tile).toMatch(/min-height:\s*4[4-9]px/);
  });

  it("presses in the screen you are on, maroon, as a chosen Donations tile is", () => {
    const here = ruleFor(phone, ".admin-nav .admin-nav-link.is-active");
    expect(here).toMatch(/background:\s*var\(--ov-maroon\)/);
    expect(here).toMatch(/translate/);
  });

  // TASK-443: a refresh returns you to your section by finding its link's offsetParent, which
  // display:none would take away. The new look must not undo that.
  it("never hides a closed menu link with display:none", () => {
    expect(phone).not.toMatch(/admin-nav-link[^{]*\{[^}]*display:\s*none/);
    expect(phone).not.toMatch(/admin-nav-panel[^{]*\{[^}]*display:\s*none/);
  });

  it("shows the foot only when the menu is open", () => {
    expect(ruleFor(phone, ".admin-nav:not(.is-open) .pm-me")).toMatch(/display:\s*none/);
  });
});

describe("on a laptop", () => {
  it("hides the logo and the foot, leaving the banner to its own rules", () => {
    expect(rulesOnly).toMatch(/\.pm-brand,\s*\.pm-me\s*\{\s*display:\s*none/);
    // Nothing for the menu or the top bar outside the phone block.
    const outside = rulesOnly.slice(0, range.start) + rulesOnly.slice(range.end);
    expect(outside).not.toMatch(/\.admin-(nav|topbar)[^{]*\{/);
  });
});

describe("the foot's buttons", () => {
  let clicked: string[];
  beforeEach(() => {
    clicked = [];
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (window as unknown as { AdminGiftLog: unknown }).AdminGiftLog = GiftLog.createGiftLog(document, window);
    const token = signAdminSession({ sub: 3, email: "pretend@example.com", role: "editor", now: new Date(), secret: "s" }).token;
    (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown) => {
      const path = String(url).split("?")[0];
      const body =
        path === "/api/admin/login" ? { token, user: { email: "pretend@example.com", role: "editor" } }
        : path === "/api/admin/me" ? { email: "pretend@example.com", permissions: effectivePermissions({ role: "editor", permissions: null }) }
        : { results: [] };
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(""), headers: { get: () => "application/json" } });
    };
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  });
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  async function signIn() {
    (document.getElementById("adminEmail") as HTMLInputElement).value = "pretend@example.com";
    (document.getElementById("adminPassword") as HTMLInputElement).value = "pw";
    document.getElementById("loginForm")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
  }

  it("says who is signed in", async () => {
    await signIn();
    expect(document.getElementById("pmWho")!.textContent).toBe("Signed in as pretend@example.com · editor");
  });

  it("do exactly what the top bar's buttons do, by pressing them", async () => {
    await signIn();
    document.getElementById("accountBtn")!.addEventListener("click", () => clicked.push("account"));
    document.getElementById("logoutBtn")!.addEventListener("click", () => clicked.push("logout"));
    document.getElementById("pmAccountBtn")!.click();
    document.getElementById("pmLogoutBtn")!.click();
    expect(clicked).toEqual(["account", "logout"]);
  });
});
