import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { readFileSync, readdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { seedWith } from "./helpers/events-seed";

// The moment: 20:00 UTC on Saturday 7 November 2026, when the Festive Ball's promotion comes down by
// itself. Nobody will be at a computer, so most of this file stands either side of it, through the
// real site router and the real Ball router, with the database mocked and the clock passed in.
// Every name and address here is invented.

const state = vi.hoisted(() => ({
  now: new Date("2026-11-01T12:00:00Z"),
  eventsOn: true,
  fundraisingOn: true,
  gateOpen: true,
  preview: false,
  settingsFail: false,
  events: [] as unknown[],
  writes: [] as string[],
}));

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "test",
    BALL_BASE_URL: "https://example.com",
    BALL_FROM_EMAIL: "ball@example.com",
    BALL_PREVIEW_PASSWORD: "an-invented-password",
    STRIPE_PUBLISHABLE_KEY: "",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ stripe: {}, stripeConfigured: false }));
vi.mock("../../src/clients/email", () => ({ sendBallRunUp: async () => undefined }));
vi.mock("../../src/db/ball-transfer", () => ({
  cancelReplacedCheckout: async () => undefined,
  getTransferSettings: async () => ({}),
  pendingCardSession: async () => null,
}));
vi.mock("../../src/db/ball", async (original) => {
  const real = await original<Record<string, unknown>>();
  // Every function in the module that can change anything shouts if it is called.
  const guarded: Record<string, unknown> = {};
  for (const name of Object.keys(real)) {
    guarded[name] = typeof real[name] === "function" ? () => { state.writes.push(name); throw new Error(`${name} must not be called`); } : real[name];
  }
  return {
    ...guarded,
    getSettings: async () => {
      if (state.settingsFail) throw new Error("no database");
      return { gateOpen: state.gateOpen, gateOpensAt: null };
    },
    getPreviewPasswordHash: async () => null,
    getBookingByGuestToken: async () => null,
    getBookingBySessionId: async () => null,
  };
});
vi.mock("../../src/db/events", () => ({
  getEventsSettings: async () => ({ pageOn: state.eventsOn }),
  eventsPageIsOn: async () => state.eventsOn,
  listPageEvents: async () => state.events,
}));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.fundraisingOn,
  listApprovedPublic: async () => [],
  getBySlug: async () => null,
  wallRows: async () => [],
}));
vi.mock("../../src/db/donations", () => ({ listPublicSupporters: async () => ({ bronze: [], silver: [], gold: [], platinum: [] }) }));
vi.mock("../../src/db/red-bag-lists", () => ({ loadPublishedRedBagList: async () => null, readRedBagDraft: async () => null }));
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: async () => c.BUILT_IN_CATEGORIES };
});
vi.mock("../../src/ball/preview-access", () => ({
  holdsPreviewCookie: async () => state.preview,
  previewSecret: () => "an-invented-secret",
}));

import { AFTER_BALL_AT, afterBall, showAfterBall } from "../../src/site/after-ball";
import { createSiteRouter } from "../../src/routes/site";
import { ballRouter } from "../../src/routes/ball";
import { renderHomePromo } from "../../src/ball/home-promo";
import { addBallNavLink } from "../../src/ball/nav-link";
import { addEventsNavLink } from "../../src/events/nav-link";
import { addMenuFit, addWhatsOnNavLink } from "../../src/events/whats-on-link";
import { addFundraiseFooterLink } from "../../src/fundraising/footer-link";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const navList = (html: string) => html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";

const BEFORE = new Date("2026-11-07T19:59:59Z");
const THE_MOMENT = new Date("2026-11-07T20:00:00Z");
const NEXT_DAY = new Date("2026-11-08T09:00:00Z");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(ballRouter); // first, as src/app.ts mounts it
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
  state.preview = false;
  state.settingsFail = false;
  state.events = [
    seedWith("festive-ball-2026", { date: "2026-11-07" }),
    seedWith("empowher-2026", { date: "2026-11-20" }),
  ];
  state.writes = [];
});

const get = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });
const body = async (path: string, init?: RequestInit) => (await get(path, init)).text();

