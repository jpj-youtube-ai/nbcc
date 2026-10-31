import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express, { Router } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";

// The six short pages under /get-involved/: how each one is served. What is on them, and the Tell us
// forms, are in get-involved-short-pages-content.test.ts. Driven through the real site router with the
// database mocked. Every name and address here is invented.

const state = vi.hoisted(() => ({
  eventsOn: true,
  fundraisingOn: true,
  gateOpen: false,
  aliases: {} as Record<string, string>,
}));

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => ({ gateOpen: state.gateOpen, gateOpensAt: null }),
  getPreviewPasswordHash: async () => null,
}));
vi.mock("../../src/db/events", () => ({
  getEventsSettings: async () => ({ pageOn: state.eventsOn }),
  listPageEvents: async () => [],
}));
vi.mock("../../src/db/site-pages", () => ({
  resolveAlias: async (path: string) => state.aliases[path] ?? null,
  getSeoOverrides: async () => new Map(),
}));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.fundraisingOn,
  listApprovedPublic: async () => [],
  getBySlug: async () => null,
  wallRows: async () => [],
}));
vi.mock("../../src/ball/preview-access", () => ({ holdsPreviewCookie: async () => false }));

import { createSiteRouter } from "../../src/routes/site";
import { addShortPageRoutes } from "../../src/routes/get-involved-pages";
import { RESERVED_PREFIXES, SHORT_PAGES, SITE_PAGES, aliasFromProblem, aliasToProblem, isKnownPage, renderSitemapTree, renderSitemapXml } from "../../src/site/pages";

const ROOT = resolve(__dirname, "../..");
const HEADINGS: [string, string][] = [
  ["/get-involved/drop-off-points", "Drop-off points"],
  ["/get-involved/referrals", "Referrals"],
  ["/get-involved/volunteer", "Volunteer"],
  ["/get-involved/business", "Let&rsquo;s make Christmas happen together."],
  ["/get-involved/schools", "Schools are at the heart of what we do."],
  ["/get-involved/groups", "Do something brilliant, together."],
];
const PATHS = HEADINGS.map(([path]) => path);
const navList = (html: string) => html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";
const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(createSiteRouter(ROOT));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

beforeEach(() => {
  state.eventsOn = true;
  state.fundraisingOn = true;
  state.gateOpen = false;
  state.aliases = {};
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("the six addresses", () => {
  it.each(HEADINGS)("%s answers with its heading", async (path, heading) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain(heading);
  });

  it.each(PATHS)("%s is not gated by the events switch", async (path) => {
    state.eventsOn = false;
    expect((await get(path)).status).toBe(200);
  });

  it.each(PATHS)("%s is still there with fundraising switched off", async (path) => {
    state.fundraisingOn = false;
    expect((await get(path)).status).toBe(200);
  });

  it("leaves anything else under /get-involved/ to the 404", async () => {
    expect((await get("/get-involved/nothing-here")).status).toBe(404);
  });

  it("does not show the file's own address", async () => {
    expect((await get("/get-involved-volunteer.html")).status).toBe(404);
  });

  it("still sends the page if the menu items cannot be read", async () => {
    const router = Router();
    addShortPageRoutes(router, ROOT, {
      decorate: async () => {
        throw new Error("no database");
      },
    });
    const app = express();
    app.use(router);
    const failing = app.listen(0);
    await new Promise((r) => failing.once("listening", r));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await fetch(`http://127.0.0.1:${(failing.address() as AddressInfo).port}/get-involved/volunteer`);
    failing.close();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Sign up to volunteer");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("the menu on a short page", () => {
  it("offers Get involved and What's on, and marks Get involved as the section you are in", async () => {
    const list = navList(await (await get("/get-involved/volunteer")).text());
    expect(list).toContain('<a href="/get-involved" class="active" aria-current="true">Get involved</a>');
    expect(list).toContain('href="/whats-on"');
  });

  it("offers neither while the events switch is off, because both are the 404", async () => {
    state.eventsOn = false;
    const list = navList(await (await get("/get-involved/volunteer")).text());
    expect(list).not.toContain("/get-involved");
    expect(list).not.toContain("/whats-on");
  });

  it("carries the Festive Ball item while the Ball is published, like every other page", async () => {
    state.gateOpen = true;
    expect(navList(await (await get("/get-involved/schools")).text())).toContain('href="/ball"');
  });

  it("does not while it is not", async () => {
    expect(navList(await (await get("/get-involved/schools")).text())).not.toContain('href="/ball"');
  });
});

describe("the footer on a short page", () => {
  it("sends Fundraise for us to the sign up while fundraising is on", async () => {
    expect(footer(await (await get("/get-involved/groups")).text())).toContain('<a href="/fundraise">Fundraise for us</a>');
  });

  it("sends it to the contact page while fundraising is off", async () => {
    state.fundraisingOn = false;
    expect(footer(await (await get("/get-involved/groups")).text())).toContain('<a href="/contact">Fundraise for us</a>');
  });
});

describe("the forwards at /volunteer and /referrals", () => {
  it.each([
    ["/volunteer", "https://vol.nbcc.scot"],
    ["/referrals", "https://referrals.nbcc.scot"],
  ])("%s still forwards through the spare address table", async (path, target) => {
    state.aliases = { [path]: target };
    const res = await get(path);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(target);
  });

  it.each(["/volunteer", "/referrals"])("%s stays free for a spare address, and is no page of ours", (path) => {
    expect(aliasFromProblem(path)).toBeNull();
    expect(RESERVED_PREFIXES).not.toContain(path);
    expect(isKnownPage(path)).toBe(false);
  });
});

describe("the site map", () => {
  it("knows every short page, with the name a visitor knows it by", () => {
    expect(SHORT_PAGES.map((p) => [p.path, p.title])).toEqual([
      ["/get-involved/drop-off-points", "Drop-off points"],
      ["/get-involved/referrals", "Referrals"],
      ["/get-involved/volunteer", "Volunteer"],
      ["/get-involved/business", "Your business"],
      ["/get-involved/schools", "Your school"],
      ["/get-involved/groups", "Your club or group"],
    ]);
  });

  it.each(PATHS)("%s is a page staff may point a spare address at, and no spare address can shadow", (path) => {
    expect(isKnownPage(path)).toBe(true);
    expect(aliasToProblem(path)).toBeNull();
    expect(aliasFromProblem(path)).toContain("/get-involved");
  });

  // These pages stay up with the events switch off, so they must stay on the map too: a page listed
  // only under Get involved would go when it goes.
  it("lists them with the events switch off as well as on", () => {
    for (const eventsOn of [true, false]) {
      const tree = renderSitemapTree(SITE_PAGES, false, eventsOn);
      const xml = renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), false, eventsOn);
      for (const path of PATHS) {
        expect(tree).toContain(`href="${path}"`);
        expect(xml).toContain(`<loc>https://nbcc.scot${path}</loc>`);
      }
    }
  });
});
