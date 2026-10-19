// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Jaimie, 19 October 2026: the admin's side menu becomes "a banner across the top that has drop downs
// for each of the sections", New on the banner for a group and beside the screen inside it, so the
// content gets the width back and nobody scrolls to reach a menu. Wider than 860px only: the phone
// menu (TASK-454) is untouched, and admin-fits-a-phone.test.ts still pins it. Every name is invented.

// Each test loads the whole admin page afresh in jsdom, which is slow under a full parallel run.
vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

// Every screen's link as it was before the banner: [data-view, its gate, its words]. The banner only
// regroups them; none may change, go or be added (a link is the screen's whole way in, and its gate
// is what hides it from someone who may not see it).
const BEFORE: ReadonlyArray<readonly [string, string, string]> = [
  ["overview", "", "Overview"],
  ["search", "", "Search"],
  ["donations", "", "Donations"],
  ["red-bag", "", "Fill a Red Bag"],
  ["claims", "", "Claims"],
  ["gasds", "", "GASDS"],
  ["subscriptions", "", "Subscriptions"],
  ["fulfilments", "edit:business-supporters", "Business supporters"],
  ["monthly", "view:donations", "Monthly givers"],
  ["stories", "", "Stories"],
  ["ticker", "", "Partners"],
  ["get-involved", "any:events fundraising", "Get involved"],
  ["ball", "", "Festive Ball"],
  ["contact", "", "Contact form"],
  ["newsletter", "", "Newsletter"],
  ["thank-you", "", "Thank you"],
  ["outreach", "", "Contact businesses"],
  ["audit", "", "Audit"],
  ["email-audit", "", "Email audit"],
  ["analytics", "", "Analytics"],
  ["site", "", "Site pages"],
  ["qr", "view:site", "QR codes"],
  ["team", "", "Team"],
];
const GROUPS: ReadonlyArray<readonly [string, string, string, readonly string[]]> = [
  ["monitor", "Monitor", "adminNavMonitor", ["overview", "search"]],
  ["giving", "Giving", "adminNavGiving", ["donations", "red-bag", "claims", "gasds", "subscriptions", "fulfilments", "monthly"]],
  ["content", "Content", "adminNavContent", ["stories", "ticker", "get-involved", "ball", "contact", "newsletter", "thank-you", "outreach"]],
  ["governance", "Governance", "adminNavGovernance", ["audit", "email-audit"]],
  ["admin", "Admin", "adminNavAdmin", ["analytics", "site", "qr", "team"]],
];

function markup(): Document {
  return new DOMParser().parseFromString(html, "text/html");
}
function gateOf(b: Element): string {
  const edit = b.getAttribute("data-edit-gate");
  const view = b.getAttribute("data-view-gate");
  const any = b.getAttribute("data-view-gate-any");
  return edit ? "edit:" + edit : view ? "view:" + view : any ? "any:" + any : "";
}

describe("the markup: the same screens, in five groups", () => {
  it("keeps every screen's link, with its gate, its words and its order", () => {
    const links = Array.from(markup().querySelectorAll("#adminNavList .admin-nav-link"));
    expect(links.map((b) => [b.getAttribute("data-view"), gateOf(b), (b.textContent || "").trim()])).toEqual(BEFORE);
    for (const b of links) expect(b.getAttribute("type")).toBe("button");
  });

  it("groups them in five, in order, each under a label and a head that opens its own list", () => {
    const doc = markup();
    const groups = Array.from(doc.querySelectorAll("#adminNavList > li.admin-nav-group"));
    expect(groups.map((g) => g.getAttribute("data-nav-group"))).toEqual(GROUPS.map((g) => g[0]));
    groups.forEach((g, i) => {
      const [, name, panelId, views] = GROUPS[i];
      const label = g.querySelector(":scope > .admin-nav-grouplabel")!;
      const head = g.querySelector(":scope > button.admin-nav-grouphead")!;
      const panel = g.querySelector(":scope > ul.admin-nav-panel")!;
      expect(label.textContent!.trim()).toBe(name);
      // The label is the phone menu's, and only there to the eye: the head says it to a screen reader.
      expect(label.getAttribute("aria-hidden")).toBe("true");
      expect(head.textContent!.trim()).toBe(name);
      expect(head.getAttribute("type")).toBe("button");
      expect(head.getAttribute("aria-expanded")).toBe("false");
      expect(head.getAttribute("aria-controls")).toBe(panelId);
      expect(panel.id).toBe(panelId);
      expect(Array.from(panel.querySelectorAll(".admin-nav-link")).map((b) => b.getAttribute("data-view"))).toEqual(views);
    });
  });

  it("keeps the phone's Menu button and list, and the Admin group's id", () => {
    const doc = markup();
    expect(doc.getElementById("adminNavToggle")!.getAttribute("aria-controls")).toBe("adminNavList");
    expect(doc.getElementById("adminNavList")!.tagName).toBe("UL");
    expect(doc.getElementById("teamNavGroup")!.getAttribute("data-nav-group")).toBe("admin");
  });
});

