import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// How the Fill a Red Bag stage, and the links that come with it, reach the pages either side of the
// Ball's moment: through the real site router and the real Ball page decoration, with the database
// mocked and the clock passed in. The stage itself is in red-bag-stage.test.ts. Every name and
// address here is invented.

const state = vi.hoisted(() => ({
  now: new Date("2026-11-01T12:00:00Z"),
  eventsOn: true,
  fundraisingOn: true,
  gateOpen: true,
  live: true,
  list: null as unknown,
  listFails: false,
  listCalls: 0,
}));

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => ({ gateOpen: state.gateOpen, gateOpensAt: null }),
  getPreviewPasswordHash: async () => null,
}));
vi.mock("../../src/db/events", () => ({
  getEventsSettings: async () => ({ pageOn: state.eventsOn }),
  listPageEvents: async () => [],
}));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.fundraisingOn,
  listApprovedPublic: async () => [],
  getBySlug: async () => null,
  wallRows: async () => [],
}));
vi.mock("../../src/db/donations", () => ({ listPublicSupporters: async () => ({ bronze: [], silver: [], gold: [], platinum: [] }) }));
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: async () => c.BUILT_IN_CATEGORIES };
});
vi.mock("../../src/db/red-bag-lists", () => ({
  loadPublishedRedBagList: async () => {
    state.listCalls += 1;
    if (state.listFails) throw new Error("no database");
    return state.list;
  },
  readRedBagDraft: async () => null,
}));
vi.mock("../../src/ball/preview-access", () => ({ holdsPreviewCookie: async () => false }));
vi.mock("../../src/red-bag/switch", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  redBagIsLive: () => state.live,
}));

import { createSiteRouter } from "../../src/routes/site";
import { decorateBallPage } from "../../src/ball/page-decor";
import { addFillFooterLink, addFillToDropOff, FILL_FOOTER_ITEM } from "../../src/red-bag/fill-links";
import { addFillStageStyles, addFillStageToHome, renderFillStage, STAGE_STYLES } from "../../src/red-bag/stage";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const rules = createRequire(import.meta.url)(resolve(ROOT, "assets/js/red-bag-list.js"));
const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
const waysToGive = (html: string) => footer(html).match(/<h4>Ways to give<\/h4>[\s\S]*?<\/ul>/)?.[0] ?? "";
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const BEFORE = new Date("2026-11-07T19:59:59Z");
const AFTER = new Date("2026-11-07T20:00:00Z");

const STAGE = 'id="fillBand"';
const STAGE_SCRIPT = "/assets/js/red-bag-stage.js";
const STAGE_CSS = "/assets/css/red-bag-stage.css";

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
  state.now = BEFORE;
  state.eventsOn = true;
  state.fundraisingOn = true;
  state.gateOpen = true;
  state.live = true;
  state.list = null;
  state.listFails = false;
  state.listCalls = 0;
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });
const body = async (path: string) => (await get(path)).text();

describe("before the moment", () => {
  it.each(["/", "/get-involved", "/whats-on", "/about-us", "/get-involved/drop-off-points"])("%s has nothing of the stage, and nothing is read for it", async (path) => {
    const html = await body(path);
    expect(html).not.toContain(STAGE);
    expect(html).not.toContain(STAGE_SCRIPT);
    expect(html).not.toContain(STAGE_CSS);
    expect(html).not.toContain("rb-list-data");
    expect(html).not.toContain("Fill a Red Bag");
    expect(state.listCalls).toBe(0);
  });

  it("the home page's own file does not know about the stage", () => {
    const home = read("index.html");
    expect(home).not.toContain("fillBand");
    expect(home).not.toContain("red-bag-stage");
  });

  it("the Get involved page's marker leaves no trace", async () => {
    expect(await body("/get-involved")).not.toContain("getinvolved:fill-stage");
  });
});

