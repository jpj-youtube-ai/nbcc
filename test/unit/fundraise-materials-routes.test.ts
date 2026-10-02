import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { qrSvg } from "../../src/fundraising/qr";

// TASK-504: who can open a fundraiser's materials. The organiser, signed in to their private area,
// opens their own (and nobody else's: anyone else's reads as not there); staff open any approved one
// from Admin > Fundraising with the fundraising view permission. Nothing for a sign up that is not
// approved; the certificate only once finished (staff may preview it); everything a 404 for an
// organiser while fundraising is switched off. Drawn from the approved record, never a waiting
// change. The database is mocked; every name and address here is invented.

const state = vi.hoisted(() => ({
  on: true,
  fundraisers: [] as unknown[],
  sessions: new Map<string, string>(),
  waitingEditFor: vi.fn(),
  authRow: null as unknown,
}));

vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.on,
  getFundraiser: async (id: number) => (state.fundraisers as FundraiserRecord[]).find((f) => f.id === id) ?? null,
  waitingEditFor: state.waitingEditFor,
}));
vi.mock("../../src/db/fundraiser-sign-in", () => ({
  findSession: async (hash: string) => (state.sessions.has(hash) ? { email: state.sessions.get(hash) } : null),
}));
vi.mock("../../src/fundraising/send", () => ({
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  siteUrl: (path: string) => `https://nbcc.test${path}`,
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: async () => state.authRow }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret", PORTAL_BASE_URL: "https://nbcc.test" },
}));

import { fundraiseMaterialsRouter } from "../../src/routes/fundraise-materials";
import { hashSessionId } from "../../src/fundraising/sign-in";
import { signAdminSession } from "../../src/admin/session";

