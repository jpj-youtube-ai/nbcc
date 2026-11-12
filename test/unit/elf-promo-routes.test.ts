import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";

// How the Elf Detective School's card, and the school's place in the site maps, follow the school's
// switch through the real site router: the database is mocked, the switch is flipped between visits,
// and the clock stands after the Ball's moment, as it does on the live site now. The card itself is in
// elf-promo.test.ts. Every name and address here is invented.
//
// TASK-613: nothing links to Elf Detective School before 10am on Friday 13 November 2026
// (src/elf/links-at.ts), however it is switched. The clock stands after that moment unless a test
// moves it.

const AFTER_THE_MOMENT = new Date("2026-11-13T12:00:00Z");
const state = vi.hoisted(() => ({
  now: new Date("2026-11-13T12:00:00Z"),
  schoolOn: false,
  settingsFail: false,
  settingsReads: 0,
}));

vi.mock("../../src/db/elf", async () => {
  const { ELF_DEFAULTS } = await import("../../src/elf/settings");
  return {
    ELF_DEFAULTS,
    getElfSettings: async () => {
      state.settingsReads += 1;
      if (state.settingsFail) throw new Error("no database");
      return { ...ELF_DEFAULTS, schoolOn: state.schoolOn };
    },
  };
});
vi.mock("../../src/db/ball", () => ({
  getSettings: async () => ({ gateOpen: false, gateOpensAt: null }),
  getPreviewPasswordHash: async () => null,
  ticketSalesClosed: async () => true,
}));
vi.mock("../../src/db/events", () => ({
  getEventsSettings: async () => ({ pageOn: true }),
  listPageEvents: async () => [],
}));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => false,
  listApprovedPublic: async () => [],
  getBySlug: async () => null,
  wallRows: async () => [],
}));
vi.mock("../../src/db/donations", () => ({ listPublicSupporters: async () => ({ bronze: [], silver: [], gold: [], platinum: [] }) }));
vi.mock("../../src/db/red-bag-lists", () => ({ loadPublishedRedBagList: async () => null, readRedBagDraft: async () => null }));
vi.mock("../../src/ball/preview-access", () => ({ holdsPreviewCookie: async () => false }));

import { readFileSync } from "node:fs";
import { createSiteRouter, decorateSitePage } from "../../src/routes/site";
import { ELF_NAV_ITEM } from "../../src/elf/nav-link";
import { ELF_MENU_FIT } from "../../src/elf/menu-fit";
import { EVENTS_NAV_ITEM } from "../../src/events/nav-link";
import { MENU_FIT } from "../../src/events/menu-fit";
import { renderRulesPage } from "../../src/elf/pages/rules";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { renderGuestPage } from "../../src/ball/guest-page";
import { renderBallThankYou } from "../../src/ball/thank-you-page";

