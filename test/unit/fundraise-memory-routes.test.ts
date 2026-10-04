import { describe, it, expect, vi, beforeEach } from "vitest";

// In memory pages (Jaimie, 2026-10-03): the routes. The organiser's private area shows who gave and
// asked to let the family know (names and approved messages only, never an amount or an email), and
// thanking is held to them; a giver's tick is kept only on an in memory page; staff approve each
// message, see how many wait, mark the year on reminder dealt with, and print the collection
// envelopes, as the organiser can from their private area. The database is mocked. Every name and
// address here is invented.

const db = vi.hoisted(() => ({
  fundraisingIsOn: vi.fn(),
  listForOrganiser: vi.fn(),
  getFundraiser: vi.fn(),
  wallRows: vi.fn(),
  requestEdit: vi.fn(),
  markFinishedRequested: vi.fn(),
  waitingEditFor: vi.fn(),
  createFundraiser: vi.fn(),
  getBySlug: vi.fn(),
  listApprovedPublic: vi.fn(),
  addWallMessage: vi.fn(),
}));
const thanksDb = vi.hoisted(() => ({
  heldDonationIds: vi.fn(),
  listThanks: vi.fn(),
  createThanks: vi.fn(),
  pendingThanksByFundraiser: vi.fn(),
  listThanksForStaff: vi.fn(),
  decideThanks: vi.fn(),
  hasQueuedThanks: vi.fn(),
}));
const memoryDb = vi.hoisted(() => ({
  approveMemoryMessage: vi.fn(),
  heldMessageCounts: vi.fn(),
  countHeldMessages: vi.fn(),
  markMemoryYearOnDone: vi.fn(),
  setFundraiserMemory: vi.fn(),
}));
const signIn = vi.hoisted(() => ({
  saveSignInCode: vi.fn(),
  countCodeTry: vi.fn(),
  deleteSignInCode: vi.fn(),
  createSession: vi.fn(),
  findSession: vi.fn(),
  deleteSession: vi.fn(),
}));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/fundraisers", async () => {
  class FundraiserError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...db, FundraiserError };
});
vi.mock("../../src/db/fundraiser-thanks", async () => {
  class ThanksError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...thanksDb, ThanksError };
});
vi.mock("../../src/db/fundraiser-memory", async () => {
  class MemoryError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...memoryDb, MemoryError };
});
vi.mock("../../src/db/fundraiser-sign-in", () => signIn);
vi.mock("../../src/db/fundraising-requests", () => ({ listRequestRowsFor: vi.fn(async () => []) }));
vi.mock("../../src/db/welcome-packs", () => ({ getPack: vi.fn(async () => null) }));
vi.mock("../../src/db/fundraiser-materials", () => ({ lastPrintAsks: vi.fn(async () => []), materialScans: vi.fn(), askToPrint: vi.fn(), PrintAskError: Error }));
vi.mock("../../src/fundraising/thanks-send", () => ({ sendQueuedThanks: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0 })) }));
vi.mock("../../src/fundraising/send", () => ({
  sendSignUpEmails: vi.fn(),
  sendSignInCodeEmail: vi.fn(),
  sendFinishedStaffEmail: vi.fn(),
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  siteUrl: (path: string) => `https://nbcc.test${path}`,
  manageUrl: () => "https://nbcc.test/fundraise/manage",
}));
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "production",
    PORTAL_BASE_URL: "https://nbcc.test",
    ADMIN_SESSION_SECRET: "a-test-secret",
    DATABASE_URL: "postgres://localhost:5432/test",
  },
}));

import { getManageSession, postWallMessage } from "../../src/routes/fundraise";
import { getOrganiserThanks } from "../../src/routes/fundraiser-thanks";
import * as memory from "../../src/routes/fundraise-memory";
import { MemoryError } from "../../src/db/fundraiser-memory";
import { hashSessionId, SESSION_COOKIE } from "../../src/fundraising/sign-in";
import { signAdminSession } from "../../src/admin/session";
import { meter, type FundraiserRecord, type WallSourceRow } from "../../src/fundraising/model";

