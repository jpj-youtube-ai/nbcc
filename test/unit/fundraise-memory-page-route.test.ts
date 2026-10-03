import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// In memory pages (Jaimie, 2026-10-03): /fundraise/<slug> draws a page in memory of someone with its
// own quieter renderer, through the real site router with the database mocked. Every other page is
// drawn as it always was. Every name and address here is invented.

const state = vi.hoisted(() => ({ fundraisers: [] as unknown[], wall: [] as unknown[] }));

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
  wallRows: async () => state.wall,
  giftForSession: async () => null,
}));
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: async () => c.BUILT_IN_CATEGORIES };
});
vi.mock("../../src/fundraising/send", () => ({ fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}` }));
vi.mock("../../src/db/fundraiser-updates", () => ({ approvedForPage: async () => [] }));
vi.mock("../../src/db/fundraiser-slugs", () => ({ currentSlugFor: async () => null }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

function record(over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter> } {
  return {
    id: 7, slug: "ime", path: "raising", kind: "other", title: "In memory of Margaret Exampleton", description: "Remembering Margaret.",
    eventDate: "2026-10-03", startTime: null, venue: "", town: "Exampleton", targetPence: 25000, public: true, status: "approved",
    name: "Robin Quill", email: "robin.quill@example.com", phone: "07700 900111", socialLink: null, socialOk: false,
    wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-09-30T10:00:00.000Z", approvedAt: "2026-10-01T10:00:00.000Z", approvedBy: null,
    updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: null, inMemory: true, memoryName: "Margaret Exampleton", memoryDates: "1948 to 2026",
    memorySetupBy: "family", memoryPermission: true, memoryShowTarget: false,
    meter: meter({ onlinePence: 12500, cashPence: 0, targetPence: 25000 }),
    ...over,
  } as FundraiserRecord & { meter: ReturnType<typeof meter> };
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
  state.fundraisers = [record(), record({ id: 8, slug: "walk", title: "Robin's Walk", inMemory: false, memoryName: null })];
  state.wall = [];
});

describe("an in memory page's address", () => {
  it("draws the quieter page: who it remembers, no countdown, the target hidden", async () => {
    const res = await fetch(`${base}/fundraise/ime`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("In memory of Margaret Exampleton");
    expect(html).toContain("fr-memory-page");
    expect(html).not.toContain("Good luck");
    expect(html).not.toContain("£250");
    expect(html).not.toContain("robin.quill@example.com");
  });

  it("leaves every other page as it was", async () => {
    const html = await (await fetch(`${base}/fundraise/walk`)).text();
    expect(html).not.toContain("fr-memory-page");
    expect(html).toContain("Robin&#39;s Walk");
  });

  it("shows on Get involved as a quiet card", async () => {
    const html = await (await fetch(`${base}/get-involved`)).text();
    expect(html).toContain("ev-card--memory");
  });
});
