import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// Team pages (Jaimie, 2026-10-03): the public pages, through the real site router with the database
// mocked. A team page has the combined meter, its members A to Z each with a small meter, and a way
// to join; a member page says which team it is part of; the join form is only there for an approved
// team while fundraising is on; Get involved lists a team once, never its members. Every name and
// address here is invented.

const state = vi.hoisted(() => ({ fundraisingOn: true, fundraisers: [] as unknown[], members: [] as unknown[] }));

vi.mock("../../src/db/ball", () => ({ getSettings: async () => Promise.reject(new Error("no database")) }));
vi.mock("../../src/db/events", () => ({ getEventsSettings: async () => ({ pageOn: true }), listPageEvents: async () => [] }));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.fundraisingOn,
  listApprovedPublic: async () => (state.fundraisers as FundraiserRecord[]).filter((f) => f.status === "approved"),
  getBySlug: async (slug: string) => (state.fundraisers as FundraiserRecord[]).find((f) => f.slug === slug) ?? null,
  getFundraiser: async (id: number) => (state.fundraisers as FundraiserRecord[]).find((f) => f.id === id) ?? null,
  wallRows: async () => [],
  giftForSession: async () => null,
}));
vi.mock("../../src/db/fundraising-teams", () => {
  type F = FundraiserRecord & { meter: ReturnType<typeof meter> };
  const members = () => state.members as F[];
  return {
    listTeamMembers: async (id: number) => members().filter((m) => m.teamId === id),
    memberMetersFor: async (ids: number[]) =>
      new Map(ids.map((id) => [id, members().filter((m) => m.teamId === id && m.status === "approved").map((m) => m.meter)])),
  };
});
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: async () => c.BUILT_IN_CATEGORIES };
});
vi.mock("../../src/fundraising/send", () => ({ fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}` }));
vi.mock("../../src/db/fundraiser-updates", () => ({ approvedForPage: async () => [] }));
vi.mock("../../src/db/fundraiser-slugs", () => ({ currentSlugFor: async () => null }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test" } }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

const rec = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 40, slug: "ej", path: "raising", kind: "santa_dash", title: "Exampleton Juniors", description: "The under 12s, dashing.",
    eventDate: null, startTime: null, venue: "", town: "Exampleton", targetPence: 200000, public: true, status: "approved",
    name: "Robin Organiser", email: "robin@example.com", phone: "07700 900111", socialLink: null, socialOk: false,
    wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z", approvedAt: "2026-10-02T10:00:00.000Z", approvedBy: null,
    updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, isTeam: true, teamShareMode: null,
    meter: meter({ onlinePence: 1000, cashPence: 0, targetPence: 200000 }), ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter> };

const member = (id: number, name: string, raised: number, over: Partial<FundraiserRecord> = {}) =>
  rec({ id, slug: `m${id}`, name, firstName: name.split(" ")[0], title: `${name.split(" ")[0]}'s page for Exampleton Juniors`, isTeam: false, teamId: 40, email: `${id}@example.com`, targetPence: 5000, meter: meter({ onlinePence: raised, cashPence: 0, targetPence: 5000 }), ...over });

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
  state.members = [member(42, "Zara Example", 900), member(41, "Ava Sample", 2000), member(43, "Ben Waiting", 0, { status: "new" })];
  state.fundraisers = [rec(), ...(state.members as FundraiserRecord[])];
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("a team page", () => {
  it("shows the combined meter, the members A to Z with their own meters, and a way to join", async () => {
    const html = await (await get("/fundraise/ej")).text();
    // £10 on the team page, £20 and £9 on the two approved member pages (never the waiting one).
    expect(html).toContain("£39");
    expect(html.indexOf("Ava S.")).toBeGreaterThan(-1);
    expect(html.indexOf("Ava S.")).toBeLessThan(html.indexOf("Zara E."));
    expect(html).not.toContain("Ben W.");
    expect(html).toContain('href="/fundraise/ej/join"');
    expect(html).toContain("Team organiser: Robin O.");
    expect(html).not.toContain("robin@example.com");
    expect(html).not.toContain("41@example.com");
  });
});

describe("a member page", () => {
  it("says which team it is part of", async () => {
    const html = await (await get("/fundraise/m41")).text();
    expect(html).toContain('Part of the team <a href="/fundraise/ej">Exampleton Juniors</a>');
  });
});

describe("the join form", () => {
  it("is there for an approved team, never indexed or kept", async () => {
    const res = await get("/fundraise/ej/join");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Join Exampleton Juniors");
    expect(html).toContain('data-team-slug="ej"');
  });

  it("says how a whole team shares, and does not ask", async () => {
    state.fundraisers = [rec({ teamShareMode: "team", sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder" })];
    const html = await (await get("/fundraise/ej/join")).text();
    expect(html).toContain("50% comes to NBCC and the rest goes to Exampleton Food Larder");
    expect(html).toMatch(/data-join-share hidden>/);
  });

  it("shows the closed panel for a finished team", async () => {
    state.fundraisers = [rec({ status: "finished" })];
    const html = await (await get("/fundraise/ej/join")).text();
    expect(html).toMatch(/data-join-closed>/);
  });

  it("is the site's 404 for anything that is not a team, and while fundraising is off", async () => {
    expect((await get("/fundraise/m41/join")).status).toBe(404);
    state.fundraisingOn = false;
    expect((await get("/fundraise/ej/join")).status).toBe(404);
  });
});

describe("Get involved", () => {
  it("lists the team once, with its combined meter, and none of its member pages", async () => {
    const html = await (await get("/get-involved")).text();
    expect(html).toContain("Exampleton Juniors");
    expect(html).not.toContain("Ava&#39;s page for Exampleton Juniors");
    expect(html).toContain("£39");
  });
});
