// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// The bar along the bottom of the admin on a phone (2026-11-12,
// docs/superpowers/specs/2026-11-12-overview-contact-phone-menu-design.md). Five tabs, each an icon
// and a word: Overview, Donations, Get involved, Contact and Everything, which opens the whole menu.
// Each tab copies its menu link: there only if the link is, a dot when the link has a New pill, and
// marked when the link is the screen you are on. So it can never offer a screen the menu would not.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin-overview.css"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const GiftLog = require(resolve(ROOT, "assets/js/admin/gift-log.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const rulesOnly = css.replace(/\/\*[\s\S]*?\*\//g, "");
// Every `@media (max-width: 860px)` block in the stylesheet, braces counted.
function phoneBlocks(rules: string): string {
  let out = "";
  let at = rules.indexOf("@media (max-width: 860px)");
  while (at > -1) {
    const open = rules.indexOf("{", at);
    let depth = 0;
    let i = open;
    for (; i < rules.length; i++) {
      if (rules[i] === "{") depth++;
      if (rules[i] === "}" && --depth === 0) break;
    }
    out += rules.slice(open + 1, i) + "\n";
    at = rules.indexOf("@media (max-width: 860px)", i);
  }
  return out;
}
const phone = phoneBlocks(rulesOnly);

const doc = new DOMParser().parseFromString(html, "text/html");

