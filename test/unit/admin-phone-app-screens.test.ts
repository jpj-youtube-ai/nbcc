// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { roleToPermissions } from "../../src/admin/permissions";

// The admin pinned to a phone's home screen (TASK-619), and the screens that have a file of their own.
//
// Elf Detective School froze on a phone (14 Nov 2026). The pinned app keeps its session where it lasts
// (app.js, tokenStore), but Head Elf HQ, Santa Sleigh and the rest read it where a browser tab keeps it. So
// in the app they asked the server with no session, were told it had ended, and reloaded the page to sign
// in again: the app was still signed in, reopened the same screen, and round it went, several times a second.
//
// This runs the real admin.html, app.js, elf-hq.js and sleigh.js against a pretend server that, like the
// real one (src/routes/admin-authz.ts), answers 401 to anything but the session it handed out. Every
// person, place and figure here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const GiftLog = require(resolve(ROOT, "assets/js/admin/gift-log.js"));
const { initElfHq } = require(resolve(ROOT, "assets/js/admin/elf-hq.js"));
const { initAdminSleigh } = require(resolve(ROOT, "assets/js/admin/sleigh.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const TOKEN_KEY = "nbcc_admin_token";
const SESSION = signAdminSession({ sub: 3, email: "head.elf@example.org", role: "admin", now: new Date(), secret: "s" }).token;

const HQ = {
  settings: { schoolOn: true, doorsOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewOn: false },
  canSwitch: true,
  canEdit: true,
  numbers: { families: 2, detectives: 3, namesToCheck: 0, waitingPayments: 0, entryPence: 1500, giftPence: 0, giftAidPence: 0 },
  quests: [],
  recruits: [],
  photosWaiting: 0,
  grandPrizeEntries: 0,
  firstClueAt: "2026-12-01T17:30:00.000Z",
  daysToFirstClue: 17,
};
const SLEIGH = {
  nights: [{ id: 1, nightOn: "2026-12-15", areas: "Exampleton", startsAt: null, endsAt: null, bucketPence: 0, cardPence: 0, cardGifts: 0, window: { from: "2026-12-15 16:00", to: "2026-12-15 22:00" } }],
  settings: { seasonFrom: "2026-11-01", offOn: "2027-01-31" },
  totals: { onlinePence: 0, cardPence: 0, bucketPence: 0, totalPence: 0, gifts: 0 },
  mayEdit: true,
};

type Init = { method?: string; body?: string; headers?: Record<string, string> };
type Call = { method: string; url: string; auth: string | null };
let calls: Call[];
let reload: ReturnType<typeof vi.fn>;

/** The pretend server. Signing in hands out SESSION; everything else under /api/admin wants it back. */
function respond(url: string, init: Init = {}) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status < 400,
    json: () => Promise.resolve(JSON.parse(JSON.stringify(body))),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const auth = init.headers?.Authorization ?? null;
  calls.push({ method: init.method ?? "GET", url, auth });
  if (url.includes("/api/admin/login")) return j({ token: SESSION, user: { email: "head.elf@example.org", role: "admin" } });
  if (auth !== "Bearer " + SESSION) return j({ error: "Invalid or expired admin session" }, 401);
  if (url.includes("/api/admin/me")) return j({ email: "head.elf@example.org", permissions: roleToPermissions("admin") });
  if (url.includes("/api/admin/overview")) return j({ updatedAt: "2026-11-14T09:00:00.000Z", needs: [], failed: [] });
  if (url.includes("/api/admin/whats-new/seen")) return j({ seenAt: "2026-11-14T09:00:00.000Z" });
  if (url.includes("/api/admin/whats-new")) return j({ areas: [] });
  if (url === "/api/admin/elf/hq") return j(HQ);
  if (url === "/api/admin/sleigh") return j(SLEIGH);
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const link = (view: string) => document.querySelector('.admin-nav-link[data-view="' + view + '"]') as HTMLElement;

/** Whether this is the app on a phone's home screen, said the way an iPhone says it. */
function pinnedToHomeScreen(yes: boolean) {
  if (yes) Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
  else delete (window.navigator as unknown as { standalone?: boolean }).standalone;
}

/** The page's own window as a screen's file is handed it, except that a reload is counted, not done. */
function screenWindow() {
  return {
    sessionStorage: window.sessionStorage,
    localStorage: window.localStorage,
    navigator: window.navigator,
    location: { reload },
    fetch: (url: string, init?: Init) => (window as unknown as { fetch: (u: string, i?: Init) => unknown }).fetch(url, init),
    setTimeout: (fn: () => void, ms?: number) => window.setTimeout(fn, ms),
    clearTimeout: (id: number) => window.clearTimeout(id),
    addEventListener: (type: string, fn: EventListener) => window.addEventListener(type, fn),
    open: vi.fn(),
    URL: window.URL,
    Blob: window.Blob,
    Event: window.Event,
  };
}

/** Loads the admin as admin.html does: app.js first, then the screens that have a file of their own. */
function loadAdmin() {
  document.body.innerHTML = bodyHtml;
  const w = window as unknown as Record<string, unknown>;
  w.AdminHelpers = helpers;
  w.AdminGiftLog = GiftLog.createGiftLog(document, window);
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
  w.AdminElfHq = initElfHq(document, screenWindow());
  w.AdminSleigh = initAdminSleigh(document, screenWindow());
}

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "head.elf@example.org";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}

/** Every session the server was shown when it was asked for `path`. */
const sessionsShownFor = (path: string) => [...new Set(calls.filter((c) => c.url === path).map((c) => c.auth))];

beforeEach(() => {
  calls = [];
  reload = vi.fn();
  window.sessionStorage.clear();
  window.localStorage.clear();
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) => Promise.resolve(respond(String(url), init as Init)));
});
afterEach(() => {
  pinnedToHomeScreen(false);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("in the app pinned to a phone's home screen", () => {
  beforeEach(() => {
    pinnedToHomeScreen(true);
  });

  it.each([
    ["Elf Detective School", "elf", "/api/admin/elf/hq"],
    ["Santa Sleigh", "sleigh", "/api/admin/sleigh"],
  ])("%s opens with the signed in person's session, and the page is never reloaded", async (_name, view, path) => {
    loadAdmin();
    await signIn();
    link(view).click();
    await settle();
    expect(sessionsShownFor(path)).toEqual(["Bearer " + SESSION]);
    expect(reload).not.toHaveBeenCalled();
    expect(el("view-" + view).hidden).toBe(false);
    expect(el("loginView").hidden).toBe(true);
  });

  it("draws Head Elf HQ from what the server said", async () => {
    loadAdmin();
    await signIn();
    link("elf").click();
    await settle();
    expect(document.querySelector("#elfHq .hq-state")!.textContent).toBe("Live");
    expect(document.querySelector("#elfHq .hq-root > .hq-status")!.textContent).toBe("");
  });

  // An iPhone shuts a web app left in the background, so the next opening starts with nothing but what
  // the app kept on the phone: nobody signs in again on the way.
  it("opens Elf Detective School the same way when the app is opened again, signed in already", async () => {
    window.localStorage.setItem(TOKEN_KEY, SESSION);
    loadAdmin();
    await settle();
    expect(el("appView").hidden).toBe(false);
    link("elf").click();
    await settle();
    expect(sessionsShownFor("/api/admin/elf/hq")).toEqual(["Bearer " + SESSION]);
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelector("#elfHq .hq-state")!.textContent).toBe("Live");
  });

  it("forgets the session everywhere on signing out", async () => {
    loadAdmin();
    await signIn();
    link("elf").click();
    await settle();
    el("logoutBtn").click();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(el("loginView").hidden).toBe(false);
  });
});

describe("in an ordinary browser tab", () => {
  it("opens Elf Detective School with the signed in person's session", async () => {
    loadAdmin();
    await signIn();
    link("elf").click();
    await settle();
    expect(sessionsShownFor("/api/admin/elf/hq")).toEqual(["Bearer " + SESSION]);
    expect(reload).not.toHaveBeenCalled();
  });

  // A tab's session dies with the tab, so a shared computer never keeps anyone signed in.
  it("keeps the session for the tab only, never on the device", async () => {
    loadAdmin();
    await signIn();
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe(SESSION);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
