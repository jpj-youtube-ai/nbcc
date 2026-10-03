import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// TASK-512: the routes of round two.
//   GET  /q/:code                                               a piece's own QR code: 302 to the page
//   GET  /api/admin/fundraisers/:id/materials/everything        every printed piece on one page (staff)
//   GET  /api/admin/fundraisers/:id/scans                       its scans per printed piece (staff)
//   POST /api/fundraise/manage/fundraisers/:id/print-request    "Ask us to print these" (the organiser)
// The database is mocked; every name and address here is invented.

const state = vi.hoisted(() => ({
  on: true,
  fundraisers: [] as unknown[],
  sessions: new Map<string, string>(),
  authRow: null as unknown,
  scans: [] as Array<{ campaign: string; scans: number }>,
  asks: [] as unknown[],
  askError: null as Error | null,
}));

vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => state.on,
  getFundraiser: async (id: number) => (state.fundraisers as FundraiserRecord[]).find((f) => f.id === id) ?? null,
}));
vi.mock("../../src/db/fundraiser-sign-in", () => ({
  findSession: async (hash: string) => (state.sessions.has(hash) ? { email: state.sessions.get(hash) } : null),
}));
vi.mock("../../src/db/fundraiser-materials", () => {
  class PrintAskError extends Error {}
  return {
    PrintAskError,
    materialScans: async () => state.scans,
    askToPrint: async (...args: unknown[]) => {
      if (state.askError) throw state.askError;
      state.asks.push(args);
      return { words: "Posters: they asked us to print 2 A4 posters" };
    },
    lastPrintAsks: async () => [],
  };
});
vi.mock("../../src/db/fundraising-requests", () => ({ listRequestRowsFor: async () => [] }));
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
    eventDate: "2099-12-05",
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
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    meter: meter({ onlinePence: 44000, cashPence: 10000, targetPence: 50000, giftAidPence: 4500 }),
    ...over,
  };
}

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(fundraiseMaterialsRouter);
  // The site's own 404 page, as in the real app, after everything else.
  app.use((_req, res) => res.status(404).send("site 404"));
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
  state.authRow = null;
  state.scans = [];
  state.asks = [];
  state.askError = null;
});

function staffToken(permissions: Record<string, string>, role = "viewer") {
  state.authRow = { id: 3, email: "kim@nbcc.test", status: "active", role, permissions };
  return signAdminSession({ sub: 3, email: "kim@nbcc.test", role, now: new Date(), secret: "test-admin-secret" }).token;
}
const staffGet = (path: string, token: string | null) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const scan = (code: string) => fetch(`${base}/q/${code}`, { redirect: "manual" });

describe("a piece's own QR code", () => {
  it("sends the scan to the page, tagged with the fundraiser and the piece", async () => {
    const res = await scan("12-a4");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/fundraise/sams-santa-dash?utm_medium=qr&utm_campaign=f12-a4");
    // Never kept, so a page whose address changes is followed at once.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("each piece says which it is", async () => {
    expect((await scan("12-a3")).headers.get("location")).toContain("utm_campaign=f12-a3");
    expect((await scan("12-A5")).headers.get("location")).toContain("utm_campaign=f12-a5");
  });

  it("keeps working when staff change the page's address: it finds the fundraiser by its id", async () => {
    state.fundraisers = [record({ slug: "sams-big-santa-dash" })];
    expect((await scan("12-a4")).headers.get("location")).toBe("/fundraise/sams-big-santa-dash?utm_medium=qr&utm_campaign=f12-a4");
  });

  it("leads to Get involved for a listed event", async () => {
    state.fundraisers = [record({ path: "event" })];
    expect((await scan("12-a4")).headers.get("location")).toBe("/get-involved?utm_medium=qr&utm_campaign=f12-a4");
  });

  it("is the site's 404 for a fundraiser that is not there, not ours to show, or a code that is not one", async () => {
    expect((await scan("99-a4")).status).toBe(404);
    expect((await scan("12-a9")).status).toBe(404);
    expect((await scan("12")).status).toBe(404);
    expect(await (await scan("99-a4")).text()).toBe("site 404");
    state.fundraisers = [record({ status: "declined" })];
    expect((await scan("12-a4")).status).toBe(404);
  });

  it("is the site's 404 while fundraising is switched off", async () => {
    state.on = false;
    expect((await scan("12-a4")).status).toBe(404);
  });

  it("never sends anyone to another website, whatever is added to it", async () => {
    for (const path of ["/q/12-a4?next=https://evil.example", "/q/12-a4?url=//evil.example"]) {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      expect(res.headers.get("location")).toBe("/fundraise/sams-santa-dash?utm_medium=qr&utm_campaign=f12-a4");
    }
    state.fundraisers = [record({ slug: "//evil.example" })];
    expect((await scan("12-a4")).status).toBe(404);
    expect((await fetch(`${base}/q/%2F%2Fevil.example`, { redirect: "manual" })).status).toBe(404);
  });
});