type MockRes = {
  statusCode: number;
  body: unknown;
  text: string;
  headers: Record<string, string>;
  status: (c: number) => MockRes;
  setHeader: (name: string, value: string) => MockRes;
  json: (b: unknown) => MockRes;
  type: (t: string) => MockRes;
  send: (b: string) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, text: "", headers: {} } as unknown as MockRes;
  res.setHeader = (name, value) => ((res.headers[name.toLowerCase()] = value), res);
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.type = () => res;
  res.send = (b) => ((res.text = b), res);
  return res;
}

const SESSION = "a-session-id-for-tests";
type Opts = { body?: unknown; params?: Record<string, string>; session?: boolean; token?: string | null };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = { host: "nbcc.test", "sec-fetch-site": "same-origin" };
  if (o.session !== false) headers.cookie = `${SESSION_COOKIE}=${SESSION}`;
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ body: o.body ?? {}, params: o.params ?? {}, ip: "10.9.0.7", headers, query: {} } as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const STAFF = "fern@nbcc.test";
function tokenFor(role: string) {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: STAFF, status: "active", role, permissions: {} });
  return signAdminSession({ sub: 1, email: STAFF, role, now: new Date(), secret: "a-test-secret" }).token;
}

const record = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 9, slug: "ime", path: "raising", kind: "other", title: "In memory of Margaret Exampleton", description: "Remembering Margaret.",
    eventDate: null, startTime: null, venue: "", town: "Exampleton", targetPence: 25000, public: true, status: "approved",
    name: "Sam Sample", email: "sam@example.com", phone: "07700 900456", socialLink: null, socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z",
    approvedAt: "2026-10-01T11:00:00.000Z", approvedBy: null, updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: null,
    inMemory: true, memoryName: "Margaret Exampleton", memoryDates: "1948 to 2026", memorySetupBy: "family", memoryPermission: true,
    memoryShowTarget: false, meter: meter({ onlinePence: 6000, cashPence: 0, targetPence: 25000 }), editWaiting: false, ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter>; editWaiting: boolean };

const gift = (over: Partial<WallSourceRow> = {}): WallSourceRow => ({
  donationId: 41, fullName: "Alex Example", anonymous: true, showName: false, showAmount: true, amountPence: 2000, refundedPence: 0,
  message: "Thinking of you.", hidden: false, createdAt: "2026-10-02T10:00:00.000Z", paidIn: false, giftAid: false, held: false,
  familyNotify: true, ...over,
});

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(thanksDb), ...Object.values(memoryDb), ...Object.values(signIn)]) fn.mockReset();
  getUserAuthRowMock.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  signIn.findSession.mockImplementation(async (hash: string) => (hash === hashSessionId(SESSION) ? { email: "sam@example.com" } : null));
  db.waitingEditFor.mockResolvedValue(null);
  thanksDb.heldDonationIds.mockResolvedValue(new Set());
  thanksDb.listThanks.mockResolvedValue([]);
});

