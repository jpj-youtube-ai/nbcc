import { describe, it, expect, vi, beforeEach } from "vitest";

// Welcome packs: the API behind the tick list in Admin > Fundraising. Viewers see every pack and can
// open its print view; editors and admins tick, leave out, mark sent and undo. The database is
// mocked. Every name, place and number is invented.

const { getUserAuthRowMock, listAllFundraisers, getFundraiser, listPacks, listPosterSizes, getPack, posterSizesFor, lastSignerFor, changePack } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  listAllFundraisers: vi.fn(),
  getFundraiser: vi.fn(),
  listPacks: vi.fn(),
  listPosterSizes: vi.fn(),
  getPack: vi.fn(),
  posterSizesFor: vi.fn(),
  lastSignerFor: vi.fn(),
  changePack: vi.fn(),
}));

vi.mock("../../src/db/welcome-packs", () => {
  class PackError extends Error {
    constructor(
      public readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { listPacks, listPosterSizes, getPack, posterSizesFor, lastSignerFor, changePack, PackError };
});
vi.mock("../../src/db/fundraisers", () => ({ listAllFundraisers, getFundraiser }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
// The real Signed by list, with a switch to make reading it fail.
const signerList = vi.hoisted(() => ({ broken: false }));
vi.mock("../../src/fundraising/signers", async (original) => {
  const real = await original<typeof import("../../src/fundraising/signers")>();
  const orBroken = <T extends (...a: never[]) => unknown>(fn: T) =>
    ((...a: Parameters<T>) => {
      if (signerList.broken) throw new Error("the list could not be read");
      return fn(...a);
    }) as T;
  return { ...real, listedSigner: orBroken(real.listedSigner), listedSigners: orBroken(real.listedSigners) };
});

import * as routes from "../../src/routes/admin-welcome-packs";
import { signAdminSession } from "../../src/admin/session";
import { PackError } from "../../src/db/welcome-packs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// The admin's one list of who can sign for NBCC (assets/js/admin/helpers.js): the server checks a
// chosen signer against the same file the screen builds its list from.
const SIGNERS = createRequire(import.meta.url)(resolve(__dirname, "../../assets/js/admin/helpers.js")).SIGNERS as Array<{ name: string; role: string }>;

const SECRET = "test-admin-secret";
const EMAIL = "fern@example.com";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 3, email: EMAIL, status: "active", role, permissions });
  return signAdminSession({ sub: 3, email: EMAIL, role, now: new Date(), secret: SECRET }).token;
}

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  contentType: string;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  type: (t: string) => MockRes;
  send: (b: unknown) => MockRes;
  setHeader: (k: string, v: string) => void;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, headers: {}, contentType: "" } as MockRes;
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.type = (t) => ((res.contentType = t), res);
  res.send = (b) => ((res.body = b), res);
  res.setHeader = (k, v) => void (res.headers[k] = v);
  return res;
}
type Opts = { token?: string | null; body?: unknown; params?: Record<string, string>; query?: Record<string, string> };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ headers, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} } as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
const fundraiser = (id: number, over: Record<string, unknown> = {}) => ({
  id, slug: `walk-${id}`, path: "raising", kind: "walk", title: `Walk ${id}`, description: "Five miles.", status: "approved", public: true,
  name: "Robin Example", firstName: "Robin", lastName: "Example", email: "robin@example.com", eventDate: "2026-12-12", startTime: null,
  venue: "", town: "Exampleton", targetPence: 50000, wants: { ...NONE }, postAddress: null, postLine1: "1 Example Road", postLine2: null,
  postTown: "Exampleton", postPostcode: "EX1 1EX", approvedAt: "2026-10-01T09:00:00.000Z", inMemory: false, teamId: null,
  // A team organiser's page: a sponsorship fundraiser, so its pack has the sponsor form.
  isTeam: true, isSporting: false, tshirtSize: null, meter: { raisedPence: 0, giftAidPence: 0 },
  ...over,
});
const WORDS: Record<string, string> = { letter: "Welcome letter", sponsor_form: "Sponsor form" };
const tickedItem = (key: string) => ({ key, label: WORDS[key] ?? key, quantity: null, tickedAt: "2026-10-03T10:00:00.000Z", tickedBy: "admin:fern@example.com", skippedReason: null });

beforeEach(() => {
  for (const m of [getUserAuthRowMock, listAllFundraisers, getFundraiser, listPacks, listPosterSizes, getPack, posterSizesFor, lastSignerFor, changePack]) m.mockReset();
  listPacks.mockResolvedValue(new Map());
  listPosterSizes.mockResolvedValue(new Map());
  getPack.mockResolvedValue(null);
  posterSizesFor.mockResolvedValue(null);
  lastSignerFor.mockResolvedValue(null);
});

