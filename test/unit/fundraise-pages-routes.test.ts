import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// TASK-494: the routes behind Get involved and the public fundraising pages, driven through the real
// site router with the database mocked. What is checked: /events goes to /get-involved for good
// (with its query string), the menu says Get involved, nothing about fundraising shows while it is
// switched off, and anything that is not an approved, public, raising money fundraiser is a 404.
// Every name and address here is invented.

const state = vi.hoisted(() => ({
  eventsOn: true,
  fundraisingOn: true,
  fundraisers: [] as unknown[],
  wall: [] as unknown[],
  gift: null as unknown,
  giftFails: false,
}));

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => {
    throw new Error("no database in unit tests");
  },
}));
vi.mock("../../src/db/events", () => ({
  getEventsSettings: async () => ({ pageOn: state.eventsOn }),
  listPageEvents: async () => [],
}));
vi.mock("../../src/db/site-pages", () => ({
  resolveAlias: async () => null,
  getSeoOverrides: async () => new Map(),
}));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.fundraisingOn,
  listApprovedPublic: async () => state.fundraisers,
  getBySlug: async (slug: string) => (state.fundraisers as FundraiserRecord[]).find((f) => f.slug === slug) ?? null,
  wallRows: async () => state.wall,
  giftForSession: async () => {
    if (state.giftFails) throw new Error("database down");
    return state.gift;
  },
}));
vi.mock("../../src/fundraising/send", () => ({
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
}));
// TASK-506: the page's news (tested in fundraiser-page-news-route.test.ts); none here.
vi.mock("../../src/db/fundraiser-updates", () => ({ approvedForPage: async () => [] }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

function record(over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter> } {
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
  state.fundraisers = [record()];
  state.wall = [];
  state.gift = null;
  state.giftFails = false;
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });
const navList = (html: string) => html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)?.[0] ?? "";

describe("the old Events address", () => {
  it("goes to Get involved for good, keeping its query string", async () => {
    const res = await get("/events?utm_source=newsletter&month=december");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/get-involved?utm_source=newsletter&month=december");
  });

  it("goes there even without one", async () => {
    const res = await get("/events");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/get-involved");
  });
});

describe("the easy to type addresses", () => {
  // Said aloud, on a poster or on the radio, people type it without the dash, or just "involved".
  for (const path of ["/getinvolved", "/involved", "/GetInvolved", "/getinvolved/"]) {
    it(`${path} goes to Get involved for good`, async () => {
      const res = await get(path);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/get-involved");
    });
  }

  it("keeps the query string, so poster and radio tags still count", async () => {
    const res = await get("/involved?utm_source=poster");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/get-involved?utm_source=poster");
  });
});

describe("Get involved", () => {
  it("is a 404 while the events page is switched off", async () => {
    state.eventsOn = false;
    expect((await get("/get-involved")).status).toBe(404);
  });

  it("shows the fundraisers, the chips and the panel while fundraising is on", async () => {
    const html = await (await get("/get-involved")).text();
    expect(html).toContain("Robin&#39;s Santa Dash");
    expect(html).toContain("data-chips");
    expect(html).toContain('id="fundraise-panel"');
    // Nothing private ever reaches the page.
    expect(html).not.toContain("robin.quill@example.com");
    expect(html).not.toContain("07700 900111");
    expect(html).not.toContain("Example Road");
  });

  it("shows nothing about fundraising while it is switched off", async () => {
    state.fundraisingOn = false;
    const html = await (await get("/get-involved")).text();
    expect(html).not.toContain("Robin&#39;s Santa Dash");
    expect(html).not.toContain("data-chips");
    expect(html).not.toContain('href="/fundraise"');
  });

  it("leaves out a fundraiser that is not approved or not public", async () => {
    state.fundraisers = [record({ status: "new" }), record({ slug: "private-one", title: "Private One", public: false })];
    const html = await (await get("/get-involved")).text();
    expect(html).not.toContain("Robin&#39;s Santa Dash");
    expect(html).not.toContain("Private One");
  });
});

