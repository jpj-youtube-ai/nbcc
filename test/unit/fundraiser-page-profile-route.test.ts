import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// Profile pictures (Jaimie, 2026-10-03): a fundraiser's page and a team's page, through the real site
// router with the database mocked, carry each approved round photo, and the NBCC elf on the team page
// for anyone without one. A photo that cannot be read only leaves the photo out. Every name here is
// invented.

const PHOTO_A = "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const PHOTO_B = "1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const state = vi.hoisted(() => ({ fundraisers: [] as unknown[], members: [] as unknown[], photos: new Map<number, string>(), fails: false, asked: [] as number[][] }));

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
  getFundraiser: async (id: number) => (state.fundraisers as FundraiserRecord[]).find((f) => f.id === id) ?? null,
  wallRows: async () => [],
  giftForSession: async () => null,
}));
vi.mock("../../src/db/fundraiser-updates", () => ({ approvedForPage: async () => [] }));
vi.mock("../../src/db/fundraising-teams", () => ({ listTeamMembers: async () => state.members }));
vi.mock("../../src/db/fundraiser-pictures", () => ({
  approvedProfilePhotos: async (ids: number[]) => {
    state.asked.push(ids);
    if (state.fails) throw new Error("database down");
    return new Map([...state.photos].filter(([id]) => ids.includes(id)));
  },
}));
vi.mock("../../src/fundraising/send", () => ({ fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}` }));
vi.mock("../../src/config", () => ({ config: { PORTAL_BASE_URL: "https://nbcc.test", NODE_ENV: "test" } }));

import { createSiteRouter } from "../../src/routes/site";

const ROOT = resolve(__dirname, "../..");

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
    isTeam: false,
    teamId: null,
    teamLeftAt: null,
    meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
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
  state.fundraisers = [record()];
  state.members = [];
  state.photos = new Map();
  state.fails = false;
  state.asked = [];
});

const open = async (slug: string) => (await fetch(`${base}/fundraise/${slug}`)).text();

describe("the round photo on a fundraiser's page", () => {
  it("shows the organiser's approved photo beside Organised by", async () => {
    state.photos = new Map([[7, PHOTO_A]]);
    const html = await open("robins-santa-dash");
    expect(html).toContain(`src="/media/fundraiser-profile/${PHOTO_A}" alt="A photo of Robin Q."`);
  });

  it("has none, and the person icon as before, without an approved photo", async () => {
    const html = await open("robins-santa-dash");
    expect(html).not.toContain("fr-avatar");
    expect(html).toContain("Organised by Robin Q.");
  });

  it("never asks for a round photo for a page in memory of someone", async () => {
    state.fundraisers = [record({ inMemory: true, memoryName: "Margaret Exampleton" } as Partial<FundraiserRecord>)];
    state.photos = new Map([[7, PHOTO_A]]);
    const html = await open("robins-santa-dash");
    expect(state.asked).toEqual([]);
    expect(html).not.toContain("/media/fundraiser-profile/");
  });

  it("still opens, without the photo, when it cannot be read", async () => {
    state.fails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = await open("robins-santa-dash");
    err.mockRestore();
    expect(html).toContain("Organised by Robin Q.");
    expect(html).not.toContain("fr-avatar");
  });
});

describe("the round photos on a team's page", () => {
  beforeEach(() => {
    state.fundraisers = [record({ id: 20, slug: "exampleton-juniors", title: "Exampleton Juniors", isTeam: true, name: "Robin Quill" })];
    state.members = [
      record({ id: 21, slug: "ava", title: "Ava's page", name: "Ava Sample", teamId: 20 }),
      record({ id: 22, slug: "ben", title: "Ben's page", name: "Ben Example", teamId: 20 }),
    ];
  });

  it("shows a member's approved photo, and the elf for one without", async () => {
    state.photos = new Map([[21, PHOTO_B]]);
    const html = await open("exampleton-juniors");
    expect(html).toContain(`src="/media/fundraiser-profile/${PHOTO_B}" alt="A photo of Ava S."`);
    const team = html.slice(html.indexOf('class="fr-team"'));
    // The team organiser and Ben have none yet: the elf, twice.
    expect(team.match(/fr-avatar--elf/g)).toHaveLength(2);
  });

  it("shows the team organiser's approved photo in the team and beside Team organiser", async () => {
    state.photos = new Map([[20, PHOTO_A]]);
    const html = await open("exampleton-juniors");
    expect(html.match(new RegExp(`/media/fundraiser-profile/${PHOTO_A}`, "g"))).toHaveLength(2);
  });
});
