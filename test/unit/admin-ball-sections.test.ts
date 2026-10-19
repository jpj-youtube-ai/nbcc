// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// The Festive Ball screen's new look (October 2026): a band, six sections one at a time, Needs you,
// and Set up as drop downs. Driven here in the admin's jsdom harness (admin.html's <body>, a fake
// fetch, app.js evaluated against it). What these pin is the new look working. That nothing it does
// changed is pinned by the screen's own tests, which still pass, and by the last test here: opening
// the screen asks the server for exactly what it asked for before. Every name and number is invented.

// Each test loads the whole admin page afresh in jsdom, and two load it twice: under a full parallel
// run they took more than the default 5s (seen 2026-10-19), as admin-get-involved-tab's did.
vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string };
let perms: PermissionMap = {};
let calls: Call[] = [];
let fail: Set<string> = new Set();
let ball: Record<string, unknown> = {};
let overview: Record<string, unknown> = {};

const SETTINGS = {
  gateOpensAt: null, totalTables: 40, seatsPerTable: 10, heldSeats: 12, salesCloseAt: "2026-10-30T23:00:00Z",
  salesClosed: false, cardFeePercentBp: 150, cardFeeFixedPence: 20, guestDetailsLockAt: "2026-10-31T17:00:00Z",
  menuOptions: "Starter: Cullen skink | Melon\nMain: Steak pie | Salmon\nDessert: Cranachan | Cheesecake",
  menuNote: "(V) vegetarian", arrivalTime: "7pm for 7.30pm", includedNote: "", lineUpNote: "",
};