describe("the menu on every page", () => {
  it("reads Get involved, linking the new address, while the events page is on", async () => {
    const nav = navList(await (await get("/contact")).text());
    expect(nav).toContain('<a href="/get-involved">Get involved</a>');
    expect(nav).not.toContain(">Events<");
  });

  it("is on the fundraising pages too", async () => {
    expect(navList(await (await get("/fundraise")).text())).toContain('href="/get-involved"');
    expect(navList(await (await get("/fundraise/robins-santa-dash")).text())).toContain('href="/get-involved"');
  });
});

describe("the sign up page", () => {
  it("shows the form while fundraising is on", async () => {
    const res = await get("/fundraise");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/data-fundraise-open>/);
  });

  it("keeps an invite link's token from leaving in a referrer, and out of any cache", async () => {
    const res = await get("/fundraise?invite=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ");
    expect(res.status).toBe(200);
    // Only ever the origin, never the address with its token, to anyone, our own pages included.
    expect(res.headers.get("referrer-policy")).toBe("strict-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await res.text()).toMatch(/data-fundraise-open>/);
  });

  it("leaves the plain sign up page's headers as they were", async () => {
    const res = await get("/fundraise");
    expect(res.headers.get("referrer-policy")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("public, max-age=0");
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("says it is not open yet while fundraising is off, rather than vanishing", async () => {
    state.fundraisingOn = false;
    const res = await get("/fundraise");
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/data-fundraise-open hidden>/);
  });
});

describe("a fundraiser's page", () => {
  it("is there for an approved, public, raising money fundraiser while fundraising is on", async () => {
    const res = await get("/fundraise/robins-santa-dash");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1 id=\"fr-title\">Robin&#39;s Santa Dash</h1>");
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('<link rel="canonical" href="https://nbcc.test/fundraise/robins-santa-dash" />');
    expect(html).not.toContain("robin.quill@example.com");
  });

  it("is the site's 404 for anything else", async () => {
    const cases: Array<[string, () => void]> = [
      ["unknown", () => {}],
      ["robins-santa-dash", () => (state.fundraisers = [record({ status: "new" })])],
      ["robins-santa-dash", () => (state.fundraisers = [record({ status: "declined" })])],
      ["robins-santa-dash", () => (state.fundraisers = [record({ public: false })])],
      ["robins-santa-dash", () => (state.fundraisers = [record({ path: "event" })])],
      ["robins-santa-dash", () => (state.fundraisingOn = false)],
    ];
    for (const [slug, arrange] of cases) {
      state.fundraisingOn = true;
      state.fundraisers = [record()];
      arrange();
      const res = await get(`/fundraise/${slug}`);
      expect(res.status, slug).toBe(404);
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("shows the wall, newest first, with hidden amounts left out", async () => {
    state.wall = [
      { donationId: 1, fullName: "Alex Example", anonymous: false, showName: true, showAmount: false, amountPence: 2500, refundedPence: 0, message: "Go Robin", hidden: false, createdAt: "2026-10-01T10:00:00.000Z" },
      { donationId: 2, fullName: "Sam Sample", anonymous: false, showName: false, showAmount: true, amountPence: 1000, refundedPence: 0, message: null, hidden: false, createdAt: "2026-10-02T10:00:00.000Z" },
    ];
    const html = await (await get("/fundraise/robins-santa-dash")).text();
    const wall = html.slice(html.indexOf('id="fr-wall-heading"'));
    expect(wall.indexOf("Anonymous")).toBeLessThan(wall.indexOf("Alex E."));
    expect(wall).toContain("Go Robin");
    expect(wall).not.toContain("£25");
    expect(wall).toContain("£10");
  });
});

describe("the QR code", () => {
  it("is served as an SVG of the page's address", async () => {
    const res = await get("/fundraise/robins-santa-dash/qr.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<title>QR code for Robin&#39;s Santa Dash</title>");
  });

  it("is a 404 wherever the page is", async () => {
    state.fundraisers = [record({ public: false })];
    expect((await get("/fundraise/robins-santa-dash/qr.svg")).status).toBe(404);
  });

  // TASK-501 review: a finished fundraiser's organiser keeps their QR code in the private area.
  // TASK-502: and the page it points to stays up too, still taking gifts.
  it("still answers once the fundraiser has finished, as its page does", async () => {
    state.fundraisers = [record({ status: "finished" })];
    expect((await get("/fundraise/robins-santa-dash/qr.svg")).status).toBe(200);
    expect((await get("/fundraise/robins-santa-dash")).status).toBe(200);
  });

  it.each(["new", "declined"] as const)("is a 404 while %s", async (status) => {
    state.fundraisers = [record({ status })];
    expect((await get("/fundraise/robins-santa-dash/qr.svg")).status).toBe(404);
  });
});

describe("the manage page", () => {
  it("is served, and kept out of search engines and other sites' logs", async () => {
    const res = await get("/fundraise/manage?token=abc");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("is never taken for a fundraiser called manage", async () => {
    state.fundraisers = [record({ slug: "manage" })];
    expect(await (await get("/fundraise/manage")).text()).toContain("manageRequestForm");
  });
});

// TASK-498: the help page, a draft for sign off. Like the rest of fundraising it is there only while
// fundraising is switched on, so it can merge before anyone has approved the words.
describe("the help page", () => {
  it("is served while fundraising is on, and kept fresh", async () => {
    const res = await get("/fundraise/help");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0");
    // Indexable, like the sign up: no noindex header.
    expect(res.headers.get("x-robots-tag")).toBeNull();
    const html = await res.text();
    expect(html).toContain('id="help-heading"');
    expect(navList(html)).toContain('href="/get-involved"');
  });

  it("is the site's 404 while fundraising is switched off", async () => {
    state.fundraisingOn = false;
    const res = await get("/fundraise/help");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await res.text()).not.toContain('id="help-heading"');
  });

  it("is never taken for a fundraiser called help", async () => {
    state.fundraisers = [record({ slug: "help", title: "Robin Needs Help" })];
    const html = await (await get("/fundraise/help")).text();
    expect(html).toContain('id="help-heading"');
    expect(html).not.toContain("Robin Needs Help");
  });

  it("is linked from the sign up form", async () => {
    expect(await (await get("/fundraise")).text()).toContain('href="/fundraise/help"');
  });
});

describe("the raw files", () => {
  it("are never served at their own addresses", async () => {
    for (const f of ["/fundraiser.html", "/fundraise.html", "/fundraise-manage.html", "/fundraise-help.html", "/fundraise-logos.html"]) {
      expect((await get(f)).status, f).not.toBe(200);
    }
  });
});

// The pages are read from disk at request time, so a page missing from the image is a 404 in
// production that no test running against the repo would ever see.
describe("the image", () => {
  it("ships every page these routes read", async () => {
    const { readFileSync } = await import("node:fs");
    const docker = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");
    const copy = docker.split(/\r?\n/).find((l) => l.startsWith("COPY index.html")) ?? "";
    for (const f of ["events.html", "fundraise.html", "fundraiser.html", "fundraise-manage.html", "fundraise-help.html", "fundraise-logos.html"]) expect(copy.split(/\s+/), f).toContain(f);
  });
});

describe("review fixes", () => {
  it("the manage page is a 404 while fundraising is switched off, like the others", async () => {
    state.fundraisingOn = false;
    expect((await get("/fundraise/manage?token=abc")).status).toBe(404);
  });

  const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";

  it("the footer's Fundraise for us goes to the sign up on every page while fundraising is on", async () => {
    for (const path of ["/contact", "/get-involved", "/fundraise", "/fundraise/robins-santa-dash"]) {
      const f = footer(await (await get(path)).text());
      expect(f, path).toContain('<a href="/fundraise">Fundraise for us</a>');
    }
  });

  it("and to the contact page while it is off", async () => {
    state.fundraisingOn = false;
    for (const path of ["/contact", "/get-involved"]) {
      const f = footer(await (await get(path)).text());
      expect(f, path).toContain('<a href="/contact">Fundraise for us</a>');
    }
  });

  it("a giver coming back from paying sees the thank you", async () => {
    const html = await (await get("/fundraise/robins-santa-dash?thanks=1&message=1")).text();
    expect(html).toContain("data-thanks-panel");
    expect(html).toContain("Your message will appear on the wall shortly.");
    expect(await (await get("/fundraise/robins-santa-dash")).text()).not.toContain("data-thanks-panel");
  });
});

// --- TASK-502 ------------------------------------------------------------------------------------

describe("a finished fundraiser's page (TASK-502)", () => {
  it("stays at the same address, saying so, with its total, its meter, its wall and the give form", async () => {
    state.fundraisers = [record({ status: "finished" })];
    state.wall = [
      { donationId: 1, fullName: "Alex Example", anonymous: false, showName: true, showAmount: true, amountPence: 2000, refundedPence: 0, message: "Well done", hidden: false, createdAt: "2026-10-01T10:00:00.000Z", giftAid: true },
    ];
    const res = await get("/fundraise/robins-santa-dash");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Finished, thank you");
    expect(html).toContain("<strong>£125</strong>");
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain("You can still give");
    expect(html).toContain('id="frGiveForm"');
    expect(html).toContain("Well done");
    expect(html).toContain("+ £5 Gift Aid");
  });

  it("is not listed on Get involved", async () => {
    state.fundraisers = [record({ status: "finished" })];
    const html = await (await get("/get-involved")).text();
    expect(html).not.toContain("Robin&#39;s Santa Dash");
  });

  it("is still a 404 for one that is new or declined", async () => {
    for (const status of ["new", "declined"] as const) {
      state.fundraisers = [record({ status })];
      expect((await get("/fundraise/robins-santa-dash")).status, status).toBe(404);
    }
  });
});

describe("the thank you after paying (TASK-502)", () => {
  const SESSION = "cs_test_a1B2c3D4e5F6";
  const paidGift = (over: Record<string, unknown> = {}) => ({
    donationId: 55, fundraiserId: 7, paidIn: false, paymentStatus: "paid", message: null, wallAddedAt: null, ...over,
  });

  it("offers the optional wall step for this fundraiser's paid gift, kept private", async () => {
    state.gift = paidGift();
    const res = await get(`/fundraise/robins-santa-dash?thanks=1&session_id=${SESSION}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("data-wall-step");
    expect(html).toContain(`data-session-id="${SESSION}"`);
    expect(html).toContain("(optional)");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("offers it while the webhook has not recorded the payment yet", async () => {
    state.gift = null;
    expect(await (await get(`/fundraise/robins-santa-dash?thanks=1&session_id=${SESSION}`)).text()).toContain("data-wall-step");
  });

  it("is the plain thank you for a gift already added to, or on another fundraiser, or paid in", async () => {
    for (const over of [{ wallAddedAt: "2026-10-02T10:00:00.000Z" }, { message: "Hello" }, { fundraiserId: 8 }, { paidIn: true }, { paymentStatus: "failed" }]) {
      state.gift = paidGift(over);
      const res = await get(`/fundraise/robins-santa-dash?thanks=1&session_id=${SESSION}`);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html, JSON.stringify(over)).toContain("data-thanks-panel");
      expect(html, JSON.stringify(over)).not.toContain("data-wall-step");
    }
  });

  it("is the plain thank you without a session id, or with one that is not Stripe's", async () => {
    for (const q of ["?thanks=1", "?thanks=1&session_id={CHECKOUT_SESSION_ID}", "?thanks=1&session_id=%22%3E%3Cscript%3E", "?thanks=1&session_id=cs_a&session_id=cs_b"]) {
      const html = await (await get(`/fundraise/robins-santa-dash${q}`)).text();
      expect(html, q).toContain("data-thanks-panel");
      expect(html, q).not.toContain("data-wall-step");
      expect(html, q).not.toContain("<script>");
    }
  });

  it("is the plain thank you when the gift cannot be read", async () => {
    state.giftFails = true;
    const html = await (await get(`/fundraise/robins-santa-dash?thanks=1&session_id=${SESSION}`)).text();
    expect(html).toContain("data-thanks-panel");
    expect(html).not.toContain("data-wall-step");
  });

  it("is the plain thank you for a gift that already left a message on the give form", async () => {
    const html = await (await get(`/fundraise/robins-santa-dash?thanks=1&message=1&session_id=${SESSION}`)).text();
    expect(html).toContain("Your message will appear on the wall shortly.");
    expect(html).not.toContain("data-wall-step");
  });

  it("thanks them once they have added to the wall", async () => {
    const html = await (await get("/fundraise/robins-santa-dash?thanks=1&added=1")).text();
    expect(html).toContain("We have added that to Robin's wall.");
  });
});