describe("the clock", () => {
  it("is 20:00 UTC on Saturday 7 November 2026, which is 20:00 in the UK: the clocks have gone back", () => {
    expect(AFTER_BALL_AT.toISOString()).toBe("2026-11-07T20:00:00.000Z");
    expect(AFTER_BALL_AT.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit" })).toContain("Saturday");
    expect(AFTER_BALL_AT.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })).toBe("20:00");
  });

  it("stands either side of the moment, to the second and to the millisecond", () => {
    expect(afterBall(new Date("2026-11-07T19:59:59Z"))).toBe(false);
    expect(afterBall(new Date("2026-11-07T19:59:59.999Z"))).toBe(false);
    expect(afterBall(new Date("2026-11-07T20:00:00Z"))).toBe(true);
    expect(afterBall(new Date("2026-11-08T00:00:00Z"))).toBe(true);
    expect(afterBall(new Date("2030-01-01T00:00:00Z"))).toBe(true);
    expect(afterBall(new Date("2026-10-31T12:00:00Z"))).toBe(false);
  });

  it("reads a clock that makes no sense as before the moment: nothing comes down by accident", () => {
    expect(afterBall(new Date("not a date"))).toBe(false);
  });

  it("cannot be moved by changing the date it hands out", () => {
    const handedOut = new Date(AFTER_BALL_AT.getTime());
    AFTER_BALL_AT.setTime(0);
    try {
      expect(afterBall(BEFORE)).toBe(false);
    } finally {
      AFTER_BALL_AT.setTime(handedOut.getTime());
    }
  });

  it("takes the time as an argument and never reads the clock itself", () => {
    expect(read("src/site/after-ball.ts")).not.toContain("new Date()");
    expect(read("src/site/after-ball.ts")).not.toContain("Date.now");
  });

  it("is told the time by the route, once, at the edge", () => {
    const site = read("src/routes/site.ts");
    expect(site).toContain("opts.now ?? (() => new Date())");
  });
});

describe("?at=after-ball", () => {
  it("shows the after state, before the moment, only for exactly that value", () => {
    expect(showAfterBall(BEFORE, { at: "after-ball" })).toBe(true);
  });

  it("is safe with any query at all", () => {
    for (const query of [
      undefined,
      null,
      "after-ball",
      7,
      [],
      {},
      { at: undefined },
      { at: "" },
      { at: "after-balls" },
      { at: "AFTER-BALL" },
      { at: " after-ball" },
      { at: ["after-ball"] },
      { at: ["after-ball", "after-ball"] },
      { at: { after: "ball" } },
      { at: 1 },
      ["at", "after-ball"],
      Object.create(null),
    ]) {
      expect(showAfterBall(BEFORE, query)).toBe(false);
    }
  });

  it("makes no difference once the moment has passed", () => {
    expect(showAfterBall(THE_MOMENT, undefined)).toBe(true);
    expect(showAfterBall(THE_MOMENT, { at: "before" })).toBe(true);
    expect(showAfterBall(THE_MOMENT, { at: ["x"] })).toBe(true);
  });
});