// ---- The script, driven in jsdom ----
const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;
let perms: PermissionMap = {};
let whatsNew: unknown[] = [];
let hoverMouse = false;

function respond(path: string) {
  const j = (payload: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: whatsNew });
  if (path === "/api/admin/overview") return j({ needs: [], failed: [], numbers: [], coming: [] });
  return j({ results: [] });
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const group = (key: string) => document.querySelector(`#adminNavList [data-nav-group="${key}"]`) as HTMLElement;
const head = (key: string) => group(key).querySelector(".admin-nav-grouphead") as HTMLElement;
const link = (view: string) => document.querySelector(`.admin-nav-link[data-view="${view}"]`) as HTMLElement;
const isOpen = (key: string) => group(key).classList.contains("is-open");
const openGroups = () =>
  Array.from(document.querySelectorAll("#adminNavList .admin-nav-group.is-open")).map((g) => g.getAttribute("data-nav-group"));

function boot() {
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => false;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  // A mouse can hover; a finger cannot. The script asks once, for the banner's hover.
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
    matches: /hover/.test(q) ? hoverMouse : false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown) => Promise.resolve(respond(String(url).split("?")[0]));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
}
async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
const key = (target: HTMLElement, k: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  whatsNew = [];
  hoverMouse = false;
  window.sessionStorage.clear();
  boot();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a group shows while any screen in it does", () => {
  it("hides a group none of whose screens this person may see", async () => {
    perms = { ...effectivePermissions({ role: "viewer", permissions: null }), analytics: "none", site: "none", team: "none" };
    await signIn();
    expect(link("analytics").hidden).toBe(true);
    expect(link("site").hidden).toBe(true);
    expect(link("team").hidden).toBe(true);
    expect(group("admin").hidden).toBe(true);
    expect(group("monitor").hidden).toBe(false);
  });

  it("shows it, with only those screens, for someone who may see one of them", async () => {
    perms = { ...effectivePermissions({ role: "viewer", permissions: null }), analytics: "none", site: "view", team: "none" };
    await signIn();
    expect(group("admin").hidden).toBe(false);
    expect(link("site").hidden).toBe(false);
    expect(link("qr").hidden).toBe(false);
    expect(link("team").hidden).toBe(true);
  });
});

describe("New on the banner", () => {
  it("is on a group's head when a screen in it is new, and beside that screen inside", async () => {
    whatsNew = [{ area: "contact", new: true, since: "2026-10-01T00:00:00.000Z" }];
    await signIn();
    await settle();
    expect(head("content").querySelector(".admin-new-pill")).not.toBeNull();
    // Read aloud as "Content, New", as each screen's is.
    expect(head("content").textContent).toBe("Content, New");
    expect(link("contact").querySelector(".admin-new-pill")).not.toBeNull();
    expect(head("giving").querySelector(".admin-new-pill")).toBeNull();
  });

  it("goes from the head when its screen is opened", async () => {
    whatsNew = [{ area: "contact", new: true, since: "2026-10-01T00:00:00.000Z" }];
    await signIn();
    await settle();
    link("contact").click();
    await settle();
    expect(head("content").querySelector(".admin-new-pill")).toBeNull();
  });
});

