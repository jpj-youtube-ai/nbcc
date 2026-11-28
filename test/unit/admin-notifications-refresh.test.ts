// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Monitor > Notifications in the kit's look (the admin refresh, 2026-11-14): this phone on or off,
// with Turn off for this phone; each tick saving as it is pressed; only the areas this person can
// open; and a quiet time asked for at both ends and said back. How subscribing, the service worker
// and sending work is unchanged (admin-notifications-screen.test.ts). Every address is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string; body?: string };
let calls: Call[] = [];
let perms: PermissionMap = {};
let prefs: Record<string, unknown> = {};
let putStatus = 204;
let deleteStatus = 204;
let subscription: { endpoint: string; unsubscribe: () => Promise<boolean> } | null = null;
let unsubscribed = false;

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  calls.push({ method, path, body: init?.body });
  if (path === "/api/admin/login") return j({ token, user: { email: "fern@example.com", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/push/subscription" && method === "GET") return j({ phones: subscription ? 2 : 1 });
  if (path === "/api/admin/push/subscription" && method === "DELETE") return j({}, deleteStatus);
  if (path === "/api/admin/push/prefs" && method === "GET") return j(prefs);
  if (path === "/api/admin/push/prefs" && method === "PUT") return j({}, putStatus);
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const puts = () => calls.filter((c) => c.method === "PUT" && c.path === "/api/admin/push/prefs").map((c) => JSON.parse(c.body || "{}"));
const tick = (area: string) => document.querySelector('[data-push-area="' + area + '"]') as HTMLInputElement;

async function openIt() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="notifications"]') as HTMLElement).click();
  await settle();
}
async function flip(box: HTMLInputElement) {
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  prefs = { bundle: false, quietFrom: null, quietTo: null, areasOff: [] };
  putStatus = 204;
  deleteStatus = 204;
  unsubscribed = false;
  subscription = { endpoint: "https://push.example.com/this-phone", unsubscribe: () => ((unsubscribed = true), Promise.resolve(true)) };
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  const w = window as unknown as Record<string, unknown>;
  w.PushManager = function () {};
  w.Notification = { requestPermission: () => Promise.resolve("granted") };
  const reg = { pushManager: { getSubscription: () => Promise.resolve(subscription) } };
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: { addEventListener: () => undefined, getRegistration: () => Promise.resolve(reg), register: () => Promise.resolve(reg), ready: Promise.resolve(reg) },
  });
  window.confirm = () => true;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the look", () => {
  it("is in the kit's look", () => {
    expect(el("view-notifications").classList.contains("ak")).toBe(true);
  });
});

describe("this phone", () => {
  it("says this phone is on, and offers to turn it off, when this browser is subscribed", async () => {
    await openIt();
    expect(el("pushPhoneOn").hidden).toBe(false);
    expect(text(el("pushPhoneOn"))).toContain("This phone is on.");
    expect(text(el("pushDisable"))).toBe("Turn off for this phone");
    expect(el("pushSetup").hidden).toBe(true);
  });

  it("shows the steps and Turn on when this browser is not subscribed", async () => {
    subscription = null;
    await openIt();
    expect(el("pushPhoneOn").hidden).toBe(true);
    expect(el("pushSetup").hidden).toBe(false);
  });

  it("turns this phone off: tells the server which phone, then the browser, and says so beside the button", async () => {
    await openIt();
    el("pushDisable").click();
    await settle();
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.path).toBe("/api/admin/push/subscription");
    expect(JSON.parse(del?.body || "{}")).toEqual({ endpoint: "https://push.example.com/this-phone" });
    expect(unsubscribed).toBe(true);
    expect(text(el("pushDisableStatus"))).toBe("Turned off for this phone. Any other phones you have set up still get notifications.");
    expect(el("pushDisableStatus").className).toBe("admin-action-status is-ok");
  });

  it("says so in the page, and keeps the phone on, when it could not be turned off", async () => {
    deleteStatus = 500;
    await openIt();
    el("pushDisable").click();
    await settle();
    expect(unsubscribed).toBe(false);
    expect(text(el("pushDisableStatus"))).toBe("Could not turn this phone off. Please try again.");
    expect(el("pushDisableStatus").className).toBe("admin-action-status is-error");
  });
});