describe("before the moment", () => {
  it("the home page has the banner, the feature and the Ball's menu item", async () => {
    const html = await body("/");
    expect(html).toContain('class="ball-banner"');
    expect(html).toContain("ball-home-feature");
    expect(navList(html)).toContain('href="/ball"');
  });

  it("the home page is exactly the Ball's own promotion on the file, and nothing else", async () => {
    const file = read("index.html");
    const expected = addFundraiseFooterLink(addMenuFit(addWhatsOnNavLink(addEventsNavLink(renderHomePromo(file, { gateOpen: true })))));
    expect(await body("/")).toBe(expected);
  });

  it("the home page with the gate shut is exactly the file and its menu items", async () => {
    state.gateOpen = false;
    const file = read("index.html");
    expect(await body("/")).toBe(addFundraiseFooterLink(addMenuFit(addWhatsOnNavLink(addEventsNavLink(file)))));
  });

  it("the home page with every switch off is the file, byte for byte", async () => {
    state.gateOpen = false;
    state.eventsOn = false;
    state.fundraisingOn = false;
    expect(await body("/")).toBe(read("index.html"));
  });

  it("a plain page is exactly the file and its menu items, with the Ball's item", async () => {
    const file = read("about.html");
    const html = await body("/about-us");
    expect(html).toBe(addFundraiseFooterLink(addMenuFit(addWhatsOnNavLink(addEventsNavLink(addBallNavLink(file))))));
    expect(navList(html)).toContain('href="/ball"');
  });

  it("a plain page with every switch off is the file, byte for byte", async () => {
    state.gateOpen = false;
    state.eventsOn = false;
    state.fundraisingOn = false;
    expect(await body("/about-us")).toBe(read("about.html"));
  });

  it("the Festive Ball card is on What's on and Get involved", async () => {
    expect(await body("/whats-on")).toContain('id="festive-ball-2026"');
    expect(await body("/get-involved")).toContain('id="festive-ball-2026"');
  });

  it("the Ball's item is on the pages drawn through the site's menu", async () => {
    for (const path of ["/whats-on", "/get-involved", "/get-involved/volunteer", "/supporters", "/fundraise", "/fill"]) {
      expect(navList(await body(path)), path).toContain('href="/ball"');
    }
  });

  it("the drop-off page offers what it offers today, and nothing about Fill a Red Bag", async () => {
    const html = await body("/get-involved/drop-off-points");
    expect(html).toContain("<p>You can still make a donation.</p>");
    expect(html).not.toContain("fill a Red Bag online");
    expect(html).not.toContain('href="/fill"');
  });

  it("holders of the preview cookie see the promotion, kept private, while the gate is shut", async () => {
    state.gateOpen = false;
    state.preview = true;
    const res = await get("/", { headers: { cookie: "nbcc_ball_preview=anything" } });
    const html = await res.text();
    expect(html).toContain("ball-home-feature");
    expect(navList(html)).toContain('href="/ball"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe.each([
  ["on the dot", THE_MOMENT],
  ["the next day", NEXT_DAY],
])("after the moment, %s", (_name, when) => {
  beforeEach(() => {
    state.now = when;
  });

  it("the home page has no banner, no feature, and no Ball item in the menu", async () => {
    const res = await get("/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("ball-banner");
    expect(html).not.toContain("ball-home-feature");
    expect(html).not.toContain('href="/ball"');
    expect(html).toContain("You know us at");
    expect(html).toContain("Where would you like to start?");
  });

  it("the home page keeps its other menu items and footer link", async () => {
    const html = await body("/");
    expect(navList(html)).toContain('href="/get-involved"');
    expect(navList(html)).toContain('href="/whats-on"');
    expect(html).toContain('<a href="/fundraise">Fundraise for us</a>');
  });

  it("a plain page has no Ball item, whatever the gate says", async () => {
    expect(navList(await body("/about-us"))).not.toContain('href="/ball"');
  });

  it("no page drawn through the site's menu has the Ball's item", async () => {
    for (const path of ["/whats-on", "/get-involved", "/get-involved/volunteer", "/get-involved/drop-off-points", "/supporters", "/fundraise", "/fill", "/fill/thank-you"]) {
      expect(navList(await body(path)), path).not.toContain('href="/ball"');
    }
  });

  it("the Festive Ball card is gone from What's on and Get involved, and the others stay", async () => {
    for (const path of ["/whats-on", "/get-involved"]) {
      const html = await body(path);
      expect(html, path).not.toContain('id="festive-ball-2026"');
      expect(html, path).toContain('id="empowher-2026"');
    }
  });

  it("holders of the preview cookie see what everyone sees, and it need not be kept private", async () => {
    state.gateOpen = false;
    state.preview = true;
    const res = await get("/", { headers: { cookie: "nbcc_ball_preview=anything" } });
    const html = await res.text();
    expect(html).not.toContain("ball-home-feature");
    expect(html).not.toContain('href="/ball"');
    expect(res.headers.get("cache-control")).not.toBe("private, no-store");
  });

  it("the home page does not need the Ball's settings at all", async () => {
    state.settingsFail = true;
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("ball-home-feature");
  });

  it("a plain page with every switch off carries no Ball item, and still answers", async () => {
    state.gateOpen = false;
    state.eventsOn = false;
    state.fundraisingOn = false;
    const res = await get("/about-us");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('href="/ball"');
  });

  it("the home page with every switch off still answers, with no Ball in it", async () => {
    state.gateOpen = false;
    state.eventsOn = false;
    state.fundraisingOn = false;
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("ball-banner");
  });

  it("/ball stays on the site map and the feed, because the gate is what governs those", async () => {
    expect(await body("/sitemap")).toContain('href="/ball"');
    expect(await body("/sitemap.xml")).toContain("https://nbcc.scot/ball");
  });

  it("the site map still leaves /ball out while the gate is shut", async () => {
    state.gateOpen = false;
    expect(await body("/sitemap")).not.toContain('href="/ball"');
    expect(await body("/sitemap.xml")).not.toContain("https://nbcc.scot/ball");
  });

  it("the file behind the home page is never changed", async () => {
    await get("/");
    expect(read("index.html")).not.toContain("ball-home-feature");
  });
});

describe("the Ball's own pages do not know the moment exists", () => {
  // Ball pages are served by src/routes/ball.ts, which draws its own menu (decorateBallPage).
  const PAGES = ["/ball", "/ball/terms", "/ball/donate", "/ball/thank-you", "/ball/guests/an-invented-token"];

  const answer = async (path: string) => {
    const res = await get(path);
    return { status: res.status, location: res.headers.get("location"), type: res.headers.get("content-type"), body: await res.text() };
  };

  it.each(PAGES)("%s answers byte for byte the same either side", async (path) => {
    state.now = BEFORE;
    const before = await answer(path);
    state.now = THE_MOMENT;
    expect(await answer(path)).toEqual(before);
    state.now = NEXT_DAY;
    expect(await answer(path)).toEqual(before);
  });

  it("really is answering, not failing the same way twice", async () => {
    state.now = NEXT_DAY;
    expect((await get("/ball")).status).toBe(200);
    expect((await get("/ball/terms")).status).toBe(200);
    // /ball/donate reads the real clock, not the one passed in here, and from the day after the Ball it
    // forwards to /donate: so only for this page, this test stands on a day the page is up.
    vi.useFakeTimers({ toFake: ["Date"], now: BEFORE });
    try {
      const donate = await get("/ball/donate");
      expect(donate.status).toBe(200);
      expect(await donate.text()).toContain("Festive Ball");
    } finally {
      vi.useRealTimers();
    }
    expect(await (await get("/ball/guests/an-invented-token")).text()).toContain("<html");
  });

  it("keeps the Festive Ball item in the Ball page's own menu after the moment", async () => {
    state.now = NEXT_DAY;
    const res = await get("/ball");
    expect(res.status).toBe(200);
    expect(navList(await res.text())).toContain('href="/ball"');
  });

  it("no Ball file mentions the moment", () => {
    const files = ["src/routes/ball.ts", ...readdirSync(resolve(ROOT, "src/ball")).map((f) => `src/ball/${f}`)];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toContain("after-ball");
      expect(source, file).not.toContain("afterBall");
    }
  });
});

describe("the admin's Ball switch", () => {
  it("is never written, either side of the moment", async () => {
    for (const when of [BEFORE, THE_MOMENT, NEXT_DAY]) {
      state.now = when;
      for (const path of ["/", "/about-us", "/whats-on", "/get-involved", "/sitemap", "/sitemap.xml", "/ball", "/?at=after-ball"]) await get(path);
    }
    expect(state.writes).toEqual([]);
  });

  it("is asked the same question it always was: the gate's own rule is not touched", () => {
    const site = read("src/routes/site.ts");
    expect(site).toContain("if (isGateOpen(await getSettings(), new Date())) return true;");
    expect(site).not.toMatch(/updateSettings|gateOpen\s*=\s*false/);
  });
});

describe("?at=after-ball, through the pages", () => {
  const NAMED = ["/", "/whats-on", "/get-involved", "/get-involved/drop-off-points", "/fill"];

  it.each(NAMED)("%s shows the after state for that view", async (path) => {
    const html = await body(`${path}?at=after-ball`);
    expect(navList(html)).not.toContain('href="/ball"');
    expect(html).not.toContain("ball-home-feature");
    expect(html).not.toContain('id="festive-ball-2026"');
  });

  it.each(NAMED)("%s goes straight back on the next plain view", async (path) => {
    await get(`${path}?at=after-ball`);
    expect(navList(await body(path))).toContain('href="/ball"');
  });

  it.each(NAMED)("%s carries no search listing and is not kept", async (path) => {
    const res = await get(`${path}?at=after-ball`);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(NAMED)("%s has neither on a plain view", async (path) => {
    const res = await get(path);
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(res.headers.get("cache-control")).not.toBe("private, no-store");
  });

  it.each([
    "?at=after-ball&at=after-ball",
    "?at[]=after-ball",
    "?at[x]=after-ball",
    "?at=",
    "?at=after-balls",
    "?AT=after-ball",
    "?at=after%2Dball%00",
  ])("the home page ignores %s and stays as it is", async (query) => {
    const res = await get(`/${query}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ball-home-feature");
  });

  it.each(["/about-us", "/supporters", "/fundraise", "/get-involved/volunteer", "/fill/thank-you"])("%s is not one of the pages named, so it stays as it is", async (path) => {
    expect(navList(await body(`${path}?at=after-ball`))).toContain('href="/ball"');
  });

  it("works with the gate shut and with a database that cannot answer for the Ball", async () => {
    state.gateOpen = false;
    state.settingsFail = true;
    const res = await get("/?at=after-ball");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Where would you like to start?");
  });
});