describe("the drop downs", () => {
  it("opens one on a click, closes any other, and closes it on a second click", async () => {
    await signIn();
    head("giving").click();
    expect(openGroups()).toEqual(["giving"]);
    expect(head("giving").getAttribute("aria-expanded")).toBe("true");
    head("content").click();
    expect(openGroups()).toEqual(["content"]);
    expect(head("giving").getAttribute("aria-expanded")).toBe("false");
    head("content").click();
    expect(openGroups()).toEqual([]);
    expect(head("content").getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when a screen in it is chosen, and shows that screen", async () => {
    await signIn();
    head("giving").click();
    link("claims").click();
    await settle();
    expect(openGroups()).toEqual([]);
    expect(el("view-claims").hidden).toBe(false);
  });

  it("closes on Escape and puts the keyboard back on its head", async () => {
    await signIn();
    head("content").click();
    link("ball").focus();
    key(link("ball"), "Escape");
    expect(isOpen("content")).toBe(false);
    expect(document.activeElement).toBe(head("content"));
  });

  it("closes on a click anywhere else", async () => {
    await signIn();
    head("admin").click();
    el("view-overview").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(openGroups()).toEqual([]);
  });

  it("closes when the keyboard moves on out of it", async () => {
    await signIn();
    head("governance").click();
    link("audit").focus();
    el("logoutBtn").focus();
    expect(isOpen("governance")).toBe(false);
  });

  it("opens from its head with the down arrow, on its first screen", async () => {
    await signIn();
    head("giving").focus();
    key(head("giving"), "ArrowDown");
    expect(isOpen("giving")).toBe(true);
    expect(document.activeElement).toBe(link("donations"));
  });

  it("opens to a mouse that hovers, closes a moment after it leaves, and one at a time", async () => {
    hoverMouse = true;
    boot();
    await signIn();
    group("giving").dispatchEvent(new MouseEvent("mouseenter"));
    expect(openGroups()).toEqual(["giving"]);
    // Crossing to the next head: that one opens and the first closes at once.
    group("content").dispatchEvent(new MouseEvent("mouseenter"));
    expect(openGroups()).toEqual(["content"]);
    group("content").dispatchEvent(new MouseEvent("mouseleave"));
    expect(isOpen("content")).toBe(true);
    await new Promise((r) => setTimeout(r, 260));
    expect(isOpen("content")).toBe(false);
  });

  it("stays open when a mouse that opened it by hovering then clicks its head", async () => {
    hoverMouse = true;
    boot();
    await signIn();
    group("admin").dispatchEvent(new MouseEvent("mouseenter"));
    head("admin").click();
    expect(isOpen("admin")).toBe(true);
    group("admin").dispatchEvent(new MouseEvent("mouseleave"));
    await new Promise((r) => setTimeout(r, 260));
    expect(isOpen("admin")).toBe(true);
  });

  // Narrowed to a phone's width, the heads are hidden: nothing may be left open behind them. One
  // listener for that width, the phone menu's, does both jobs (a second would be a second answer).
  it("closes when the screen narrows to a phone's width, through the phone menu's one listener", async () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
      matches: false,
      media: q,
      addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => {
        if (q === "(max-width:860px)") listeners.push(fn);
      },
    });
    document.body.innerHTML = bodyHtml;
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
    await signIn();
    expect(listeners).toHaveLength(1);
    head("content").click();
    expect(isOpen("content")).toBe(true);
    listeners[0]({ matches: true });
    expect(openGroups()).toEqual([]);
  });

  it("does not open to a finger's hover, which is a tap, so a tap opens it and a second tap closes it", async () => {
    hoverMouse = false;
    await signIn();
    group("giving").dispatchEvent(new MouseEvent("mouseenter"));
    expect(openGroups()).toEqual([]);
    head("giving").click();
    expect(isOpen("giving")).toBe(true);
    head("giving").click();
    expect(isOpen("giving")).toBe(false);
  });
});

describe("the stylesheet", () => {
  const WIDE = "@media (min-width:861px)";
  const wide = () => {
    const at = css.indexOf(WIDE);
    return at === -1 ? "" : css.slice(at, css.indexOf("\n}", at));
  };
  const phone = () => {
    const at = css.indexOf("@media (max-width:860px)");
    return css.slice(at, css.indexOf("\n}", at));
  };

  it("has one block for the banner, wider than a phone", () => {
    expect(css.indexOf(WIDE)).toBeGreaterThan(-1);
  });

  // The banner is the one pinned bar, the height the top bar was, so everything already pinned under
  // 60px (the Festive Ball's sections, the newsletter's composer bar) fits under it as it was.
  it("pins the banner at the top, 60px tall, and lets the top bar scroll away", () => {
    expect(css).toMatch(/\n\.admin-topbar\{(?![^}]*position:sticky)[^}]*\}/);
    expect(wide()).toMatch(/\.admin-nav\{[^}]*position:sticky[^}]*top:0/);
    expect(wide()).toMatch(/#adminNavList\{[^}]*min-height:59px/);
  });

  it("gives the content the width the side menu had, up to 1280px", () => {
    expect(css).toMatch(/\n\.admin-body-grid\{display:block\}/);
    expect(css).toMatch(/\n\.admin-content\{[^}]*max-width:1280px/);
  });

  // TASK-443's restorableView reads a link with no offsetParent as a screen your permissions hide, and
  // display:none gives every link inside it none: a refresh would land on the Overview.
  it("hides a closed drop down with visibility, never display:none", () => {
    expect(wide()).toMatch(/\.admin-nav-panel\{[^}]*visibility:hidden/);
    expect(wide()).not.toMatch(/\.admin-nav-panel\{[^}]*display:none/);
    expect(wide()).toMatch(/\.admin-nav-group\.is-open \.admin-nav-panel\{[^}]*visibility:visible/);
  });

  it("marks the group holding the screen on view", () => {
    expect(wide()).toMatch(/\.admin-nav-group:has\(\.admin-nav-link\.is-active\) \.admin-nav-grouphead\{/);
  });

  it("keeps the phone menu as it was: the labels, not the heads", () => {
    expect(phone()).toMatch(/\.admin-nav-grouphead\{display:none\}/);
    expect(wide()).toMatch(/\.admin-nav-grouplabel\{display:none\}/);
  });
});