describe("the new sizes", () => {
  it("the organiser opens their A3 poster and A5 leaflet", async () => {
    for (const [piece, paper] of [["poster-a3", "A3"], ["leaflet", "A5"]]) {
      const res = await fetch(`${base}/api/fundraise/manage/fundraisers/12/materials/${piece}`, { headers: { cookie: `nbcc_fr_session=${SAM}` } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`@page{size:${paper} portrait;margin:0}`);
    }
  });

  it("staff open them too", async () => {
    const token = staffToken({ fundraising: "view" });
    expect((await staffGet("/api/admin/fundraisers/12/materials/leaflet", token)).status).toBe(200);
    expect((await staffGet("/api/admin/fundraisers/12/materials/poster-a3", token)).status).toBe(200);
  });
});

describe("Download everything", () => {
  it("is every printed piece on one page, for staff with the fundraising view permission", async () => {
    const res = await staffGet("/api/admin/fundraisers/12/materials/everything", staffToken({ fundraising: "view" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Everything for <b>Sam&#39;s Santa Dash</b>");
    expect(html).toContain("@page a3p{size:A3 portrait;margin:0}");
    expect(html).toMatch(/data-social-zip/);
  });

  it("is staff only", async () => {
    expect((await staffGet("/api/admin/fundraisers/12/materials/everything", null)).status).toBe(401);
    expect((await staffGet("/api/admin/fundraisers/12/materials/everything", staffToken({ fundraising: "none" }))).status).toBe(403);
    const organiser = await fetch(`${base}/api/fundraise/manage/fundraisers/12/materials/everything`, { headers: { cookie: `nbcc_fr_session=${SAM}` } });
    expect(organiser.status).toBe(404);
  });

  it("is nothing for a sign up that is not approved", async () => {
    state.fundraisers = [record({ status: "new" })];
    expect((await staffGet("/api/admin/fundraisers/12/materials/everything", staffToken({ fundraising: "view" }))).status).toBe(404);
  });
});

describe("scans per piece, in Admin > Fundraising", () => {
  it("gives each printed piece's count, none as nought", async () => {
    state.scans = [{ campaign: "f12-a4", scans: 7 }, { campaign: "f12-a5", scans: 2 }];
    const res = await staffGet("/api/admin/fundraisers/12/scans", staffToken({ fundraising: "view" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      scans: [
        { piece: "poster", code: "a4", label: "A4 poster", scans: 7, link: "https://nbcc.test/q/12-a4" },
        { piece: "poster-a3", code: "a3", label: "A3 poster", scans: 0, link: "https://nbcc.test/q/12-a3" },
        { piece: "leaflet", code: "a5", label: "A5 leaflet", scans: 2, link: "https://nbcc.test/q/12-a5" },
      ],
      total: 9,
    });
  });

  it("is staff only", async () => {
    expect((await staffGet("/api/admin/fundraisers/12/scans", null)).status).toBe(401);
    expect((await staffGet("/api/admin/fundraisers/12/scans", staffToken({ fundraising: "none" }))).status).toBe(403);
  });

  it("is a 404 for an id that is not one", async () => {
    expect((await staffGet("/api/admin/fundraisers/abc/scans", staffToken({ fundraising: "view" }))).status).toBe(404);
    expect((await staffGet("/api/admin/fundraisers/99/scans", staffToken({ fundraising: "view" }))).status).toBe(404);
  });
});

describe("Ask us to print these", () => {
  const ask = (id: number, body: unknown, session: string | null = SAM, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/fundraise/manage/fundraisers/${id}/print-request`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...(session ? { cookie: `nbcc_fr_session=${session}` } : {}), ...headers },
      body: JSON.stringify(body),
    });

  it("makes the request for the signed in organiser's own fundraiser", async () => {
    const res = await ask(12, { kind: "posters", a4: 2, a3: 0 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.status).toBe("asked");
    expect(body.print).toHaveProperty("canAsk");
    expect(state.asks).toHaveLength(1);
    const [id, theAsk, actor] = state.asks[0] as [number, unknown, string];
    expect(id).toBe(12);
    expect(theAsk).toEqual({ kind: "posters", a4: 2, a3: 0 });
    // As every other organiser action is recorded: the fundraiser itself says who.
    expect(actor).toBe("organiser");
  });

  it("only for their own: anyone else's reads as not there", async () => {
    expect((await ask(13, { kind: "posters", a4: 2, a3: 0 })).status).toBe(404);
    expect((await ask(12, { kind: "posters", a4: 2, a3: 0 }, ALEX)).status).toBe(404);
    expect(state.asks).toHaveLength(0);
  });

  it("asks someone not signed in to sign in again", async () => {
    expect((await ask(12, { kind: "posters", a4: 2, a3: 0 }, null)).status).toBe(401);
  });

  it("refuses a request another website's page sent", async () => {
    expect((await ask(12, { kind: "posters", a4: 2, a3: 0 }, SAM, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(state.asks).toHaveLength(0);
  });

  it("says what needs another look", async () => {
    const res = await ask(12, { kind: "posters", a4: 0, a3: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).fields.a4).toBe("Say how many posters you would like.");
    expect((await ask(12, { kind: "buckets", a4: 1 })).status).toBe(400);
  });

  it("explains when it is too late to ask online", async () => {
    const { PrintAskError } = await import("../../src/db/fundraiser-materials");
    state.askError = new PrintAskError("Too late.");
    const res = await ask(12, { kind: "leaflets", a5: 10 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Too late.");
  });

  it("is not there while fundraising is switched off", async () => {
    state.on = false;
    expect((await ask(12, { kind: "leaflets", a5: 10 })).status).toBe(404);
  });

  it("is limited, so nobody can fill our printing list", async () => {
    // Alex's own allowance, so the other tests' asks do not count against it.
    state.fundraisers = [record({ id: 13, email: "alex@example.com" })];
    const results: number[] = [];
    for (let i = 0; i < 12; i++) results.push((await ask(13, { kind: "leaflets", a5: 10 }, ALEX)).status);
    expect(results.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(results.slice(10)).toEqual([429, 429]);
  });
});

describe("the page address in words, as served", () => {
  // TASK-512: drawn from the fundraiser's CURRENT address, so a short initials address (TASK-511)
  // or one staff changed prints as it is now, on every piece.
  it("is the current address on each poster size, the pictures and the everything page", async () => {
    state.fundraisers = [record({ slug: "ssd" })];
    for (const piece of ["poster", "poster-a3", "leaflet"]) {
      const html = await (await fetch(`${base}/api/fundraise/manage/fundraisers/12/materials/${piece}`, { headers: { cookie: `nbcc_fr_session=${SAM}` } })).text();
      expect(html, piece).toContain("or visit nbcc.test/fundraise/ssd<");
      expect(html, piece).not.toContain("sams-santa-dash");
    }
    const social = await (await fetch(`${base}/api/fundraise/manage/fundraisers/12/materials/social`, { headers: { cookie: `nbcc_fr_session=${SAM}` } })).text();
    expect(social).toContain('"linkWords":"nbcc.test/fundraise/ssd"');
    const all = await (await staffGet("/api/admin/fundraisers/12/materials/everything", staffToken({ fundraising: "view" }))).text();
    expect(all.split("or visit nbcc.test/fundraise/ssd<").length - 1).toBe(3);
  });
});
