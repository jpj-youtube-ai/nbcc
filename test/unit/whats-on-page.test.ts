import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// What's on: today's events and fundraisers page, at its own address, /whats-on. Not /events: that
// address has answered 301 since TASK-494, a browser keeps a 301 for good, and anyone who followed it
// would never reach the page. Driven through the real site router with the database mocked. Every
// name and address here is invented.

const state = vi.hoisted(() => ({
  eventsOn: true,
  fundraisingOn: true,
  gateOpen: false,
  fundraisers: [] as unknown[],
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
  listApprovedPublic: async () => state.fundraisers,
  getBySlug: async () => null,
  wallRows: async () => [],
}));
vi.mock("../../src/db/donations", () => ({ listPublicSupporters: async () => ({ bronze: [], silver: [], gold: [], platinum: [] }) }));
vi.mock("../../src/ball/preview-access", () => ({ holdsPreviewCookie: async () => false }));
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: async () => c.BUILT_IN_CATEGORIES };
});

import { createSiteRouter } from "../../src/routes/site";
import { addEventsNavLink } from "../../src/events/nav-link";
import { addWhatsOnNavLink, WHATS_ON_NAV_ITEM } from "../../src/events/whats-on-link";
import { decorateBallPage } from "../../src/ball/page-decor";
import { RESERVED_PREFIXES, SITE_PAGES, aliasFromProblem, renderSitemapTree, renderSitemapXml } from "../../src/site/pages";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const navList = (html: string) => html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";
const hrefs = (list: string) => [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";

function fundraiser(over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter> } {
  return {
    id: 7,
    slug: "robins-santa-dash",
    path: "raising",
    kind: "santa_dash",
    title: "Robin's Santa Dash",
    description: "Five kilometres in a red suit.",
    eventDate: null,
    startTime: null,
    venue: "",
    town: "Exampleton",
    targetPence: 25000,
    public: true,
    status: "approved",
    name: "Robin Quill",
    email: "robin.quill@example.com",
    phone: "07700 900111",
    socialLink: null,
    socialOk: false,
    wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: "1 Example Road, Exampleton",
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    approvedAt: "2026-10-01T10:00:00.000Z",
    approvedBy: "admin:staff@example.com",
    updatedAt: "2026-10-01T10:00:00.000Z",
    updatedBy: null,
    meter: meter({ onlinePence: 12500, cashPence: 0, targetPence: 25000 }),
    ...over,
  };
}

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
  state.fundraisers = [fundraiser()];
  state.aliases = {};
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("the page at /whats-on", () => {
  it("is today's page: the deck, the chips, the panel, and its heading", async () => {
    const res = await get("/whats-on");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-deck');
    expect(html).toContain("data-chips");
    expect(html).toContain('id="fundraise-panel"');
    expect(html).toContain("Robin&#39;s Santa Dash");
    expect(html).toContain('<h1 id="events-heading">Join in, or raise money your way.</h1>');
  });

  it("is kept fresh, like the page it was", async () => {
    expect((await get("/whats-on")).headers.get("cache-control")).toBe("public, max-age=0");
  });

  it("has no film: that moved to Get involved, so it never plays in two places", async () => {
    const html = await (await get("/whats-on")).text();
    expect(html).not.toContain("<video");
    expect(html).not.toContain("data-film");
    expect(html).not.toContain("nbcc-film-seen");
    expect(html).not.toContain("get-involved-film");
  });

  it("has its own title, canonical address and label", async () => {
    const html = await (await get("/whats-on")).text();
    expect(html).toContain("<title>What's on | Night Before Christmas Campaign</title>");
    expect(html).toContain('<link rel="canonical" href="https://nbcc.scot/whats-on" />');
    expect(html).toContain('<meta property="og:url" content="https://nbcc.scot/whats-on" />');
    expect(html).toContain('<span class="eyebrow">What&rsquo;s on</span>');
    expect(html).not.toContain('<span class="eyebrow">Get involved</span>');
  });

  it("marks What's on, not Get involved, as the page you are on", async () => {
    const nav = navList(await (await get("/whats-on")).text());
    expect(nav).toContain('<a href="/whats-on" class="active" aria-current="page">What\'s on</a>');
    expect(nav).toContain('<a href="/get-involved">Get involved</a>');
  });

  it("ends with a line to everything else you can do", async () => {
    const html = await (await get("/whats-on")).text();
    const line = html.slice(html.indexOf("Looking for other ways to help?"));
    expect(line).toMatch(/^Looking for other ways to help\?<\/b> <a href="\/get-involved">See everything you can do<\/a>/);
    expect(html.indexOf("Looking for other ways to help?")).toBeGreaterThan(html.indexOf('id="fundraise-panel"'));
    expect(html.indexOf("Looking for other ways to help?")).toBeLessThan(html.indexOf("</main>"));
  });

  it("with fundraising off shows the events and nothing about fundraising", async () => {
    state.fundraisingOn = false;
    const res = await get("/whats-on");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("Robin&#39;s Santa Dash");
    expect(html).not.toContain("data-chips");
    expect(html).not.toContain('href="/fundraise"');
    expect(html).toContain("Looking for other ways to help?");
  });

  it("is a 404 while the events switch is off", async () => {
    state.eventsOn = false;
    const res = await get("/whats-on");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await res.text()).not.toContain("Join in, or raise money your way.");
  });

  it("never serves the raw file at its own address", async () => {
    expect((await get("/whats-on.html")).status).not.toBe(200);
  });
});

