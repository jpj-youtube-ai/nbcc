import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";

// How the Elf Detective School's card, and the school's place in the site maps, follow the school's
// switch through the real site router: the database is mocked, the switch is flipped between visits,
// and the clock stands after the Ball's moment, as it does on the live site now. The card itself is in
// elf-promo.test.ts. Every name and address here is invented.

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

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");
const CARD = 'id="elfCard"';
const CARD_CSS = "/assets/css/elf-promo.css";
const PAGES = ["/", "/get-involved", "/get-involved/schools"];
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

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
