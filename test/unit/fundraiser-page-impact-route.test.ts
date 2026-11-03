import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { STARTING_EXAMPLES } from "../../src/impact/examples";

// What gifts could do, through the real site router with the database mocked: a fundraiser's, an
// event's and a team's page show the examples (a team's meter line counting the team's combined
// total), and a page in memory of someone shows none of them. Every name and number is invented.

const state = vi.hoisted(() => ({
  fundraisers: [] as unknown[],
  members: [] as unknown[],
  impact: [] as unknown[] | Error,
}));

vi.mock("../../src/db/ball", () => ({ getSettings: async () => Promise.reject(new Error("no database")) }));
vi.mock("../../src/db/events", () => ({ getEventsSettings: async () => ({ pageOn: true }), listPageEvents: async () => [] }));
vi.mock("../../src/db/site-pages", () => ({ resolveAlias: async () => null, getSeoOverrides: async () => new Map() }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => true,
  listApprovedPublic: async () => state.fundraisers,
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
    memberMetersFor: async (ids: number[]) => new Map(ids.map((id) => [id, members().filter((m) => m.teamId === id).map((m) => m.meter)])),
  };
});
vi.mock("../../src/db/fundraising-categories", async () => {
  const c = await import("../../src/fundraising/categories");
  return { loadCategories: async () => c.BUILT_IN_CATEGORIES };
});
vi.mock("../../src/db/impact-examples", () => ({
  loadImpactExamples: async () => {
    if (state.impact instanceof Error) throw state.impact;
    return state.impact;
  },
}));
vi.mock("../../src/fundraising/send", () => ({
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  eventPageUrl: (slug: string) => `https://nbcc.test/event/${slug}`,
}));
vi.mock("../../src/db/fundraiser-updates", () => ({ approvedForPage: async () => [] }));
vi.mock("../../src/db/fundraiser-slugs", () => ({ currentSlugFor: async () => null }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test" } }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

const rec = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 40, slug: "robins-dash", path: "raising", kind: "santa_dash", title: "Robin's Dash", description: "Running in red.",
    eventDate: null, startTime: null, venue: "", town: "Exampleton", targetPence: 200000, public: true, status: "approved",
    name: "Robin Organiser", email: "robin@example.com", phone: "07700 900111", socialLink: null, socialOk: false,
    wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z", approvedAt: "2026-10-02T10:00:00.000Z", approvedBy: null,
    updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, isTeam: false, teamShareMode: null,
    meter: meter({ onlinePence: 15000, cashPence: 0, targetPence: 200000 }), ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter> };

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
  state.members = [];
  state.fundraisers = [rec()];
  state.impact = STARTING_EXAMPLES.map((e, i) => ({ ...e, id: i + 1 }));
});

const page = async (path: string) => {
  const res = await fetch(`${base}${path}`, { redirect: "manual" });
  expect(res.status).toBe(200);
  return res.text();
};
const FOOTNOTE = "These show what gifts could do. Every gift goes where it&#39;s needed most.";

describe("a fundraiser's page", () => {
  it("shows the examples under the give amounts and the meter, with the footnote", async () => {
    const html = await page("/fundraise/robins-dash");
    expect(html).toContain("could help put a cosy pair of pyjamas in a Red Bag");
    expect(html).toContain("What&#39;s been raised so far could fill around 3 Red Bags Full of Joy");
    expect(html).toContain(FOOTNOTE);
  });

  it("shows none of them when the list cannot be read, and the page still works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.impact = new Error("database down");
    const html = await page("/fundraise/robins-dash");
    expect(html).toContain("Robin&#39;s Dash");
    expect(html).not.toContain("fr-could-note");
  });
});

describe("an event's page", () => {
  it("shows them too", async () => {
    state.fundraisers = [rec({ path: "event", slug: "quiz-night", title: "Quiz Night", eventDate: "2026-12-05" })];
    const html = await page("/event/quiz-night");
    expect(html).toContain("fr-amount__could");
    expect(html).toContain("could fill around 3 Red Bags");
  });
});

describe("a team's page", () => {
  it("counts the team's combined total under the meter", async () => {
    state.fundraisers = [rec({ isTeam: true, slug: "ej", title: "Exampleton Juniors", meter: meter({ onlinePence: 1000, cashPence: 0, targetPence: 200000 }) })];
    state.members = [
      rec({ id: 41, slug: "m41", teamId: 40, title: "Ava's page", meter: meter({ onlinePence: 30000, cashPence: 0, targetPence: 50000 }) }),
      rec({ id: 42, slug: "m42", teamId: 40, title: "Ben's page", meter: meter({ onlinePence: 25000, cashPence: 0, targetPence: 50000 }) }),
    ];
    const html = await page("/fundraise/ej");
    // £10 + £300 + £250 = £560: 11 Red Bags, or 14 children's uniforms.
    expect(html).toContain("could fill around 11 Red Bags Full of Joy, or help 14 children start school in a uniform that fits");
  });
});