describe("the organiser's private area, in memory", () => {
  it("lists only those who asked to let the family know: their names and approved messages, never amounts or emails", async () => {
    db.listForOrganiser.mockResolvedValue([record()]);
    db.wallRows.mockResolvedValue([
      gift({ donationId: 41 }),
      gift({ donationId: 42, fullName: "Jo Quiet", familyNotify: false }),
      gift({ donationId: 43, fullName: "Lee Waiting", message: "Still to check", held: true, createdAt: "2026-10-01T10:00:00.000Z" }),
    ]);
    const res = await run(getManageSession);
    expect(res.statusCode).toBe(200);
    const f = (res.body as { fundraisers: Array<Record<string, unknown>> }).fundraisers[0];
    const gifts = f.gifts as Array<Record<string, unknown>>;
    expect(gifts.map((g) => g.name)).toEqual(["Alex Example", "Lee Waiting"]);
    expect(gifts.every((g) => g.amountPence === null)).toBe(true);
    expect(gifts[1].message).toBeNull();
    expect(JSON.stringify(f)).not.toContain("Jo Quiet");
    expect(JSON.stringify(f)).not.toContain("example.com\",\"name");
    expect(f.memory).toEqual({ name: "Margaret Exampleton", dates: "1948 to 2026", showTarget: false });
    expect((f.materials as Record<string, string>).envelopes).toBe("/api/fundraise/manage/fundraisers/9/materials/envelopes");
  });

  it("is unchanged for any other page", async () => {
    db.listForOrganiser.mockResolvedValue([record({ inMemory: false, memoryName: null })]);
    db.wallRows.mockResolvedValue([gift({ familyNotify: false, anonymous: false, showName: true })]);
    const f = ((await run(getManageSession)).body as { fundraisers: Array<Record<string, unknown>> }).fundraisers[0];
    expect((f.gifts as Array<Record<string, unknown>>)[0]).toMatchObject({ name: "Alex E.", amountPence: 2000 });
    expect(f.memory ?? null).toBeNull();
    expect((f.materials as Record<string, string | null>).envelopes ?? null).toBeNull();
  });

  it("offers only those who asked to let the family know to thank, with no amounts", async () => {
    db.listForOrganiser.mockResolvedValue([record()]);
    db.wallRows.mockResolvedValue([gift({ donationId: 41 }), gift({ donationId: 42, fullName: "Jo Quiet", familyNotify: false })]);
    const res = await run(getOrganiserThanks);
    const f = (res.body as { fundraisers: Array<{ gifts: Array<Record<string, unknown>> }> }).fundraisers[0];
    expect(f.gifts.map((g) => g.donationId)).toEqual([41]);
    expect(f.gifts[0]).toMatchObject({ name: "Alex Example", amountPence: null, thanked: false });
  });
});

describe("a giver's tick", () => {
  it("is kept on an in memory page", async () => {
    db.getBySlug.mockResolvedValue(record());
    db.addWallMessage.mockResolvedValue({ verdict: "ok", entry: null });
    await run(postWallMessage, { params: { slug: "ime" }, body: { sessionId: "cs_test_1", message: "Thinking of you.", familyNotify: true } });
    // Review fix: asking to let the family know keeps the amount off the page.
    expect(db.addWallMessage).toHaveBeenCalledWith("cs_test_1", 9, { message: "Thinking of you.", showName: false, showAmount: false, familyNotify: true });
  });

  it("is never kept on any other page", async () => {
    db.getBySlug.mockResolvedValue(record({ inMemory: false }));
    db.addWallMessage.mockResolvedValue({ verdict: "ok", entry: null });
    await run(postWallMessage, { params: { slug: "ime" }, body: { sessionId: "cs_test_1", message: "Go!", familyNotify: true } });
    expect(db.addWallMessage).toHaveBeenCalledWith("cs_test_1", 9, { message: "Go!", showName: false, showAmount: true });
  });
});