describe("the old addresses", () => {
  it("/events goes to What's on, keeping its query string", async () => {
    const res = await get("/events?utm_source=x&month=december");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/whats-on?utm_source=x&month=december");
  });

  it("/events goes there without one too", async () => {
    const res = await get("/events");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/whats-on");
  });

  it.each(["/getinvolved", "/involved"])("%s still goes to Get involved", async (path) => {
    const res = await get(`${path}?utm_source=poster`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/get-involved?utm_source=poster");
  });

  it("Get involved is still the 404 while the events switch is off", async () => {
    state.eventsOn = false;
    expect((await get("/get-involved")).status).toBe(404);
  });
});

describe("the forwards at /volunteer and /referrals", () => {
  it.each(["/volunteer", "/referrals"])("%s is no page of ours, so a spare address may keep it", (path) => {
    expect(aliasFromProblem(path)).toBeNull();
    expect(RESERVED_PREFIXES).not.toContain(path);
  });

  it.each([
    ["/volunteer", "https://volunteer.nbcc.scot"],
    ["/referrals", "https://referrals.nbcc.scot"],
  ])("%s still forwards through the spare address table", async (path, target) => {
    state.aliases = { [path]: target };
    const res = await get(path);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(target);
  });
});

describe("the What's on item in the menu", () => {
  const contact = () => addEventsNavLink(read("contact.html"));

  it("goes straight after Get involved", () => {
    expect(hrefs(navList(addWhatsOnNavLink(contact())))).toEqual(["/", "/about-us", "/get-involved", "/whats-on", "/donate", "/contact", "/supporters"]);
  });

  it("reads What's on", () => {
    expect(WHATS_ON_NAV_ITEM).toBe('<li><a href="/whats-on">What\'s on</a></li>');
  });

  it("is added once however many times it runs", () => {
    const once = addWhatsOnNavLink(contact());
    expect(addWhatsOnNavLink(once)).toBe(once);
    expect(once.split(WHATS_ON_NAV_ITEM)).toHaveLength(2);
  });

  it("changes nothing when there is no Get involved item", () => {
    const page = read("contact.html");
    expect(addWhatsOnNavLink(page)).toBe(page);
  });

  it("changes nothing on a page with no menu", () => {
    const hub = read("hub.html");
    expect(addWhatsOnNavLink(hub)).toBe(hub);
  });

  it("finds a Get involved item marked as the current page", () => {
    const active = contact().replace('<a href="/get-involved">', '<a href="/get-involved" class="active" aria-current="page">');
    expect(hrefs(navList(addWhatsOnNavLink(active)))).toEqual(["/", "/about-us", "/get-involved", "/whats-on", "/donate", "/contact", "/supporters"]);
  });

  it("keeps the indentation and line endings of the file", () => {
    const lf = addWhatsOnNavLink(contact().replace(/\r\n/g, "\n"));
    expect(lf).toMatch(/\n( *)<li><a href="\/get-involved">Get involved<\/a><\/li>\n\1<li><a href="\/whats-on">What's on<\/a><\/li>\n/);
    const crlf = addWhatsOnNavLink(contact().replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
    expect(crlf).toMatch(/\n( *)<li><a href="\/get-involved">Get involved<\/a><\/li>\r\n\1<li><a href="\/whats-on">What's on<\/a><\/li>\r\n/);
  });

  it("never touches the footer", () => {
    expect(footer(addWhatsOnNavLink(contact()))).toBe(footer(contact()));
  });

  it.each(["/contact", "/supporters", "/about-us", "/fundraise", "/get-involved", "/"])("%s offers it while the events switch is on", async (path) => {
    const nav = hrefs(navList(await (await get(path)).text()));
    expect(nav.indexOf("/whats-on")).toBe(nav.indexOf("/get-involved") + 1);
  });

  it("the home page offers it with the Ball's promotion up too", async () => {
    state.gateOpen = true;
    const nav = hrefs(navList(await (await get("/")).text()));
    expect(nav).toEqual(["/", "/about-us", "/get-involved", "/whats-on", "/donate", "/contact", "/supporters", "/ball"]);
  });

  it.each(["/contact", "/supporters", "/fundraise", "/"])("%s does not offer it while the events switch is off", async (path) => {
    state.eventsOn = false;
    expect(await (await get(path)).text()).not.toContain('href="/whats-on"');
  });

  it("stays off Ball pages, which keep their old menu", () => {
    const out = decorateBallPage(read("ball.html"), { ballItem: true, eventsOn: true, fundraisingOn: true });
    expect(out).toContain('href="/get-involved"');
    expect(out).not.toContain('href="/whats-on"');
  });
});

describe("the site's page list", () => {
  it("reserves the address, so no spare address can shadow it", () => {
    expect(RESERVED_PREFIXES).toContain("/whats-on");
    expect(aliasFromProblem("/whats-on")).toMatch(/already in use/);
  });

  it("lists the page on the site maps only while the events switch is on", () => {
    expect(SITE_PAGES.find((p) => p.path === "/whats-on")).toMatchObject({ title: "What's on", listedByDefault: true, eventsGated: true });
    expect(renderSitemapTree(SITE_PAGES, false, true, false)).toContain('href="/whats-on"');
    expect(renderSitemapTree(SITE_PAGES, false, false, false)).not.toContain('href="/whats-on"');
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), false, true, false)).toContain("https://nbcc.scot/whats-on</loc>");
    expect(renderSitemapXml(SITE_PAGES, "https://nbcc.scot", new Map(), false, false, false)).not.toContain("/whats-on</loc>");
  });

  it("goes after Get involved", () => {
    const paths = SITE_PAGES.map((p) => p.path);
    expect(paths.indexOf("/whats-on")).toBe(paths.indexOf("/get-involved") + 1);
  });
});

describe("the image", () => {
  it("ships the page", () => {
    const copy = read("Dockerfile").split(/\r?\n/).find((l) => l.startsWith("COPY index.html")) ?? "";
    expect(copy.split(/\s+/)).toContain("whats-on.html");
    expect(copy.split(/\s+/)).not.toContain("events.html");
  });
});
