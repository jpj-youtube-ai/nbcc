import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { londonToday } from "../../src/events/model";
import { daysBetween, type NewsRow } from "../../src/fundraising/news";

// TASK-506: a fundraiser's page, through the real site router with the database mocked, carries its
// countdown and its approved news, and is still revalidated on every view (so the countdown is never
// a day out from a cache, and a hidden update goes at once). Every name here is invented.

const state = vi.hoisted(() => ({ fundraisers: [] as unknown[], news: [] as unknown[], newsFails: false }));

vi.mock("../../src/db/ball", () => ({
  getSettings: async () => {
    throw new Error("no database in unit tests");
  },
}));
vi.mock("../../src/db/events", () => ({ getEventsSettings: async () => ({ pageOn: true }), listPageEvents: async () => [] }));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => true,
  listApprovedPublic: async () => state.fundraisers,
  getBySlug: async (slug: string) => (state.fundraisers as FundraiserRecord[]).find((f) => f.slug === slug) ?? null,
  wallRows: async () => [],
  giftForSession: async () => null,
}));
vi.mock("../../src/db/fundraiser-updates", () => ({
  approvedForPage: async (id: number) => {
    if (state.newsFails) throw new Error("database down");
    return (state.news as NewsRow[]).filter((n) => n.fundraiserId === id);
  },
}));
vi.mock("../../src/fundraising/send", () => ({ fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}` }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function record(over: Partial<FundraiserRecord> = {}) {
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
    imageSrc: null,
    meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
    ...over,
  } as FundraiserRecord & { meter: ReturnType<typeof meter> };
}

const newsRow = (id: number, over: Partial<NewsRow> = {}): NewsRow => ({
  id,
  fundraiserId: 7,
  text: `News number ${id}`,
  status: "approved",
  photoId: null,
  createdAt: new Date(Date.UTC(2026, 8, id, 12)).toISOString(),
  decidedAt: null,
  decidedBy: null,
  rejectReason: null,
  ...over,
});

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
  state.fundraisers = [record()];
  state.news = [];
  state.newsFails = false;
});

const page = async () => {
  const res = await fetch(`${base}/fundraise/robins-santa-dash`);
  return { res, html: await res.text() };
};

describe("a fundraiser's page with its extras", () => {
  it("counts down to its date, and is revalidated on every view", async () => {
    const today = londonToday(new Date());
    state.fundraisers = [record({ eventDate: addDays(today, 9) })];
    const { res, html } = await page();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0");
    const days = daysBetween(today, addDays(today, 9));
    expect(html).toContain(`<span class="fr-countdown__num">${days}</span> days to go`);
  });

  it("wishes them luck on the day", async () => {
    state.fundraisers = [record({ eventDate: londonToday(new Date()) })];
    expect((await page()).html).toContain("Today's the day! Good luck, Robin!");
  });

  it("shows the approved news, newest first, and a photo at its public address", async () => {
    const photo = "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
    state.news = [newsRow(1), newsRow(3, { photoId: photo }), newsRow(2), newsRow(4, { fundraiserId: 99 })];
    const { html } = await page();
    const order = ["News number 3", "News number 2", "News number 1"].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("News number 4");
    expect(html).toContain(`src="/media/fundraiser-news/${photo}"`);
  });

  it("still opens, without news, when the news cannot be read", async () => {
    state.newsFails = true;
    state.news = [newsRow(1)];
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { res, html } = await page();
    err.mockRestore();
    expect(res.status).toBe(200);
    expect(html).not.toContain('class="fr-news"');
    expect(html).toContain("About this fundraiser");
  });
});
