// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// Event pages: every approved public event has its own page at /event/<short name>, drawn by the
// fundraiser page's code. Each address answers only for its own kind: /event/<x> for an event,
// /fundraise/<x> for a fundraiser raising money, and either sends the other kind on to its own
// address (a staff change of kind, or a link typed the wrong way, never breaks). An old short name
// goes on to the new one, as a fundraiser's does. Switched off, it is the site's 404 like every
// fundraising page. Driven through the real site router with the database mocked; every name here
// is invented.

const state = vi.hoisted(() => ({
  fundraisingOn: true,
  fundraisers: [] as unknown[],
  history: {} as Record<string, string>,
}));

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => {
    throw new Error("no database in unit tests");
  },
}));
vi.mock("../../src/db/events", () => ({
  getEventsSettings: async () => ({ pageOn: true }),
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
  wallRows: async () => [],
  giftForSession: async () => null,
}));
vi.mock("../../src/db/fundraiser-slugs", () => ({ currentSlugFor: async (old: string) => state.history[old] ?? null }));
vi.mock("../../src/fundraising/send", () => ({
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  eventPageUrl: (slug: string) => `https://nbcc.test/event/${slug}`,
}));
vi.mock("../../src/db/fundraiser-updates", () => ({ approvedForPage: async () => [] }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

function event(over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter> } {
  return {
    id: 12, slug: "eqn", path: "event", kind: "quiz", title: "Exampleton Quiz Night", description: "Teams of four. Prizes!",
    eventDate: "2099-12-05", startTime: "19:00", venue: "The Hall", town: "Exampleton", targetPence: null, public: true,
    status: "approved", name: "Alex Example", email: "alex@example.com", phone: "07700 900222", socialLink: null,
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z", approvedAt: "2026-10-02T10:00:00.000Z", approvedBy: null,
    updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, cardLine: "A quiz for NBCC.", endTime: "22:00", timeTbc: false,
    venueAddress: null, venuePostcode: null, access: [], price: "£5 a head", booking: "door", ticketUrl: null, ageLimit: null,
    dressCode: null, included: null, creditName: null, slugSetAt: "2026-10-02T09:00:00.000Z",
    meter: meter({ onlinePence: 4000, cashPence: 6000, targetPence: null }),
    ...over,
  };
}

const raising = (over: Partial<FundraiserRecord> = {}) =>
  event({ id: 7, slug: "rsd", path: "raising", title: "Robin's Santa Dash", targetPence: 25000, eventDate: null, ...over });

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
  state.fundraisingOn = true;
  state.fundraisers = [event(), raising()];
  state.history = {};
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("an event's own page", () => {
  it("is at /event/<short name>, with its name, meter and the way to give", async () => {
    const res = await get("/event/eqn");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0");
    const d = doc(await res.text());
    expect(d.querySelector("h1")?.textContent).toBe("Exampleton Quiz Night");
    expect(d.querySelector(".fr-meter__raised")?.textContent).toBe("£100");
    expect(d.querySelector("#frGiveForm")?.getAttribute("data-fundraiser-id")).toBe("12");
    expect(d.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://nbcc.test/event/eqn");
  });

  it("stays up once it has finished, as a fundraiser's does", async () => {
    state.fundraisers = [event({ status: "finished" })];
    expect((await get("/event/eqn")).status).toBe(200);
  });

  it.each([
    ["new", { status: "new" as const }],
    ["declined", { status: "declined" as const }],
    ["not public", { public: false }],
  ])("is the site's 404 when it is %s", async (_what, over) => {
    state.fundraisers = [event(over)];
    expect((await get("/event/eqn")).status).toBe(404);
  });

  it("is the site's 404 while fundraising is switched off, like every fundraising page", async () => {
    state.fundraisingOn = false;
    for (const path of ["/event/eqn", "/event/eqn/qr.svg", "/event/eqn/qr.png"]) expect((await get(path)).status, path).toBe(404);
  });

  it("is the site's 404 for a short name nobody has", async () => {
    expect((await get("/event/nobody-has-this")).status).toBe(404);
  });
});

describe("its QR code", () => {
  it("carries the event page's address, to download", async () => {
    const res = await get("/event/eqn/qr.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="nbcc-eqn-qr-code.svg"');
    expect(await res.text()).toContain("QR code for Exampleton Quiz Night");
  });

  it("comes as a print size PNG too", async () => {
    const res = await get("/event/eqn/qr.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="nbcc-eqn-qr-code.png"');
  });
});

describe("each address answers only for its own kind", () => {
  // Review fix: a temporary redirect that is never kept. Staff may change an event's kind and change
  // it back, and a kept redirect would then send people round in a circle; and a giver's thank you
  // (?thanks=1&session_id=) must never be kept anywhere.
  it("sends /fundraise/<x> for an event on to /event/<x>, query string kept, never kept itself", async () => {
    const res = await get("/fundraise/eqn?utm_source=poster");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/event/eqn?utm_source=poster");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends /event/<x> for a fundraiser raising money on to /fundraise/<x>, the same way", async () => {
    const res = await get("/event/rsd");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/fundraise/rsd");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("never lets a giver's thank you be kept on the way", async () => {
    const res = await get("/fundraise/eqn?thanks=1&session_id=cs_test_abc");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/event/eqn?thanks=1&session_id=cs_test_abc");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does the same for the QR codes", async () => {
    expect((await get("/fundraise/eqn/qr.svg")).headers.get("location")).toBe("/event/eqn/qr.svg");
    expect((await get("/event/rsd/qr.png")).headers.get("location")).toBe("/fundraise/rsd/qr.png");
    expect((await get("/fundraise/eqn/qr.svg")).status).toBe(302);
  });

  it("never sends anyone to a page that is not there", async () => {
    state.fundraisers = [event({ status: "declined" })];
    expect((await get("/fundraise/eqn")).status).toBe(404);
  });
});

describe("a short name the event used to have", () => {
  it("goes on to its short name now, for good", async () => {
    state.history = { "quiz-night": "eqn" };
    const res = await get("/event/quiz-night?utm_medium=qr");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/event/eqn?utm_medium=qr");
  });

  it("goes to the right kind's address, whichever prefix it came in on", async () => {
    state.history = { "quiz-night": "eqn" };
    const res = await get("/fundraise/quiz-night");
    expect(res.headers.get("location")).toBe("/event/eqn");
    // An old address is for good, as a fundraiser's is (TASK-511).
    expect(res.status).toBe(301);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });
});