describe("an in memory page (the in_memory flag)", () => {
  it("shows none of them, whatever its category", async () => {
    state.fundraisers = [rec({ inMemory: true, memoryName: "Sam Example" } as Partial<FundraiserRecord>)];
    const html = await page("/fundraise/robins-dash");
    expect(html).not.toContain("fr-amount__could");
    expect(html).not.toContain("fr-meter__could");
    expect(html).not.toContain("fr-could-note");
    expect(html).not.toContain("data-could");
    expect(html).not.toContain("Red Bag");
  });
});

describe("a page in memory of someone", () => {
  it("shows none of them: it is a quiet page", async () => {
    state.fundraisers = [rec({ kind: "in_memory", kindLabel: "In memory" })];
    const html = await page("/fundraise/robins-dash");
    expect(html).not.toContain("fr-amount__could");
    expect(html).not.toContain("fr-meter__could");
    expect(html).not.toContain("fr-could-note");
    expect(html).not.toContain("Red Bag");
  });
});

// The Ball's moment puts Fill a Red Bag in the footer of the pages the site router draws
// (src/red-bag/fill-links.ts). The charity is very careful about pages in memory of someone, so they
// stay quiet: the link never reaches one, either side of the moment. Through the real router again,
// with the clock passed in.
describe("the footer's Fill a Red Bag and a quiet page", () => {
  const BEFORE = new Date("2026-11-07T19:59:59Z");
  const THE_MOMENT = new Date("2026-11-07T20:00:00Z");
  const CHRISTMAS_WEEK = new Date("2026-12-27T10:00:00Z");
  const AFTER = [THE_MOMENT, CHRISTMAS_WEEK];
  const LINK = 'href="/fill"';

  let now = BEFORE;
  let clocked: Server;
  let clockedBase = "";
  beforeAll(async () => {
    const app = express();
    app.use(createSiteRouter(ROOT, { now: () => now }));
    clocked = app.listen(0);
    await new Promise((r) => clocked.once("listening", r));
    clockedBase = `http://127.0.0.1:${(clocked.address() as AddressInfo).port}`;
  });
  afterAll(() => clocked.close());

  const at = async (when: Date, path: string) => {
    now = when;
    const res = await fetch(`${clockedBase}${path}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    return res.text();
  };

  const QUIET: Array<[string, Partial<FundraiserRecord>]> = [
    ["the in_memory flag", { inMemory: true, memoryName: "Sam Example" } as Partial<FundraiserRecord>],
    ["a category that mentions memory", { kind: "in_memory", kindLabel: "In memory" } as Partial<FundraiserRecord>],
  ];

  it.each(QUIET)("a page known by %s never has it", async (_how, over) => {
    state.fundraisers = [rec(over)];
    for (const when of [BEFORE, ...AFTER]) {
      const html = await at(when, "/fundraise/robins-dash");
      expect(html).toContain("<footer");
      expect(html).not.toContain(LINK);
      expect(html).not.toContain("Red Bag");
    }
  });

  it.each(QUIET)("nor does a giver's thank you on a page known by %s", async (_how, over) => {
    state.fundraisers = [rec(over)];
    for (const when of AFTER) {
      const html = await at(when, "/fundraise/robins-dash?thanks=1");
      expect(html).toContain("<footer");
      expect(html).not.toContain("Red Bag");
    }
  });

  it("an event page in a category that mentions memory never has it", async () => {
    state.fundraisers = [rec({ path: "event", slug: "quiet-evening", eventDate: "2026-12-05", kind: "in_memory", kindLabel: "In memory" } as Partial<FundraiserRecord>)];
    for (const when of AFTER) expect(await at(when, "/event/quiet-evening")).not.toContain("Red Bag");
  });

  it("the join page of a team in a category that mentions memory never has it", async () => {
    state.fundraisers = [rec({ isTeam: true, kind: "in_memory", kindLabel: "In memory" } as Partial<FundraiserRecord>)];
    for (const when of AFTER) {
      const html = await at(when, "/fundraise/robins-dash/join");
      expect(html).toContain("<footer");
      expect(html).not.toContain(LINK);
    }
  });

  // The sign up and the organiser's private area are one address for everyone, and the in memory path
  // is only chosen, or the page only known, once they are open in the browser. A family may be on
  // either, so as they are drawn they are treated as quiet.
  it.each(["/fundraise", "/fundraise?invite=an-invented-token", "/fundraise?again=an-invented-token", "/fundraise/manage"])(
    "%s, where a family may be, never has it",
    async (path) => {
      for (const when of [BEFORE, ...AFTER]) {
        const html = await at(when, path);
        expect(html).toContain("<footer");
        expect(html).not.toContain(LINK);
      }
    },
  );

  it("an ordinary page has it after the moment and not before, so these tests can fail", async () => {
    expect(await at(BEFORE, "/fundraise/robins-dash")).not.toContain(LINK);
    for (const when of AFTER) expect(await at(when, "/fundraise/robins-dash")).toContain(LINK);
  });

  it("an ordinary event page and team join page have it after the moment", async () => {
    state.fundraisers = [rec({ path: "event", slug: "quiz-night", eventDate: "2026-12-05" })];
    expect(await at(THE_MOMENT, "/event/quiz-night")).toContain(LINK);
    state.fundraisers = [rec({ isTeam: true })];
    expect(await at(THE_MOMENT, "/fundraise/robins-dash/join")).toContain(LINK);
  });
});