describe("staff", () => {
  it("approve a message with edit, and are refused with view only", async () => {
    let res = await run(memory.postApproveMemoryMessage, { params: { id: "9", donationId: "41" }, token: tokenFor("viewer") });
    expect(res.statusCode).toBe(403);
    expect(memoryDb.approveMemoryMessage).not.toHaveBeenCalled();
    res = await run(memory.postApproveMemoryMessage, { params: { id: "9", donationId: "41" }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(memoryDb.approveMemoryMessage).toHaveBeenCalledWith(9, 41, `admin:${STAFF}`);
  });

  it("hear when the message is not there", async () => {
    memoryDb.approveMemoryMessage.mockRejectedValue(new MemoryError("not_found"));
    const res = await run(memory.postApproveMemoryMessage, { params: { id: "9", donationId: "41" }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(404);
  });

  it("see how many messages wait on each in memory page", async () => {
    memoryDb.heldMessageCounts.mockResolvedValue({ 9: 2 });
    const res = await run(memory.getMemoryWaiting, { token: tokenFor("viewer") });
    expect(res.body).toEqual({ counts: { 9: 2 } });
  });

  it("mark the year on reminder dealt with, with a short note", async () => {
    let res = await run(memory.postMemoryYearOnDone, { params: { id: "9" }, body: { note: "Rang them." }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(memoryDb.markMemoryYearOnDone).toHaveBeenCalledWith(9, `admin:${STAFF}`, "Rang them.");
    res = await run(memory.postMemoryYearOnDone, { params: { id: "9" }, body: { note: "x".repeat(501) }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(400);
    memoryDb.markMemoryYearOnDone.mockRejectedValue(new MemoryError("not_found"));
    res = await run(memory.postMemoryYearOnDone, { params: { id: "9" }, body: {}, token: tokenFor("editor") });
    expect(res.statusCode).toBe(409);
  });

  it("print the envelopes of an in memory page, and of no other", async () => {
    db.getFundraiser.mockResolvedValue(record());
    let res = await run(memory.getStaffEnvelopes, { params: { id: "9" }, token: tokenFor("viewer") });
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("In memory of");
    expect(res.headers["cache-control"]).toBe("no-store");
    db.getFundraiser.mockResolvedValue(record({ inMemory: false }));
    res = await run(memory.getStaffEnvelopes, { params: { id: "9" }, token: tokenFor("viewer") });
    expect(res.statusCode).toBe(404);
  });
});

describe("the organiser's envelopes", () => {
  it("open for their own in memory page", async () => {
    db.getFundraiser.mockResolvedValue(record());
    const res = await run(memory.getOrganiserEnvelopes, { params: { id: "9" } });
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Margaret Exampleton");
  });

  it("ask them to sign in again without a session", async () => {
    db.getFundraiser.mockResolvedValue(record());
    const res = await run(memory.getOrganiserEnvelopes, { params: { id: "9" }, session: false });
    expect(res.statusCode).toBe(401);
  });

  it("read as not there for someone else's page, a new one, or one not in memory", async () => {
    for (const over of [{ email: "someone@example.com" }, { status: "new" as const }, { inMemory: false }]) {
      db.getFundraiser.mockResolvedValue(record(over));
      const res = await run(memory.getOrganiserEnvelopes, { params: { id: "9" } });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe("staff correcting the in memory details", () => {
  const body = { memoryName: "Margaret Exampleton", memoryDates: "1948 to 2026", memorySetupBy: "family", memoryShowTarget: true };

  it("are for admins only", async () => {
    const res = await run(memory.putMemoryDetails, { params: { id: "9" }, body, token: tokenFor("editor") });
    expect(res.statusCode).toBe(403);
    expect(memoryDb.setFundraiserMemory).not.toHaveBeenCalled();
  });

  it("are saved, and answer with the record", async () => {
    db.getFundraiser.mockResolvedValue(record({ memoryShowTarget: true }));
    const res = await run(memory.putMemoryDetails, { params: { id: "9" }, body, token: tokenFor("admin") });
    expect(res.statusCode).toBe(200);
    expect(memoryDb.setFundraiserMemory).toHaveBeenCalledWith(9, body, `admin:${STAFF}`);
  });

  it("name each box that needs another look", async () => {
    const res = await run(memory.putMemoryDetails, { params: { id: "9" }, body: { ...body, memoryName: "" }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields.memoryName).toBeTruthy();
  });

  it("are refused on a page that is not in memory", async () => {
    memoryDb.setFundraiserMemory.mockRejectedValue(new MemoryError("not_found"));
    const res = await run(memory.putMemoryDetails, { params: { id: "9" }, body, token: tokenFor("admin") });
    expect(res.statusCode).toBe(404);
  });
});

describe("review: a giver who asks to let the family know", () => {
  it("never has their amount shown on the page", async () => {
    db.getBySlug.mockResolvedValue(record());
    db.addWallMessage.mockResolvedValue({ verdict: "ok", entry: null });
    await run(postWallMessage, { params: { slug: "ime" }, body: { sessionId: "cs_test_1", message: "", showAmount: true, familyNotify: true } });
    expect(db.addWallMessage).toHaveBeenCalledWith("cs_test_1", 9, { message: "", showName: false, showAmount: false, familyNotify: true });
  });
});

describe("review: the certificate", () => {
  it("is not offered for an in memory page", async () => {
    db.listForOrganiser.mockResolvedValue([record({ status: "finished" })]);
    db.wallRows.mockResolvedValue([]);
    const f = ((await run(getManageSession)).body as { fundraisers: Array<{ materials: Record<string, string | null> }> }).fundraisers[0];
    expect(f.materials.certificate).toBeNull();
  });
});