describe("the stage on the home page", () => {
  beforeEach(() => {
    state.now = AFTER;
  });

  it("sits between the hero and the four tags, once", async () => {
    const html = await body("/");
    expect(count(html, STAGE)).toBe(1);
    expect(html.indexOf('class="hero"')).toBeLessThan(html.indexOf(STAGE));
    expect(html.indexOf(STAGE)).toBeLessThan(html.indexOf('<section class="home-lane"'));
  });

  it("brings its styles and script, in the right places, once", async () => {
    const html = await body("/");
    expect(count(html, STAGE_CSS)).toBe(1);
    expect(html.indexOf(STAGE_CSS)).toBeLessThan(html.indexOf("</head>"));
    expect(count(html, STAGE_SCRIPT)).toBe(1);
    expect(count(html, "/assets/js/red-bag-catalogue.js")).toBe(1);
    expect(html.indexOf("/assets/js/red-bag-catalogue.js")).toBeLessThan(html.indexOf(STAGE_SCRIPT));
  });

  it("reads the list published last, at its prices", async () => {
    const list = rules.builtIn();
    list.items.find((i: { key: string }) => i.key === "toy").pence = 1234;
    state.list = list;
    const html = await body("/");
    const data = JSON.parse(html.match(/<script type="application\/json" id="rb-list-data">([\s\S]*?)<\/script>/)![1]);
    expect(data.groups.find((g: { key: string }) => g.key === "play").items.find((i: { key: string }) => i.key === "toy").pence).toBe(1234);
  });

  it("leaves out an item staff have hidden", async () => {
    const list = rules.builtIn();
    list.items.find((i: { key: string }) => i.key === "socks").hidden = true;
    state.list = list;
    expect(await body("/")).not.toContain('"key":"socks"');
  });

  it("uses the catalogue's list, as /fill does, when nothing has been published", async () => {
    const html = await body("/");
    expect(html).toContain(STAGE);
    expect(html).not.toContain("rb-list-data");
  });

  it("is left out if its list cannot be read, and the page is otherwise whole", async () => {
    state.listFails = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await get("/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain(STAGE);
    expect(html).not.toContain(STAGE_CSS);
    expect(html).not.toContain(STAGE_SCRIPT);
    expect(html).toContain("Where would you like to start?");
    expect(html).toContain('href="/whats-on"');
    expect(html).toContain('<a href="/fundraise">Fundraise for us</a>');
    expect(html).not.toContain("ball-banner");
    logged.mockRestore();
  });

  it("is left out if it cannot be drawn: a list that is not a list", async () => {
    state.list = { nonsense: true, items: "no" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Where would you like to start?");
    logged.mockRestore();
  });

  it("is left out while Fill a Red Bag is switched off, because /fill is then a 404", async () => {
    state.live = false;
    const html = await body("/");
    expect(html).not.toContain(STAGE);
    expect(footer(html)).not.toContain('href="/fill"');
  });

  it("is there with the events switch and fundraising both off", async () => {
    state.eventsOn = false;
    state.fundraisingOn = false;
    expect(await body("/")).toContain(STAGE);
  });
});

describe("the stage on Get involved", () => {
  beforeEach(() => {
    state.now = AFTER;
  });

  it("comes after What's on and before the ways to help together, once", async () => {
    const html = await body("/get-involved");
    expect(count(html, STAGE)).toBe(1);
    expect(html.indexOf("See everything that&rsquo;s on")).toBeLessThan(html.indexOf(STAGE));
    expect(html.indexOf(STAGE)).toBeLessThan(html.indexOf("Coming as a business, school or group?"));
  });

  it("brings its styles and script", async () => {
    const html = await body("/get-involved");
    expect(html.indexOf(STAGE_CSS)).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain(STAGE_SCRIPT);
  });

  it("is left out if its list cannot be read, and the page still answers", async () => {
    state.listFails = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await get("/get-involved");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain(STAGE);
    expect(html).not.toContain(STAGE_CSS);
    expect(html).toContain("Coming as a business, school or group?");
    logged.mockRestore();
  });

  it("is still the 404 with the events switch off", async () => {
    state.eventsOn = false;
    expect((await get("/get-involved")).status).toBe(404);
  });

  it("is not on What's on", async () => {
    expect(await body("/whats-on")).not.toContain(STAGE);
  });
});

describe("?at=after-ball", () => {
  it.each(["/", "/get-involved"])("shows the stage on %s, for that view only", async (path) => {
    expect(await body(`${path}?at=after-ball`)).toContain(STAGE);
    expect(await body(path)).not.toContain(STAGE);
  });

  it("does nothing for a value that is not exactly right", async () => {
    expect(await body("/?at[]=after-ball")).not.toContain(STAGE);
    expect(await body("/?at=after-ball&at=after-ball")).not.toContain(STAGE);
  });
});

describe("the footer's Fill a Red Bag", () => {
  const PAGES = ["/", "/about-us", "/whats-on", "/get-involved", "/get-involved/volunteer", "/supporters", "/fundraise", "/sitemap", "/fill"];

  it.each(PAGES)("is not on %s before the moment", async (path) => {
    expect(footer(await body(path))).not.toContain('href="/fill"');
  });

  it.each(PAGES)("is on %s after it, under Ways to give, once", async (path) => {
    state.now = AFTER;
    const html = await body(path);
    expect(waysToGive(html)).toContain(FILL_FOOTER_ITEM);
    expect(count(footer(html), 'href="/fill"')).toBe(1);
  });

  it("comes straight after Donate money", async () => {
    state.now = AFTER;
    const list = waysToGive(await body("/about-us"));
    expect(list.indexOf("Donate money")).toBeLessThan(list.indexOf("Fill a Red Bag"));
    expect(list.indexOf("Fill a Red Bag")).toBeLessThan(list.indexOf("Donate items"));
  });

  it("is on a plain page with every switch off", async () => {
    state.now = AFTER;
    state.gateOpen = false;
    state.eventsOn = false;
    state.fundraisingOn = false;
    expect(waysToGive(await body("/about-us"))).toContain(FILL_FOOTER_ITEM);
  });

  it("is on the view that asks for it, on a page the spec names", async () => {
    expect(waysToGive(await body("/whats-on?at=after-ball"))).toContain(FILL_FOOTER_ITEM);
    expect(waysToGive(await body("/about-us?at=after-ball"))).not.toContain(FILL_FOOTER_ITEM);
  });

  it("is never on a Ball page: they draw their own footer", () => {
    for (const file of ["ball.html", "ball-terms.html", "ball-donate.html"]) {
      expect(decorateBallPage(read(file), { ballItem: true, eventsOn: true, fundraisingOn: true })).not.toContain(FILL_FOOTER_ITEM);
    }
  });

  it("is not in the footers on file, so a Ball page cannot have it by accident", () => {
    expect(read("partials/footer.html")).not.toContain('href="/fill"');
  });

  it("is safe to add twice", () => {
    const html = read("about.html");
    expect(addFillFooterLink(addFillFooterLink(html))).toBe(addFillFooterLink(html));
  });

  it("only touches the footer's list", () => {
    const html = read("about.html");
    const out = addFillFooterLink(html);
    expect(out.replace(FILL_FOOTER_ITEM, "").replace(/\s+/g, "")).toBe(html.replace(/\s+/g, ""));
  });

  it("leaves a page with no such list as it was", () => {
    for (const html of ["<main>No footer</main>", "<footer><h4>Explore</h4><ul><li>x</li></ul></footer>", "<h4>Ways to give</h4><ul><li>outside a footer</li></ul>"]) {
      expect(addFillFooterLink(html)).toBe(html);
    }
  });
});

describe("Can't get to a drop-off point?", () => {
  const PATH = "/get-involved/drop-off-points";
  const NEW_WORDS = "You can still fill a Red Bag online, or make a donation.";

  it("offers Donate alone before the moment, and the page is otherwise its file with the menu", async () => {
    const html = await body(PATH);
    expect(html).toContain("<p>You can still make a donation.</p>");
    expect(html).not.toContain(NEW_WORDS);
  });

  it("also offers Fill a Red Bag after it, in the agreed words", async () => {
    state.now = AFTER;
    const html = await body(PATH);
    expect(html).toContain(`<p>${NEW_WORDS}</p>`);
    expect(html).not.toContain("<p>You can still make a donation.</p>");
    const row = html.slice(html.indexOf(NEW_WORDS)).match(/<div class="row">[\s\S]*?<\/div>/)![0];
    expect(row).toContain('<a class="btn paper" href="/fill">Fill a Red Bag</a>');
    expect(row).toContain('href="/donate">Donate</a>');
  });

  it("changes nothing else on the page", () => {
    const file = read("get-involved-drop-off-points.html");
    const lines = (s: string) => s.split(/\r?\n/);
    const before = lines(file);
    const after = lines(addFillToDropOff(file));
    expect(after).toHaveLength(before.length);
    expect(before.filter((line, i) => line !== after[i])).toHaveLength(2);
  });

  it("shows the after state for ?at=after-ball, for that view only", async () => {
    expect(await body(`${PATH}?at=after-ball`)).toContain(NEW_WORDS);
    expect(await body(PATH)).not.toContain(NEW_WORDS);
  });

  it("stays as it is while Fill a Red Bag is switched off", async () => {
    state.now = AFTER;
    state.live = false;
    expect(await body(PATH)).not.toContain(NEW_WORDS);
  });

  it("is on the drop-off page alone", async () => {
    state.now = AFTER;
    expect(await body("/get-involved/volunteer")).not.toContain(NEW_WORDS);
  });
});

describe("the helpers that place it", () => {
  it("leaves the home page alone with no stage to place", () => {
    const home = read("index.html");
    expect(addFillStageToHome(home, "")).toBe(home);
  });

  it("leaves a page with no place for the stage alone", () => {
    expect(addFillStageToHome("<head></head><main></main>", renderFillStage(null))).toBe("<head></head><main></main>");
  });

  it("adds the styles once", () => {
    const one = addFillStageStyles("<head></head>");
    expect(addFillStageStyles(one)).toBe(one);
    expect(one).toContain(STAGE_STYLES);
  });

  it("does not read a replacement pattern in anything drawn in", () => {
    const stage = "<p>$&amp;$'</p>";
    expect(addFillStageToHome('<head></head><section class="home-lane">', stage)).toContain(stage);
  });
});

describe("the stage's files are extra, so no budgeted page pays for them", () => {
  it("is in no page's file", () => {
    for (const file of ["index.html", "donate.html", "get-involved.html", "about.html"]) {
      expect(read(file), file).not.toContain("red-bag-stage");
    }
  });
});