describe("what buzzes", () => {
  it("offers only the areas this person can open", async () => {
    perms = { overview: "view", donations: "edit", contact: "view" };
    await openIt();
    const offered = Array.from(document.querySelectorAll("[data-push-area]")).map((b) => b.getAttribute("data-push-area"));
    // Workshop drop-offs is gated on Donations too, so it is offered here.
    expect(offered).toEqual(["donations", "monthly", "contact", "drop-offs"]);
  });

  it("saves each tick as it is pressed, and says so beside it", async () => {
    await openIt();
    await flip(tick("stories"));
    expect(puts()).toHaveLength(1);
    expect(puts()[0].areasOff).toEqual(["stories"]);
    const said = document.querySelector('[data-push-said="stories"]') as HTMLElement;
    expect(text(said)).toBe("Saved: Stories will not buzz.");
    expect(said.className).toContain("is-ok");
    await flip(tick("stories"));
    expect(puts()[1].areasOff).toEqual([]);
    expect(text(said)).toBe("Saved: Stories will buzz.");
  });

  it("keeps a stored off for an area this person cannot open", async () => {
    perms = { overview: "view", donations: "edit" };
    prefs = { bundle: false, quietFrom: null, quietTo: null, areasOff: ["elf", "newsletter"] };
    await openIt();
    await flip(tick("donations"));
    expect([...puts()[0].areasOff].sort()).toEqual(["donations", "elf", "newsletter"]);
  });

  it("puts a tick back and says so when it could not be saved", async () => {
    putStatus = 500;
    await openIt();
    await flip(tick("stories"));
    expect(tick("stories").checked).toBe(true);
    const said = document.querySelector('[data-push-said="stories"]') as HTMLElement;
    expect(text(said)).toBe("Could not save that. Please try again.");
    expect(said.className).toContain("is-error");
  });

  it("saves Group them as it is pressed too", async () => {
    await openIt();
    await flip(el("pushBundle") as HTMLInputElement);
    expect(puts()[0].bundle).toBe(true);
    expect(text(el("pushBundleSaid"))).toBe("Saved.");
  });
});

describe("the quiet time", () => {
  it("says back the quiet time it has", async () => {
    prefs = { bundle: false, quietFrom: "22:00:00", quietTo: "07:00:00", areasOff: [] };
    await openIt();
    expect(text(el("pushQuietSaid"))).toBe("Quiet from 10pm until 7am.");
  });

  it("says there is none when there is none", async () => {
    await openIt();
    expect(text(el("pushQuietSaid"))).toBe("No quiet time: your phone buzzes whenever something arrives.");
  });

  it("asks for both ends, and sends nothing, when only one is chosen", async () => {
    await openIt();
    (el("pushQuietFrom") as HTMLInputElement).value = "22:00";
    el("pushPrefsSave").click();
    await settle();
    expect(puts()).toHaveLength(0);
    expect(text(el("pushPrefsStatus"))).toBe("Choose both times for a quiet time, or clear both for none.");
    expect(el("pushPrefsStatus").className).toBe("admin-action-status is-error");
  });

  it("saves both ends and says them back", async () => {
    await openIt();
    (el("pushQuietFrom") as HTMLInputElement).value = "22:30";
    (el("pushQuietTo") as HTMLInputElement).value = "07:00";
    el("pushPrefsSave").click();
    await settle();
    expect(puts()[0].quietFrom).toBe("22:30:00");
    expect(puts()[0].quietTo).toBe("07:00:00");
    expect(text(el("pushPrefsStatus"))).toBe("Saved.");
    expect(text(el("pushQuietSaid"))).toBe("Quiet from 10:30pm until 7am.");
  });
});