describe("GET /api/admin/fundraising/packs", () => {
  it("needs a session, and Fundraising", async () => {
    expect((await run(routes.getPacks)).statusCode).toBe(401);
    expect((await run(routes.getPacks, { token: tokenFor("viewer", { fundraising: "none" }) })).statusCode).toBe(403);
  });

  it("gives a viewer every page's pack, which are still to send, and who they last had sign", async () => {
    listAllFundraisers.mockResolvedValue([
      fundraiser(1, { wants: { ...NONE, posterCount: 12 } }),
      fundraiser(2, { status: "new" }),
      fundraiser(3),
      fundraiser(4, { inMemory: true, memoryName: "Margaret Exampleton", wants: { ...NONE, envelopeCount: 30 } }),
      fundraiser(5, { status: "finished" }),
    ]);
    listPosterSizes.mockResolvedValue(new Map([[1, { a4: 10, a3: 2 }]]));
    listPacks.mockResolvedValue(
      new Map([[3, { sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", signer: null, signerRole: null, items: [tickedItem("letter"), tickedItem("sponsor_form")] }]]),
    );
    lastSignerFor.mockResolvedValue({ name: "Fern Example", role: "Volunteer" });
    const res = await run(routes.getPacks, { token: tokenFor("viewer", { fundraising: "view" }) });
    expect(res.statusCode).toBe(200);
    const body = res.body as { packs: Record<string, { title: string; state: string; items: Array<{ words: string }> }>; toSend: Record<string, true>; mySigner: unknown };
    expect(Object.keys(body.packs).sort()).toEqual(["1", "3", "4", "5"]);
    expect(body.packs["1"].items.map((i) => i.words)).toEqual(["Welcome letter", "10 A4 posters", "2 A3 posters", "Sponsor form"]);
    expect(body.packs["3"].state).toBe("sent");
    expect(body.packs["4"].title).toBe("Things to send");
    // Still to send: approved, with a pack, not sent. A finished one is past it.
    expect(body.toSend).toEqual({ "1": true, "4": true });
    expect(body.mySigner).toEqual({ name: "Fern Example", role: "Volunteer" });
    expect(lastSignerFor).toHaveBeenCalledWith("admin:fern@example.com");
  });

  it("says so when the database is down", async () => {
    listAllFundraisers.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await run(routes.getPacks, { token: tokenFor("admin") })).statusCode).toBe(500);
  });
});

describe("POST /api/admin/fundraisers/:id/pack", () => {
  const P = { id: "9" };
  it("is refused for a viewer", async () => {
    const res = await run(routes.postPack, { token: tokenFor("viewer", { fundraising: "view" }), params: P, body: { action: "tick", key: "letter", words: "Welcome letter" } });
    expect(res.statusCode).toBe(403);
    expect(changePack).not.toHaveBeenCalled();
  });

  it("lets an editor tick, recorded as them", async () => {
    changePack.mockResolvedValue({ view: { state: "part" }, words: "Welcome pack: 10 A4 posters ticked", requestWords: ["Posters: sent (by post)"] });
    const res = await run(routes.postPack, { token: tokenFor("editor", { fundraising: "edit" }), params: P, body: { action: "tick", key: "posters_a4", words: "10 A4 posters", quantity: 10 } });
    expect(res.statusCode).toBe(200);
    // With today as a UK day, for the request the tick marks as sent.
    // What staff saw goes with the tick.
    expect(changePack).toHaveBeenCalledWith(9, { action: "tick", key: "posters_a4", words: "10 A4 posters", quantity: 10 }, "admin:fern@example.com", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(res.body).toEqual({ pack: { state: "part" }, words: "Welcome pack: 10 A4 posters ticked", requests: ["Posters: sent (by post)"] });
  });

  it("takes a signer only from the Signed by list, with the title the list gives them", async () => {
    const stranger = await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "signer", name: "Nobody Madeup", role: "Chief of Everything" } });
    expect(stranger.statusCode).toBe(400);
    expect((stranger.body as { fields: Record<string, string> }).fields.name).toBe("Choose someone from the Signed by list.");
    expect(changePack).not.toHaveBeenCalled();
    changePack.mockResolvedValue({ view: { state: "to_pack" }, words: "x", requestWords: [] });
    const ok = await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "signer", name: SIGNERS[1].name, role: "A title somebody typed" } });
    expect(ok.statusCode).toBe(200);
    expect(changePack.mock.calls[0][1]).toEqual({ action: "signer", name: SIGNERS[1].name, role: SIGNERS[1].role });
  });

  it("asks for a reason to leave something out", async () => {
    const res = await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "skip", key: "sponsor_form", words: "Sponsor form", reason: "" } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields.reason).toBe("Say why it is being left out.");
    expect(changePack).not.toHaveBeenCalled();
  });

  it("needs what was seen with a tick, and answers 409 when the list has changed since", async () => {
    const bare = await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "tick", key: "letter" } });
    expect(bare.statusCode).toBe(400);
    expect(changePack).not.toHaveBeenCalled();
    changePack.mockRejectedValue(new PackError("conflict", "This has changed since you opened the page. Check the list and tick it again."));
    const stale = await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "tick", key: "posters_a4", words: "10 A4 posters", quantity: 10 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.body).toEqual({ error: "This has changed since you opened the page. Check the list and tick it again." });
  });

  it("answers properly when the Signed by list cannot be read", async () => {
    signerList.broken = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "signer", name: SIGNERS[0].name } });
    signerList.broken = false;
    errors.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
    expect(changePack).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a number, and an action it does not know", async () => {
    expect((await run(routes.postPack, { token: tokenFor("admin"), params: { id: "x" }, body: { action: "send" } })).statusCode).toBe(400);
    expect((await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "post" } })).statusCode).toBe(400);
  });

  it("answers 409 with the reason when the pack is not ready, and 404 when there is none", async () => {
    changePack.mockRejectedValue(new PackError("conflict", "Tick everything, or leave it out with a reason, before marking it as sent."));
    const res = await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "send" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Tick everything, or leave it out with a reason, before marking it as sent." });
    changePack.mockRejectedValue(new PackError("no_pack", "There is no pack for this one."));
    expect((await run(routes.postPack, { token: tokenFor("admin"), params: P, body: { action: "send" } })).statusCode).toBe(404);
  });
});