function freshBall(): Record<string, unknown> {
  return {
    "/api/admin/ball": {
      settings: { ...SETTINGS }, gateOpen: true,
      availability: { seatsRemaining: 76, tablesRemaining: 5 },
      dashboard: { seatsSold: 312, totalPence: 3120000, donationsPence: 124050, giftAidablePence: 98000, newsletterOptIns: 57 },
    },
    "/api/admin/ball/bookings": { results: [], abandoned: 0, noPhone: 2 },
    "/api/admin/ball/guest-progress": {
      summary: { guestsNamed: 290, seatsBooked: 301, percentComplete: 96, guestsMissing: 11, bookingsOutstanding: 4, needsGiven: 23 },
      outstanding: [],
    },
    "/api/admin/ball/menu-progress": {
      summary: { asking: true, chosen: 283, guestsNamed: 290, percentComplete: 97, outstanding: 7, bookingsOutstanding: 3 },
      outstanding: [],
    },
    "/api/admin/ball/transfers": {
      results: [
        { reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, buyerName: "Morven Tait", buyerEmail: "morven@example.org", totalPence: 100000, payBy: "2026-10-23", overdue: false, reminded: false, createdAt: "2026-10-16T10:00:00Z", buyerPhone: "07700 900123" },
        { reference: "BALL-3HXW9P", kind: "seat", quantity: 2, buyerName: "Iain Corsar", buyerEmail: "iain@example.org", totalPence: 20000, payBy: "2026-10-15", overdue: true, reminded: true, createdAt: "2026-10-08T10:00:00Z", buyerPhone: "" },
        { reference: "BALL-Q8D2LT", kind: "seat", quantity: 1, buyerName: "Ailsa Dunlop", buyerEmail: "ailsa@example.org", totalPence: 10000, payBy: "2026-10-25", overdue: false, reminded: false, createdAt: "2026-10-18T10:00:00Z", buyerPhone: "0141 496 0100" },
      ],
    },
    "/api/admin/ball/transfer-settings": { accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678", on: true, lastDay: "2026-10-30" },
    "/api/admin/ball/holds": { results: [] },
  };
}

function respond(method: string, path: string) {
  const j = (payload: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/overview") return j(overview);
  if (method === "GET" && path in ball) {
    if (fail.has(path)) return j({ error: "Admin is temporarily unavailable" }, 500);
    return j(ball[path]);
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const sectionButton = (key: string) => document.querySelector(`#ballSections [data-ball-section="${key}"]`) as HTMLElement;
const shown = () =>
  Array.from(document.querySelectorAll("#view-ball [data-ball-part]"))
    .filter((p) => !(p as HTMLElement).hidden)
    .map((p) => p.getAttribute("data-ball-part"));
const now = (key: string) => (document.querySelector(`[data-ball-now="${key}"]`) as HTMLElement).textContent;
const needs = () => Array.from(el("ballNeeds").querySelectorAll("li")) as HTMLElement[];
const ballGets = () => calls.filter((c) => c.method === "GET" && c.path.startsWith("/api/admin/ball")).map((c) => c.path);

function boot() {
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => false;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string }) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = String(url).split("?")[0];
    calls.push({ method, path });
    return Promise.resolve(respond(method, path));
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
}
async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
async function openBall() {
  await signIn();
  (document.querySelector('.admin-nav-link[data-view="ball"]') as HTMLElement).click();
  await settle();
}
async function press(target: HTMLElement) {
  target.click();
  await settle();
}

beforeEach(() => {
  // Only Date is made up, so the countdown reads a known day and the harness's timers still run.
  vi.useFakeTimers({ now: new Date("2026-10-19T10:00:00"), toFake: ["Date"] });
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  fail = new Set();
  ball = freshBall();
  overview = { needs: [], failed: [], numbers: [], coming: [] };
  window.sessionStorage.clear();
  boot();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("six sections, one on screen at a time", () => {
  it("opens on Overview, with only its part showing", async () => {
    await openBall();
    expect(shown()).toEqual(["overview"]);
    expect(sectionButton("overview").getAttribute("aria-pressed")).toBe("true");
    expect(sectionButton("overview").classList.contains("is-active")).toBe(true);
  });

  it("shows the section whose button is pressed, and only that one", async () => {
    await openBall();
    await press(sectionButton("bookings"));
    expect(shown()).toEqual(["bookings"]);
    expect(sectionButton("bookings").getAttribute("aria-pressed")).toBe("true");
    expect(sectionButton("overview").getAttribute("aria-pressed")).toBe("false");
    expect(sectionButton("overview").classList.contains("is-active")).toBe(false);
  });

  it("comes back to the section it was on after a refresh", async () => {
    await openBall();
    await press(sectionButton("setup"));
    boot(); // a refresh: the same browser tab, so the same session
    await openBall();
    expect(shown()).toEqual(["setup"]);
  });

  it("stays on its section when a save or a send reloads the screen", async () => {
    await openBall();
    await press(sectionButton("transfers"));
    // Any of the screen's reloads: here, leaving for another screen and coming back.
    (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
    await settle();
    (document.querySelector('.admin-nav-link[data-view="ball"]') as HTMLElement).click();
    await settle();
    expect(shown()).toEqual(["transfers"]);
  });

  it("moves along the buttons with the arrow keys, Home and End", async () => {
    await openBall();
    const key = (k: string) =>
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    sectionButton("overview").focus();
    key("ArrowRight");
    await settle();
    expect(document.activeElement).toBe(sectionButton("bookings"));
    expect(shown()).toEqual(["bookings"]);
    key("End");
    await settle();
    expect(document.activeElement).toBe(sectionButton("setup"));
    expect(shown()).toEqual(["setup"]);
    key("ArrowRight");
    await settle();
    expect(shown()).toEqual(["overview"]);
    key("ArrowLeft");
    await settle();
    expect(shown()).toEqual(["setup"]);
    key("Home");
    await settle();
    expect(shown()).toEqual(["overview"]);
  });
});

describe("the band", () => {
  it("says whether the ticket page is public", async () => {
    await openBall();
    expect(el("ballHeroPage").textContent).toContain("Public");
  });

  it("says when it is private", async () => {
    (ball["/api/admin/ball"] as { gateOpen: boolean }).gateOpen = false;
    await openBall();
    expect(el("ballHeroPage").textContent).toContain("Private");
  });

  it("counts the days to the night", async () => {
    await openBall();
    expect(el("ballHeroCountdown").textContent).toContain("19 days to go");
  });

  it.each([
    ["2026-11-06T09:00:00", "Tomorrow"],
    ["2026-11-07T09:00:00", "Tonight"],
    // The server's own words for it ("The Ball has been and gone, so the reminder was not sent.").
    ["2026-11-08T09:00:00", "Been and gone"],
  ])("on %s says %s", async (today, words) => {
    vi.setSystemTime(new Date(today));
    await openBall();
    expect(el("ballHeroCountdown").textContent).toContain(words);
  });
});

describe("Overview: the numbers at a glance", () => {
  it("shows the seats sold against what was on sale, and the money", async () => {
    await openBall();
    const glance = el("ballStats").textContent || "";
    expect(glance).toContain("312");
    expect(glance).toContain("seats sold");
    // Big numbers with their commas, and pence only when there are some.
    expect(glance).toContain("£31,200 taken");
    // Each card lists the rest the same way, one line each: what it is, then the number.
    const lines = (card: string) =>
      Array.from(el("ballStats").querySelectorAll(`.${card} dl > div`)).map((d) => [
        d.querySelector("dt")?.textContent,
        d.querySelector("dd")?.textContent,
      ]);
    expect(lines("ball-seats")).toEqual([
      ["Seats still on sale", "76"],
      ["Whole tables still on sale", "5"],
    ]);
    expect(lines("ball-money")).toEqual([
      ["Donations", "£1,240.50"],
      ["Gift Aid eligible", "£980"],
      ["Newsletter sign ups", "57"],
    ]);
    // The bar says in words what it shows.
    const bar = el("ballStats").querySelector('[role="img"]') as HTMLElement;
    expect(bar.getAttribute("aria-label")).toBe("312 of 388 seats on sale sold");
  });

  it("shows nothing, rather than a made up zero, when the numbers could not load", async () => {
    fail.add("/api/admin/ball");
    await openBall();
    expect(el("ballStats").textContent).toBe("");
  });
});

describe("Overview: Needs you", () => {
  it("lists what needs someone, biggest worry first, each with the way to it", async () => {
    await openBall();
    const lines = needs().map((li) => li.textContent || "");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("3 bank transfers are waiting for their money, 1 is past its pay by date");
    expect(lines[1]).toContain("2 bookings have no phone number yet");
    expect(lines[2]).toContain("11 guests still to be named, across 4 bookings");
    expect(lines[3]).toContain("7 guests still to choose their dinner");
    expect(needs()[0].querySelector("[data-ball-go]")!.getAttribute("data-ball-go")).toBe("transfers");
    expect(needs()[1].querySelector("[data-ball-go]")!.getAttribute("data-ball-go")).toBe("bookings");
    expect(needs()[2].querySelector("[data-ball-go]")!.getAttribute("data-ball-go")).toBe("guests");
    expect(el("ballNeeds").textContent).not.toContain("Nothing needs you");
  });

  it("opens the section a line's button names", async () => {
    await openBall();
    await press(needs()[0].querySelector("[data-ball-go]") as HTMLElement);
    expect(shown()).toEqual(["transfers"]);
    expect(sectionButton("transfers").getAttribute("aria-pressed")).toBe("true");
  });

  it("says one in the singular", async () => {
    (ball["/api/admin/ball/transfers"] as { results: unknown[] }).results.splice(1, 2);
    (ball["/api/admin/ball/bookings"] as { noPhone: number }).noPhone = 1;
    const g = (ball["/api/admin/ball/guest-progress"] as { summary: Record<string, number> }).summary;
    g.guestsMissing = 1;
    g.bookingsOutstanding = 1;
    (ball["/api/admin/ball/menu-progress"] as { summary: Record<string, number> }).summary.outstanding = 1;
    await openBall();
    const lines = needs().map((li) => li.textContent || "");
    expect(lines[0]).toContain("1 bank transfer is waiting for its money");
    expect(lines[0]).not.toContain("past its pay by date");
    expect(lines[1]).toContain("1 booking has no phone number yet");
    expect(lines[2]).toContain("1 guest still to be named, across 1 booking");
    expect(lines[3]).toContain("1 guest still to choose their dinner");
  });

  it("says nothing needs you only when all four were checked and none does", async () => {
    (ball["/api/admin/ball/transfers"] as { results: unknown[] }).results = [];
    (ball["/api/admin/ball/bookings"] as { noPhone: number }).noPhone = 0;
    (ball["/api/admin/ball/guest-progress"] as { summary: Record<string, number> }).summary.guestsMissing = 0;
    (ball["/api/admin/ball/menu-progress"] as { summary: Record<string, number> }).summary.outstanding = 0;
    await openBall();
    expect(needs()).toHaveLength(0);
    expect(el("ballNeeds").textContent).toContain("Nothing needs you right now.");
  });

  it("does not ask about dinners before there is a menu", async () => {
    const m = (ball["/api/admin/ball/menu-progress"] as { summary: Record<string, unknown> }).summary;
    m.asking = false;
    m.outstanding = 0;
    await openBall();
    expect(el("ballNeeds").textContent).not.toContain("dinner");
  });

  it("says what it could not check, and never that nothing needs you", async () => {
    (ball["/api/admin/ball/bookings"] as { noPhone: number }).noPhone = 0;
    (ball["/api/admin/ball/guest-progress"] as { summary: Record<string, number> }).summary.guestsMissing = 0;
    (ball["/api/admin/ball/menu-progress"] as { summary: Record<string, number> }).summary.outstanding = 0;
    fail.add("/api/admin/ball/transfers");
    await openBall();
    expect(el("ballNeeds").textContent).toContain("Could not check the bank transfers");
    expect(el("ballNeeds").textContent).not.toContain("Nothing needs you");
  });
});

describe("the section buttons carry their counts", () => {
  it("shows how many transfers are waiting and how many bookings to chase", async () => {
    await openBall();
    expect(sectionButton("transfers").textContent).toMatch(/Awaiting transfer\s*,?\s*3/);
    expect(sectionButton("guests").textContent).toMatch(/Guests and menu\s*,?\s*4/);
  });

  it("shows none where there is nothing", async () => {
    (ball["/api/admin/ball/transfers"] as { results: unknown[] }).results = [];
    await openBall();
    expect(sectionButton("transfers").textContent!.trim()).toBe("Awaiting transfer");
  });
});

// On a phone each payment is a card whose cells are flex rows (admin.css, btlist). Loose, the amount
// and what it bought sat side by side, and "Overdue" was squeezed until it broke in half.
describe("Awaiting transfer: a payment's lines stay together on a phone", () => {
  it("wraps what each cell says in one block", async () => {
    await openBall();
    const row = document.querySelector('#ballTransfers tr[data-ref="BALL-3HXW9P"]') as HTMLElement;
    for (const label of ["Amount", "Pay by"]) {
      const cell = row.querySelector(`td[data-label="${label}"]`) as HTMLElement;
      expect(cell.children).toHaveLength(1);
      expect(cell.firstElementChild?.className).toBe("ball-cell");
    }
    expect(row.querySelector('td[data-label="Amount"]')?.textContent).toBe("£200.002 tickets");
    const payBy = row.querySelector('td[data-label="Pay by"] .ball-cell') as HTMLElement;
    expect(payBy.querySelector(".admin-pill")?.textContent).toBe("Overdue");
    expect(payBy.textContent).toContain("Reminder sent");
  });
});

// The two chase lists too (admin.css, bclist): as five squeezed columns on a phone, the headings and
// every name broke mid word.
describe("Guests and menu: the chase lists label their cells for a phone", () => {
  const labels = (id: string) =>
    Array.from(el(id).querySelectorAll("tbody tr:first-child td")).map((td) => td.getAttribute("data-label"));

  it("names each cell, keeps who booked in one block, and says the same as before", async () => {
    (ball["/api/admin/ball/guest-progress"] as { outstanding: unknown[] }).outstanding = [
      { reference: "BALL-P2VN8K", buyerName: "Callum McPhee", buyerEmail: "callum@example.org", guestsNamed: 0, seats: 4, missing: 4, guestLink: "/ball/guests/abc" },
    ];
    (ball["/api/admin/ball/menu-progress"] as { outstanding: unknown[] }).outstanding = [
      { reference: "BALL-M4TR6C", buyerName: "Rhona Fairbairn", buyerEmail: "rhona@example.com", chosen: 16, guestsNamed: 20, missing: 4, guestLink: "" },
    ];
    await openBall();
    expect(labels("ballOutstanding")).toEqual(["Reference", "Who booked", "Named", "Still missing", ""]);
    expect(labels("ballMenuOutstanding")).toEqual(["Reference", "Who booked", "Chosen", "Still to choose", ""]);
    for (const id of ["ballOutstanding", "ballMenuOutstanding"]) {
      expect(el(id).querySelector("table")?.classList.contains("ball-chase-table")).toBe(true);
      const who = el(id).querySelector('td[data-label="Who booked"]') as HTMLElement;
      expect(who.children).toHaveLength(1);
      expect(who.firstElementChild?.className).toBe("ball-who");
    }
    expect(el("ballOutstanding").querySelector("tbody tr")?.textContent).toBe("BALL-P2VN8KCallum McPheecallum@example.org0 of 44Their link");
    expect(el("ballMenuOutstanding").querySelector("tbody tr")?.textContent).toBe("BALL-M4TR6CRhona Fairbairnrhona@example.com16 of 204No link yet");
  });
});

describe("Set up: each drop down says what it is set to", () => {
  it("on its closed line", async () => {
    await openBall();
    expect(now("page")).toBe("Public");
    expect(now("seats")).toBe("40 tables of 10, 12 seats held back, sales close " +
      new Date("2026-10-30T23:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }));
    expect(now("fee")).toBe("1.50% plus 20p a booking");
    expect(now("transfer")).toBe("On, last day Fri 30 Oct");
    expect(now("details")).toBe("Arrival 7pm for 7.30pm");
    expect(now("menu")).toBe("Set, 3 courses");
    expect(now("lock")).toBe("Close " +
      new Date("2026-10-31T17:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }));
  });

  it("when things are not set", async () => {
    const d = ball["/api/admin/ball"] as { gateOpen: boolean; settings: Record<string, unknown> };
    d.gateOpen = false;
    Object.assign(d.settings, { salesCloseAt: null, salesClosed: true, guestDetailsLockAt: null, menuOptions: "", arrivalTime: "", gateOpensAt: "2026-10-20T18:00:00Z" });
    Object.assign(ball["/api/admin/ball/transfer-settings"] as object, { on: false, lastDay: null });
    await openBall();
    expect(now("page")).toBe("Private, opens " +
      new Date("2026-10-20T18:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }));
    expect(now("seats")).toBe("40 tables of 10, 12 seats held back, sales closed");
    expect(now("transfer")).toBe("Off");
    expect(now("details")).toBe("Arrival time to be confirmed");
    expect(now("menu")).toBe("Not set yet");
    expect(now("lock")).toBe("Not set, so nobody is chased");
  });

  it("keeps every setting closed until opened", async () => {
    await openBall();
    const groups = Array.from(document.querySelectorAll("#view-ball details.ball-setting")) as HTMLDetailsElement[];
    expect(groups).toHaveLength(7);
    for (const g of groups) expect(g.open).toBe(false);
  });
});

describe("the main Overview's Festive Ball lines open their own section", () => {
  async function fromOverview(key: string, text: string) {
    overview = {
      needs: [{ key, level: 2, view: "ball", button: "Festive Ball", text }],
      failed: [], numbers: [], coming: [],
    };
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
    await settle();
    await press(el("overviewNeeds").querySelector('[data-ov-view="ball"]') as HTMLElement);
  }

  it("bank transfers open Awaiting transfer", async () => {
    await fromOverview("transfersWaiting", "2 bank transfers are still waiting for their money");
    expect(el("view-ball").hidden).toBe(false);
    expect(shown()).toEqual(["transfers"]);
  });

  it("overdue ones too", async () => {
    await fromOverview("transfersOverdue", "1 bank transfer is overdue");
    expect(shown()).toEqual(["transfers"]);
  });

  it("missing guest details open Guests and menu", async () => {
    await fromOverview("ballGuestsMissing", "4 Festive Ball bookings still have guest details missing");
    expect(shown()).toEqual(["guests"]);
  });
});

describe("what the screen asks the server for is what it asked for before", () => {
  it("one of each, in the same order, on opening", async () => {
    await openBall();
    expect(ballGets()).toEqual([
      "/api/admin/ball/holds",
      "/api/admin/ball/transfers",
      "/api/admin/ball/transfer-settings",
      "/api/admin/ball",
      "/api/admin/ball/bookings",
      "/api/admin/ball/guest-progress",
      "/api/admin/ball/menu-progress",
    ]);
  });

  it("and nothing more when a section is chosen", async () => {
    await openBall();
    const before = ballGets().length;
    for (const key of ["bookings", "transfers", "guests", "emails", "setup", "overview"]) await press(sectionButton(key));
    expect(ballGets().length).toBe(before);
  });
});