const ROOT = resolve(__dirname, "../..");
const CARD = 'id="elfCard"';
const CARD_CSS = "/assets/css/elf-promo.css";
const PAGES = ["/", "/get-involved", "/get-involved/schools"];
// TASK-613: the menu's item goes on every page of the main site, each kind of page drawn its own way:
// the home page, plain files, a page drawn by hand, the events pages and the short pages.
const MENU_PAGES = ["/", "/contact", "/about-us", "/supporters", "/get-involved", "/whats-on", "/get-involved/schools", "/get-involved/volunteer"];
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const navList = (html: string) => html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";
const hrefs = (list: string) => [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(createSiteRouter(ROOT, { now: () => state.now }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

beforeEach(() => {
  state.now = AFTER_THE_MOMENT;
  state.schoolOn = false;
  state.settingsFail = false;
  state.settingsReads = 0;
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });
const body = async (path: string) => (await get(path)).text();

describe("while the school is switched off", () => {
  it.each(PAGES)("%s says nothing of the school and links nowhere near it", async (path) => {
    const res = await get(path);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain(CARD);
    expect(html).not.toContain(CARD_CSS);
    expect(html).not.toContain('href="/elf');
    expect(html).not.toContain("Elf Detective School");
  });

  it("the site maps leave the school out", async () => {
    expect(await body("/sitemap")).not.toContain('href="/elf"');
    expect(await body("/sitemap.xml")).not.toContain("https://nbcc.scot/elf<");
  });

  it.each(MENU_PAGES)("%s has no Elf Detective School in the menu, and not its fit", async (path) => {
    const html = await body(path);
    expect(hrefs(navList(html))).not.toContain("/elf");
    expect(html).not.toContain(ELF_MENU_FIT);
  });
});

describe("while the school is switched on", () => {
  beforeEach(() => {
    state.schoolOn = true;
  });

  it.each(PAGES)("%s carries the card once, with its styles in the head", async (path) => {
    const html = await body(path);
    expect(count(html, CARD)).toBe(1);
    expect(count(html, CARD_CSS)).toBe(1);
    expect(html.indexOf(CARD_CSS)).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain('<a class="btn btn-primary" href="/elf">');
  });

  it("the home page has it after Fill a Red Bag and before the four ways to start", async () => {
    const html = await body("/");
    expect(html.indexOf('id="fillBand"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="fillBand"')).toBeLessThan(html.indexOf(CARD));
    expect(html.indexOf(CARD)).toBeLessThan(html.indexOf('<section class="home-lane"'));
  });

  it("Get involved has it after the events and before the ways to help together", async () => {
    const html = await body("/get-involved");
    expect(html.indexOf('id="whats-on"')).toBeLessThan(html.indexOf(CARD));
    expect(html.indexOf(CARD)).toBeLessThan(html.indexOf("together-band"));
  });

  it("Your school has it before the form, with the address for a letter home", async () => {
    const html = await body("/get-involved/schools");
    expect(html.indexOf(CARD)).toBeLessThan(html.indexOf('id="tell-us"'));
    expect(html).toContain("nbcc.scot/elf");
  });

  it("the site maps list the school", async () => {
    expect(await body("/sitemap")).toContain('<a href="/elf">Elf Detective School</a>');
    expect(await body("/sitemap.xml")).toContain("<loc>https://nbcc.scot/elf</loc>");
  });

  // Straight after Get involved, or after Drop-off points while that is in the menu (Jaimie, 12 November
  // 2026: Get involved, Drop-off points, Elf Detective School; src/site/dropoff-nav.ts, until 20 December).
  it.each(MENU_PAGES)("%s offers Elf Detective School in the menu once, after Get involved, with the menu's fit", async (path) => {
    const html = await body(path);
    const list = hrefs(navList(html));
    expect(list.filter((h) => h === "/elf")).toHaveLength(1);
    const dropOff = list.includes("/get-involved/drop-off-points") ? 1 : 0;
    if (dropOff) expect(list.indexOf("/get-involved/drop-off-points")).toBe(list.indexOf("/get-involved") + 1);
    expect(list.indexOf("/elf")).toBe(list.indexOf("/get-involved") + 1 + dropOff);
    expect(navList(html)).toContain(">Elf Detective School</a>");
    expect(count(html, ELF_MENU_FIT)).toBe(1);
    expect(html.indexOf(ELF_MENU_FIT)).toBeLessThan(html.indexOf("</head>"));
  });

  it("keeps Get involved lit up on its short pages", async () => {
    const list = navList(await body("/get-involved/schools"));
    expect(list).toContain('<a href="/get-involved" class="active" aria-current="true">Get involved</a>');
    expect(list).toContain(ELF_NAV_ITEM);
  });
});

describe("the lever", () => {
  it("shows and hides the card on the very next visit, with nothing restarted", async () => {
    expect(await body("/")).not.toContain(CARD);
    state.schoolOn = true;
    expect(await body("/")).toContain(CARD);
    state.schoolOn = false;
    expect(await body("/")).not.toContain(CARD);
  });

  it("is read for every visit, not kept", async () => {
    await body("/get-involved/schools");
    await body("/get-involved/schools");
    expect(state.settingsReads).toBeGreaterThanOrEqual(2);
  });

  // TASK-613: the home page carries both the card and the menu's item. They ask once and share the
  // answer, so the two always agree, even if a read goes wrong.
  it("is read once for a view of the home page, for the card and the menu alike", async () => {
    state.schoolOn = true;
    const html = await body("/");
    expect(state.settingsReads).toBe(1);
    expect(count(html, CARD)).toBe(1);
    expect(count(navList(html), ELF_NAV_ITEM)).toBe(1);
  });

  it.each(PAGES)("counts as off on %s when it cannot be read, and the page still goes out", async (path) => {
    state.schoolOn = true;
    state.settingsFail = true;
    const res = await get(path);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain(CARD);
    expect(html).not.toContain('href="/elf');
  });
});

// TASK-613 (Jaimie, 11 November 2026): switched on tonight so a teacher's emailed link works, but
// nothing on the site links to Elf Detective School until the big push at 10am on Friday 13 November.
describe("switched on, before 10am on Friday 13 November", () => {
  beforeEach(() => {
    state.now = new Date("2026-11-13T09:59:59.999Z");
  });

  it.each(PAGES)("%s is byte for byte what it is with the school switched off", async (path) => {
    state.schoolOn = false;
    const off = await body(path);
    state.schoolOn = true;
    const on = await body(path);
    expect(on).toBe(off);
    expect(on).not.toContain('href="/elf');
  });

  it("the site maps leave it out", async () => {
    state.schoolOn = true;
    expect(await body("/sitemap")).not.toContain('href="/elf"');
    expect(await body("/sitemap.xml")).not.toContain("https://nbcc.scot/elf<");
  });

  it("tonight too", async () => {
    state.now = new Date("2026-11-11T21:30:00Z");
    state.schoolOn = true;
    for (const path of PAGES) expect(await body(path), path).not.toContain('href="/elf');
  });

  it("the card is there from 10am on the dot", async () => {
    state.schoolOn = true;
    state.now = new Date("2026-11-13T10:00:00.000Z");
    for (const path of PAGES) expect(count(await body(path), CARD), path).toBe(1);
  });

  it.each(MENU_PAGES)("%s has a menu byte for byte as it is with the school switched off", async (path) => {
    state.schoolOn = false;
    const off = await body(path);
    state.schoolOn = true;
    const on = await body(path);
    expect(on).toBe(off);
    expect(hrefs(navList(on))).not.toContain("/elf");
  });

  it("the menu's item is there from 10am on the dot", async () => {
    state.schoolOn = true;
    state.now = new Date("2026-11-13T10:00:00.000Z");
    for (const path of MENU_PAGES) expect(count(navList(await body(path)), ELF_NAV_ITEM), path).toBe(1);
  });
});

// The Santa Sleigh's page is drawn outside the site router (src/routes/sleigh.ts) and decorated by
// decorateSitePage, which reads the real clock when it is given none.
describe("a page drawn outside the site router", () => {
  const contact = () => readFileSync(resolve(ROOT, "contact.html"), "utf8");

  it("gains the menu's item only while the school is on, and only from 10am on Friday", async () => {
    state.schoolOn = true;
    expect(await decorateSitePage(contact(), undefined, new Date("2026-11-13T09:59:59Z"))).not.toContain(ELF_NAV_ITEM);
    expect(await decorateSitePage(contact(), undefined, new Date("2026-11-13T10:00:00Z"))).toContain(ELF_NAV_ITEM);
    state.schoolOn = false;
    expect(await decorateSitePage(contact(), undefined, new Date("2026-11-13T10:00:00Z"))).not.toContain(ELF_NAV_ITEM);
  });

  // TASK-615: the pages built in code wear the site's own banner (src/site/chrome.ts), so they gain the
  // menu's items as the site's own pages do: Get involved and its fit while the events switch is on (it
  // is, here), and Elf Detective School and its fit only from 10am on Friday 13 November.
  it.each([
    ["an Elf Detective School page", () => renderRulesPage({ settings: { ...ELF_DEFAULTS, schoolOn: true } })],
    ["the Festive Ball's guest details", () => renderGuestPage({ booking: { reference: "BALL-K7M2PQ", kind: "seat", quantity: 1, seats: 1, buyerName: "Sam Example", tableName: null }, guests: [], token: "tok123" })],
    ["the Festive Ball's thank you", () => renderBallThankYou(null)],
  ])("%s gains the menu's items as every other page does", async (_name, draw) => {
    state.schoolOn = true;
    const before = await decorateSitePage(draw(), undefined, new Date("2026-11-13T09:59:59Z"));
    expect(navList(before)).toContain(EVENTS_NAV_ITEM);
    expect(before).toContain(MENU_FIT);
    expect(count(navList(before), ELF_NAV_ITEM)).toBe(0);
    expect(before).not.toContain(ELF_MENU_FIT);
    const after = await decorateSitePage(draw(), undefined, new Date("2026-11-13T10:00:00Z"));
    expect(count(navList(after), ELF_NAV_ITEM)).toBe(1);
    expect(after).toContain(ELF_MENU_FIT);
  });
});