describe("GET /api/admin/fundraisers/:id/pack/print", () => {
  const P = { id: "9" };
  it("needs Fundraising", async () => {
    expect((await run(routes.getPackPrint, { params: P })).statusCode).toBe(401);
  });

  it("gives a viewer the whole pack as one private page, signed by whoever was chosen for it", async () => {
    getFundraiser.mockResolvedValue(fundraiser(9, { wants: { ...NONE, posterCount: 2 } }));
    getPack.mockResolvedValue({ sentAt: null, sentBy: null, signer: SIGNERS[2].name, signerRole: SIGNERS[2].role, items: [] });
    const res = await run(routes.getPackPrint, { token: tokenFor("viewer", { fundraising: "view" }), params: P });
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe("html");
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    const html = String(res.body);
    expect(html).toContain("Welcome pack for Walk 9");
    expect(html).toContain('data-pack-piece="posters_a4" data-copies="2"');
    expect(html).toContain('data-pack-piece="sponsor_form"');
    expect(html).toContain(SIGNERS[2].name);
    expect(html).not.toContain(SIGNERS[0].name);
    expect(html).toContain("nbcc.test/fundraise/walk-9");
  });

  it("signs with the staff member's last choice when none was chosen for this pack, and prints the letter only when asked", async () => {
    getFundraiser.mockResolvedValue(fundraiser(9));
    lastSignerFor.mockResolvedValue({ name: "Fern Example", role: null });
    const res = await run(routes.getPackPrint, { token: tokenFor("admin"), params: P, query: { part: "letter" } });
    const html = String(res.body);
    expect(html).toContain("Welcome letter for Walk 9");
    expect(html).toContain("Fern Example");
    expect(html).not.toContain('data-pack-piece="sponsor_form"');
  });

  it("signs as the panel shows by default when nobody has chosen: the first on the Signed by list", async () => {
    getFundraiser.mockResolvedValue(fundraiser(9));
    const res = await run(routes.getPackPrint, { token: tokenFor("viewer", { fundraising: "view" }), params: P });
    expect(String(res.body)).toContain(SIGNERS[0].name);
    expect(String(res.body)).not.toContain("The NBCC team");
  });

  it("is not there for a sign up with no pack", async () => {
    getFundraiser.mockResolvedValue(fundraiser(9, { status: "new" }));
    expect((await run(routes.getPackPrint, { token: tokenFor("admin"), params: P })).statusCode).toBe(404);
    getFundraiser.mockResolvedValue(null);
    expect((await run(routes.getPackPrint, { token: tokenFor("admin"), params: P })).statusCode).toBe(404);
  });
});
