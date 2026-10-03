import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// TASK-511: when staff change a page's address, the old one keeps working: /fundraise/<old> answers
// with a 301 to the page's address now (its query string kept, so a poster's tag still counts), and
// so does its QR code's address. A QR code printed with the old link never breaks. Driven through the
// real site router with the database mocked; every name here is invented.

const state = vi.hoisted(() => ({
  fundraisingOn: true,
  fundraisers: [] as unknown[],
  history: {} as Record<string, string>,
  historyFails: false,
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
vi.mock("../../src/db/fundraiser-slugs", () => ({
  currentSlugFor: async (old: string) => {
    if (state.historyFails) throw new Error("database down");
    return state.history[old] ?? null;
  },
}));
vi.mock("../../src/fundraising/send", () => ({
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
}));
vi.mock("../../src/db/fundraiser-updates", () => ({ approvedForPage: async () => [] }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

function record(over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter> } {
  return {
    id: 7, slug: "rsd", path: "raising", kind: "santa_dash", title: "Robin's Santa Dash", description: "Five kilometres.",
    eventDate: null, startTime: null, venue: "", town: "Exampleton", targetPence: 25000, public: true, status: "approved",
    name: "Robin Quill", email: "robin.quill@example.com", phone: "07700 900111", socialLink: null, socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-09-30T10:00:00.000Z", approvedAt: "2026-10-01T10:00:00.000Z", approvedBy: null,
    updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null,
    venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null,
    creditName: null, meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
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
  state.fundraisingOn = true;
  state.fundraisers = [record()];
  state.history = { "robins-santa-dash": "rsd" };
  state.historyFails = false;
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("an address a page used to have", () => {
  it("sends people on to its address now, for good", async () => {
    const res = await get("/fundraise/robins-santa-dash");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/fundraise/rsd");
  });

  // Review fix: a 301 with no caching rule is kept by a browser for good. If staff change a link
  // and later change it back, someone who scanned in between would go round in a circle. An hour,
  // then the browser asks again.
  it.each(["/fundraise/robins-santa-dash", "/fundraise/robins-santa-dash/qr.svg", "/fundraise/robins-santa-dash/qr.png"])(
    "lets a browser keep the redirect from %s for an hour only",
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(301);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    },
  );

  it("keeps the query string, so a poster's tag still counts", async () => {
    const res = await get("/fundraise/robins-santa-dash?utm_source=poster&utm_medium=qr");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/fundraise/rsd?utm_source=poster&utm_medium=qr");
  });

  it("does the same for its QR code's address", async () => {
    const res = await get("/fundraise/robins-santa-dash/qr.svg");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/fundraise/rsd/qr.svg");
  });

  it("does the same for its print size QR code (TASK-504)", async () => {
    const res = await get("/fundraise/robins-santa-dash/qr.png");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/fundraise/rsd/qr.png");
  });

  it("still goes to the page once it has finished, as the page stays up", async () => {
    state.fundraisers = [record({ status: "finished" })];
    expect((await get("/fundraise/robins-santa-dash")).status).toBe(301);
  });

  it("is the site's 404 when the page it went to has none now, or fundraising is off", async () => {
    for (const arrange of [
      () => (state.fundraisers = [record({ status: "declined" })]),
      () => (state.fundraisers = [record({ public: false })]),
      () => (state.fundraisingOn = false),
    ]) {
      state.fundraisingOn = true;
      state.fundraisers = [record()];
      arrange();
      expect((await get("/fundraise/robins-santa-dash")).status).toBe(404);
    }
  });

  it("is the site's 404 for an address no page ever had, and when the lookup fails", async () => {
    expect((await get("/fundraise/never-was")).status).toBe(404);
    state.historyFails = true;
    expect((await get("/fundraise/robins-santa-dash")).status).toBe(404);
  });

  it("never stands in for a page that has that address now", async () => {
    state.fundraisers = [record(), record({ id: 8, slug: "robins-santa-dash", title: "Another Dash" })];
    const res = await get("/fundraise/robins-santa-dash");
    expect(res.status).toBe(200);
  });
});