describe("the markup", () => {
  it("offers Overview, Donations, Get involved, Contact and Everything, in that order", () => {
    const tabs = [...doc.querySelectorAll(".pm-bar .pm-tab")];
    // Each tab's word; its ", new" for a screen reader is hidden until there is something new.
    expect(tabs.map((t) => t.querySelector(".pm-tab__word")!.textContent)).toEqual(["Overview", "Donations", "Get involved", "Contact", "Everything"]);
    expect(tabs.map((t) => t.getAttribute("data-pm-view"))).toEqual(["overview", "donations", "get-involved", "contact", null]);
    expect(doc.querySelector(".pm-bar")!.getAttribute("aria-label")).toBe("Quick links");
  });

  it("names a screen the menu has, for each of its first four tabs", () => {
    for (const t of doc.querySelectorAll(".pm-bar [data-pm-view]")) {
      expect(doc.querySelector(`#adminNavList .admin-nav-link[data-view="${t.getAttribute("data-pm-view")}"]`)).not.toBeNull();
    }
  });

  it("is not a menu link, so the menu still counts its own screens", () => {
    expect(doc.querySelector(".pm-bar .admin-nav-link, .pm-bar [data-view]")).toBeNull();
  });

  // Inside the signed-in app, so the sign-in screen never shows it.
  it("sits inside the signed-in app", () => {
    expect(doc.querySelector("#appView .pm-bar")).not.toBeNull();
  });

  it("draws its icons for the eye only", () => {
    for (const svg of doc.querySelectorAll(".pm-bar svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("its styles", () => {
  it("shows only on a phone", () => {
    expect(rulesOnly).toMatch(/(?:^|\})\s*\.pm-bar\s*\{[^}]*display:\s*none/);
    expect(phone).toMatch(/\.pm-bar\s*\{[^}]*display:\s*grid/);
    expect(phone).toMatch(/\.pm-bar\s*\{[^}]*position:\s*fixed/);
    // The tabs share the width, however many this person has.
    expect(phone).toMatch(/\.pm-bar\s*\{[^}]*grid-auto-flow:\s*column/);
    expect(phone).toMatch(/\.pm-tab\[hidden\]\s*\{\s*display:\s*none/);
  });

  it("leaves room so it never covers the last thing on a page", () => {
    expect(phone).toMatch(/\.admin-app\s*\{[^}]*padding-bottom/);
  });

  it("keeps clear of the iPhone's home bar", () => {
    expect(phone).toMatch(/\.pm-bar\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  });
});

describe("in use", () => {
  let perms: Record<string, unknown>;
  let fresh: string[];
  beforeEach(() => {
    window.sessionStorage.clear();
    window.scrollTo = () => {};
    perms = effectivePermissions({ role: "editor", permissions: null }) as unknown as Record<string, unknown>;
    fresh = [];
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (window as unknown as { AdminGiftLog: unknown }).AdminGiftLog = GiftLog.createGiftLog(document, window);
    const token = signAdminSession({ sub: 3, email: "pretend@example.com", role: "editor", now: new Date(), secret: "s" }).token;
    (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown) => {
      const path = String(url).split("?")[0];
      const body =
        path === "/api/admin/login" ? { token, user: { email: "pretend@example.com", role: "editor" } }
        : path === "/api/admin/me" ? { email: "pretend@example.com", permissions: perms }
        : path === "/api/admin/whats-new" ? { areas: fresh.map((area) => ({ area, new: true, since: "2026-11-01T00:00:00.000Z" })) }
        : { results: [] };
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(""), headers: { get: () => "application/json" } });
    };
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  });
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  const tab = (view: string) => document.querySelector(`.pm-bar [data-pm-view="${view}"]`) as HTMLButtonElement;
  const everything = () => document.querySelector(".pm-bar .pm-tab:not([data-pm-view])") as HTMLButtonElement;
  async function signIn() {
    (document.getElementById("adminEmail") as HTMLInputElement).value = "pretend@example.com";
    (document.getElementById("adminPassword") as HTMLInputElement).value = "pw";
    document.getElementById("loginForm")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
  }

  it("marks the Overview as where you are, once signed in", async () => {
    await signIn();
    expect(tab("overview").getAttribute("aria-current")).toBe("page");
    expect(tab("donations").hasAttribute("aria-current")).toBe(false);
  });

  it("opens a screen, the way its menu link does, and marks it", async () => {
    await signIn();
    tab("contact").click();
    await settle();
    expect(document.getElementById("view-contact")!.hidden).toBe(false);
    expect(document.querySelector('.admin-nav-link[data-view="contact"]')!.classList.contains("is-active")).toBe(true);
    expect(tab("contact").getAttribute("aria-current")).toBe("page");
    expect(tab("overview").hasAttribute("aria-current")).toBe(false);
  });

  it("hides a tab whose screen this person may not open", async () => {
    perms = { ...perms, donations: "none", contact: "none" };
    await signIn();
    expect(tab("donations").hidden).toBe(true);
    expect(tab("contact").hidden).toBe(true);
    expect(tab("overview").hidden).toBe(false);
    expect(everything().hidden).toBe(false);
  });

  it("shows Get involved to someone who may see either of its sections", async () => {
    perms = { ...perms, fundraising: "none", events: "view" };
    await signIn();
    expect(tab("get-involved").hidden).toBe(false);
    perms = { ...perms, fundraising: "none", events: "none" };
    document.getElementById("logoutBtn")!.click();
    await settle();
    await signIn();
    expect(tab("get-involved").hidden).toBe(true);
  });

  it("shows a dot on a tab whose screen is new, and says so in words", async () => {
    fresh = ["donations", "events"];
    await signIn();
    expect(tab("donations").classList.contains("pm-tab--new")).toBe(true);
    expect(tab("get-involved").classList.contains("pm-tab--new")).toBe(true);
    expect(tab("contact").classList.contains("pm-tab--new")).toBe(false);
    expect((tab("donations").querySelector(".pm-tab__new") as HTMLElement).hidden).toBe(false);
    expect((tab("contact").querySelector(".pm-tab__new") as HTMLElement).hidden).toBe(true);
  });

  it("loses its dot when you open that screen, as the menu's pill does", async () => {
    fresh = ["donations"];
    await signIn();
    fresh = [];
    tab("donations").click();
    await settle();
    expect(tab("donations").classList.contains("pm-tab--new")).toBe(false);
  });

  // A donor, a story or a business is not one of the menu's screens, so nothing is marked.
  it("marks nothing when a detail screen opens, as the menu marks nothing", async () => {
    await signIn();
    document.getElementById("overviewRecent")!.insertAdjacentHTML("beforeend", '<button type="button" id="pretendGift" data-donor="5">A gift</button>');
    document.getElementById("pretendGift")!.click();
    await settle();
    expect(document.getElementById("view-donor")!.hidden).toBe(false);
    expect(document.querySelector('.pm-bar [aria-current="page"]')).toBeNull();
  });

  it("takes you to the first screen in the menu when Everything opens it", async () => {
    await signIn();
    everything().click();
    expect(document.activeElement).toBe(document.querySelector('#adminNavList .admin-nav-link[data-view="overview"]'));
  });

  it("opens the whole menu from Everything, and closes it again", async () => {
    await signIn();
    const nav = document.querySelector(".admin-nav")!;
    everything().click();
    expect(nav.classList.contains("is-open")).toBe(true);
    expect(everything().getAttribute("aria-expanded")).toBe("true");
    everything().click();
    expect(nav.classList.contains("is-open")).toBe(false);
    expect(everything().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the menu when a tab opens a screen", async () => {
    await signIn();
    everything().click();
    tab("donations").click();
    await settle();
    expect(document.querySelector(".admin-nav")!.classList.contains("is-open")).toBe(false);
    expect(everything().getAttribute("aria-expanded")).toBe("false");
  });
});