function record(over: Partial<FundraiserRecord> = {}) {
  return {
    id: 12,
    slug: "sams-santa-dash",
    path: "raising",
    kind: "santa_dash",
    title: "Sam's Santa Dash",
    description: "Five kilometres in a red suit.",
    eventDate: "2026-12-05",
    startTime: "10:00",
    venue: "North Inch",
    town: "Perth",
    targetPence: 50000,
    public: true,
    status: "approved",
    name: "Sam Example",
    email: "Sam.Example@example.com",
    phone: "07700 900123",
    cardLine: null,
    meter: meter({ onlinePence: 44000, cashPence: 10000, targetPence: 50000, giftAidPence: 4500 }),
    editWaiting: true,
    ...over,
  };
}

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(fundraiseMaterialsRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const SAM = "sam-session-id-aaaaaaaaaaaaaaaaaaaaaaaa";
const ALEX = "alex-session-id-bbbbbbbbbbbbbbbbbbbbbbb";
beforeEach(() => {
  state.on = true;
  state.fundraisers = [record(), record({ id: 13, slug: "alexs-bake-sale", title: "Alex's Bake Sale", email: "alex@example.com", name: "Alex Sample" })];
  state.sessions = new Map([
    [hashSessionId(SAM), "sam.example@example.com"],
    [hashSessionId(ALEX), "alex@example.com"],
  ]);
  state.waitingEditFor.mockReset();
  state.waitingEditFor.mockResolvedValue({ id: 1, changes: { description: "A WAITING CHANGE" }, createdAt: "2026-10-02T10:00:00Z" });
  state.authRow = null;
});

const mine = (id: number, piece: string, session: string | null = SAM) =>
  fetch(`${base}/api/fundraise/manage/fundraisers/${id}/materials/${piece}`, {
    headers: session ? { cookie: `nbcc_fr_session=${session}` } : {},
  });

function staffToken(permissions: Record<string, string>, role = "viewer") {
  state.authRow = { id: 3, email: "kim@nbcc.test", status: "active", role, permissions };
  return signAdminSession({ sub: 3, email: "kim@nbcc.test", role, now: new Date(), secret: "test-admin-secret" }).token;
}
const staff = (id: number, piece: string, token: string | null) =>
  fetch(`${base}/api/admin/fundraisers/${id}/materials/${piece}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("the organiser's own materials", () => {
  for (const piece of ["poster", "social", "sponsor-form"]) {
    it(`opens their ${piece}, private and never kept or indexed`, async () => {
      const res = await mine(12, piece);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(await res.text()).toContain("Sam&#39;s Santa Dash");
    });
  }

  it("puts the public page's address in the poster's QR code", async () => {
    const html = await (await mine(12, "poster")).text();
    const path = /<path fill="#000" d="([^"]+)"/.exec(qrSvg("https://nbcc.test/fundraise/sams-santa-dash"))?.[1];
    expect(html).toContain(`d="${path}"`);
  });

  it("is drawn from the approved details, never a change still waiting", async () => {
    const html = await (await mine(12, "poster")).text();
    expect(html).toContain("Five kilometres in a red suit.");
    expect(html).not.toContain("A WAITING CHANGE");
  });

  it("matches their email whatever its capitals", async () => {
    expect((await mine(12, "poster")).status).toBe(200);
  });

  it("reads anyone else's as not there", async () => {
    expect((await mine(12, "poster", ALEX)).status).toBe(404);
    expect((await mine(13, "poster", SAM)).status).toBe(404);
  });

  it("asks someone not signed in to sign in again", async () => {
    const res = await mine(12, "poster", null);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('href="/fundraise/manage"');
    expect((await mine(12, "poster", "not-a-real-session")).status).toBe(401);
  });

  it("is not there while fundraising is switched off", async () => {
    state.on = false;
    expect((await mine(12, "poster")).status).toBe(404);
  });

  it("is not there for a sign up that is new or declined", async () => {
    for (const status of ["new", "declined"]) {
      state.fundraisers = [record({ status })];
      expect((await mine(12, "poster")).status).toBe(404);
    }
  });

  it("keeps the certificate until the fundraiser is finished", async () => {
    expect((await mine(12, "certificate")).status).toBe(404);
    state.fundraisers = [record({ status: "finished" })];
    const res = await mine(12, "certificate");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Certificate of thanks");
    expect(html).toContain("£540");
    expect(html).not.toContain("Preview");
  });

  it("knows nothing of a piece it does not make, or an id that is not one", async () => {
    expect((await mine(12, "leaflet")).status).toBe(404);
    expect((await mine(0, "poster")).status).toBe(404);
    const res = await fetch(`${base}/api/fundraise/manage/fundraisers/abc/materials/poster`, { headers: { cookie: `nbcc_fr_session=${SAM}` } });
    expect(res.status).toBe(404);
  });

  it("never mentions the organiser's email or phone on any piece", async () => {
    state.fundraisers = [record({ status: "finished" })];
    for (const piece of ["poster", "social", "sponsor-form", "certificate"]) {
      const html = await (await mine(12, piece)).text();
      expect(html.toLowerCase()).not.toContain("sam.example@example.com");
      expect(html).not.toContain("07700 900123");
    }
  });
});

describe("staff, from Admin > Fundraising", () => {
  it("need to be signed in", async () => {
    expect((await staff(12, "poster", null)).status).toBe(401);
  });

  it("need the fundraising view permission", async () => {
    expect((await staff(12, "poster", staffToken({ fundraising: "none" }))).status).toBe(403);
    expect((await staff(12, "poster", staffToken({ fundraising: "view" }))).status).toBe(200);
  });

  it("open every piece of any approved fundraiser, even while fundraising is off", async () => {
    state.on = false;
    const token = staffToken({ fundraising: "view" });
    for (const piece of ["poster", "social", "sponsor-form"]) {
      const res = await staff(13, piece, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toContain("Alex&#39;s Bake Sale");
    }
  });

  it("preview the certificate before it is finished, marked as a preview", async () => {
    const html = await (await staff(12, "certificate", staffToken({ fundraising: "view" }))).text();
    expect(html).toContain("Certificate of thanks");
    expect(html).toContain("Preview");
  });

  it("get nothing for a sign up that is not approved, or one that is not there", async () => {
    const token = staffToken({ fundraising: "view" });
    state.fundraisers = [record({ status: "new" })];
    expect((await staff(12, "poster", token)).status).toBe(404);
    expect((await staff(99, "poster", token)).status).toBe(404);
    expect((await staff(12, "leaflet", token)).status).toBe(404);
  });
});
