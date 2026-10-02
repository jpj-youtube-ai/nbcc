import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-507: the "Thank your supporters" API. The organiser's side reuses the private area's session,
// ownership and same origin checks (src/routes/fundraise.ts); staff's side needs the "fundraising"
// section (view to look, edit to decide). The database, the sending and the emails are mocked. What
// is checked: only the owner, only their own fundraiser's gifts, the safe fields only, the limits,
// the rude words check, who may decide, and that sending happens after staff have their answer.
// Every name and address here is invented.

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
const signIn = vi.hoisted(() => ({
  saveSignInCode: vi.fn(),
  countCodeTry: vi.fn(),
  deleteSignInCode: vi.fn(),
  createSession: vi.fn(),
  findSession: vi.fn(),
  deleteSession: vi.fn(),
}));
const { sendQueuedThanks, getUserAuthRowMock } = vi.hoisted(() => ({ sendQueuedThanks: vi.fn(), getUserAuthRowMock: vi.fn() }));

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
vi.mock("../../src/db/fundraiser-sign-in", () => signIn);
vi.mock("../../src/db/fundraising-requests", () => ({ listRequestRowsFor: vi.fn(async () => []) }));
vi.mock("../../src/fundraising/thanks-send", () => ({ sendQueuedThanks }));
vi.mock("../../src/fundraising/send", () => ({
  sendSignUpEmails: vi.fn(),
  sendSignInCodeEmail: vi.fn(),
  sendFinishedStaffEmail: vi.fn(),
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
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

import * as routes from "../../src/routes/fundraiser-thanks";
import { ThanksError } from "../../src/db/fundraiser-thanks";
import { hashSessionId, SESSION_COOKIE } from "../../src/fundraising/sign-in";
import { signAdminSession } from "../../src/admin/session";
import { meter, type FundraiserRecord, type WallSourceRow } from "../../src/fundraising/model";
import type { ThanksRow } from "../../src/fundraising/thanks";

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sentAt: number;
  status: (c: number) => MockRes;
  setHeader: (name: string, value: string) => MockRes;
  json: (b: unknown) => MockRes;
};
let clock = 0;
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, headers: {}, sentAt: 0 } as unknown as MockRes;
  res.setHeader = (name, value) => ((res.headers[name.toLowerCase()] = value), res);
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), (res.sentAt = ++clock), res);
  return res;
}

const SESSION = "a-session-id-for-tests";
type Opts = { body?: unknown; params?: Record<string, string>; session?: boolean; headers?: Record<string, string>; token?: string | null };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = { host: "nbcc.test", "sec-fetch-site": "same-origin", ...(o.headers ?? {}) };
  if (o.session !== false) headers.cookie = `${SESSION_COOKIE}=${SESSION}`;
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ body: o.body ?? {}, params: o.params ?? {}, ip: "10.9.0.1", headers } as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SECRET = "a-test-secret";
const STAFF = "fern@nbcc.test";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: STAFF, status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: STAFF, role, now: new Date(), secret: SECRET }).token;
}

const record = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 9,
    slug: "sams-walk",
    path: "raising",
    kind: "run_walk",
    title: "Sam's Walk",
    description: "Ten miles.",
    eventDate: null,
    startTime: null,
    venue: "",
    town: "Exampleton",
    targetPence: 25000,
    public: true,
    status: "approved",
    name: "Sam Sample",
    email: "sam@example.com",
    phone: "07700 900456",
    socialLink: null,
    socialOk: false,
    wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null,
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    updatedBy: null,
    meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
    editWaiting: false,
    ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter>; editWaiting: boolean };

const gift = (over: Partial<WallSourceRow> = {}): WallSourceRow => ({
  donationId: 41,
  fullName: "Alex Example",
  anonymous: false,
  showName: true,
  showAmount: true,
  amountPence: 2000,
  refundedPence: 0,
  message: "Go Sam!",
  hidden: false,
  createdAt: "2026-10-01T10:00:00.000Z",
  paidIn: false,
  giftAid: false,
  ...over,
});

const thanks = (over: Partial<ThanksRow> = {}): ThanksRow => ({
  id: 3,
  fundraiserId: 9,
  message: "Thank you all!",
  status: "pending",
  createdAt: "2026-10-02T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  rejectReason: null,
  deliveredAt: null,
  gifts: 1,
  waiting: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  ...over,
});

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(thanksDb), ...Object.values(signIn)]) fn.mockReset();
  sendQueuedThanks.mockReset().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 });
  getUserAuthRowMock.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  signIn.findSession.mockImplementation(async (hash: string) => (hash === hashSessionId(SESSION) ? { email: "Sam@Example.com" } : null));
  db.getFundraiser.mockResolvedValue(record());
  db.listForOrganiser.mockResolvedValue([record()]);
  db.wallRows.mockResolvedValue([gift()]);
  thanksDb.heldDonationIds.mockResolvedValue(new Set());
  thanksDb.listThanks.mockResolvedValue([]);
  thanksDb.hasQueuedThanks.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const P = { id: "9" };
const POST = { message: "Thank you all!", donationIds: [41] };

describe("the organiser reading their gifts and thank yous", () => {
  it("needs a session", async () => {
    expect((await run(routes.getOrganiserThanks, { session: false })).statusCode).toBe(401);
  });

  it("lists each of their fundraisers with the gifts to pick, as the gifts list shows them, and their thank yous", async () => {
    db.wallRows.mockResolvedValue([gift(), gift({ donationId: 42, paidIn: true }), gift({ donationId: 43, showName: false, createdAt: "2026-09-30T10:00:00.000Z" })]);
    thanksDb.heldDonationIds.mockResolvedValue(new Set([43]));
    thanksDb.listThanks.mockResolvedValue([thanks({ status: "approved", deliveredAt: "2026-10-02T11:00:00.000Z", sent: 1, rejectReason: "x" })]);
    const res = await run(routes.getOrganiserThanks);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      fundraisers: [
        {
          id: 9,
          canThank: true,
          gifts: [
            { donationId: 41, name: "Alex E.", amountPence: 2000, giftAidPence: null, message: "Go Sam!", createdAt: "2026-10-01T10:00:00.000Z", thanked: false },
            { donationId: 43, name: "Anonymous", amountPence: 2000, giftAidPence: null, message: "Go Sam!", createdAt: "2026-09-30T10:00:00.000Z", thanked: true },
          ],
          thanks: [{ id: 3, message: "Thank you all!", status: "approved", statusWords: "Sent to 1 supporter", createdAt: "2026-10-02T10:00:00.000Z", gifts: 1 }],
        },
      ],
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Example");
    expect(body).not.toContain("@");
    expect(thanksDb.listThanks).toHaveBeenCalledWith([9]);
    expect(db.listForOrganiser).toHaveBeenCalledWith("sam@example.com");
  });
});

describe("the organiser sending a thank you for checking", () => {
  it("is refused when another website's page sends it", async () => {
    const res = await run(routes.postOrganiserThanks, { params: P, body: POST, headers: { "sec-fetch-site": "cross-site" } });
    expect(res.statusCode).toBe(403);
    expect(thanksDb.createThanks).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    expect((await run(routes.postOrganiserThanks, { params: P, body: POST, session: false })).statusCode).toBe(401);
    expect(thanksDb.createThanks).not.toHaveBeenCalled();
  });

  it("reads someone else's fundraiser as not there", async () => {
    db.getFundraiser.mockResolvedValue(record({ email: "other@example.com" }));
    expect((await run(routes.postOrganiserThanks, { params: P, body: POST })).statusCode).toBe(404);
    expect(thanksDb.createThanks).not.toHaveBeenCalled();
  });

  it("is closed for a sign up that is not approved or finished", async () => {
    db.getFundraiser.mockResolvedValue(record({ status: "new" }));
    expect((await run(routes.postOrganiserThanks, { params: P, body: POST })).statusCode).toBe(410);
  });

  it("waits for staff: stored as the signed in organiser's, with the gifts they ticked", async () => {
    thanksDb.createThanks.mockResolvedValue({ verdict: "ok", thanks: thanks(), alreadyThanked: 0 });
    const res = await run(routes.postOrganiserThanks, { params: P, body: { message: "  Thank you all!  ", donationIds: [41, 41] } });
    expect(res.statusCode).toBe(202);
    expect(thanksDb.createThanks).toHaveBeenCalledWith(9, "sam@example.com", "Thank you all!", [41]);
    expect(res.body).toEqual({
      status: "waiting",
      alreadyThanked: 0,
      thanks: { id: 3, message: "Thank you all!", status: "pending", statusWords: "Waiting for us to check", createdAt: "2026-10-02T10:00:00.000Z", gifts: 1 },
    });
  });

  it("refuses rude words, naming the message box", async () => {
    const res = await run(routes.postOrganiserThanks, { params: P, body: { message: "Cheers you shit", donationIds: [41] } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields.message).toBe("Please choose different words for your thank you.");
    expect(thanksDb.createThanks).not.toHaveBeenCalled();
  });

  it("refuses a message over 600 characters, and no gifts ticked", async () => {
    expect((await run(routes.postOrganiserThanks, { params: P, body: { message: "a".repeat(601), donationIds: [41] } })).statusCode).toBe(400);
    const none = await run(routes.postOrganiserThanks, { params: P, body: { message: "Thanks", donationIds: [] } });
    expect(none.statusCode).toBe(400);
    expect((none.body as { fields: Record<string, string> }).fields.donationIds).toBe("Tick at least one gift to thank.");
  });

  it("refuses gifts that are not on this fundraiser (another's, a pay in, made up), storing nothing", async () => {
    thanksDb.createThanks.mockResolvedValue({ verdict: "bad_gift" });
    const res = await run(routes.postOrganiserThanks, { params: P, body: { message: "Thanks", donationIds: [41, 999] } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe("Some of those gifts cannot be thanked. Please refresh the page and try again.");
  });

  it("says so when every gift picked is thanked already", async () => {
    thanksDb.createThanks.mockResolvedValue({ verdict: "none" });
    const res = await run(routes.postOrganiserThanks, { params: P, body: POST });
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toBe("You have already thanked every gift you picked.");
  });

  it("allows three a day", async () => {
    thanksDb.createThanks.mockResolvedValue({ verdict: "limit" });
    const res = await run(routes.postOrganiserThanks, { params: P, body: POST });
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBe("You have sent 3 thank yous in the last day. Please try again tomorrow.");
  });

  it("says plainly when it cannot be saved", async () => {
    thanksDb.createThanks.mockRejectedValue(new Error("db down"));
    expect((await run(routes.postOrganiserThanks, { params: P, body: POST })).statusCode).toBe(500);
  });
});

describe("staff", () => {
  const D = { id: "9", thanksId: "3" };
  const VIEW: Array<[string, Handler, Opts]> = [
    ["the waiting counts", routes.getThanksWaiting, {}],
    ["a sign up's thank yous", routes.getAdminThanks, { params: P }],
  ];
  const EDIT: Array<[string, Handler, Opts]> = [
    ["approving", routes.postApproveThanks, { params: D }],
    ["not sending", routes.postRejectThanks, { params: D }],
  ];

  beforeEach(() => {
    thanksDb.pendingThanksByFundraiser.mockResolvedValue({ 9: 1 });
    thanksDb.listThanksForStaff.mockResolvedValue([]);
    thanksDb.decideThanks.mockResolvedValue(thanks({ status: "approved", waiting: 1 }));
  });

  it.each([...VIEW, ...EDIT])("%s needs a session", async (_w, handler, o) => {
    expect((await run(handler, { ...o, session: false, token: null })).statusCode).toBe(401);
  });

  it.each(VIEW)("a viewer may look at %s", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer") })).statusCode).toBe(200);
  });

  it.each(EDIT)("a viewer may not do %s", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer") })).statusCode).toBe(403);
    expect(thanksDb.decideThanks).not.toHaveBeenCalled();
  });

  it.each([...VIEW, ...EDIT])("someone without the section may not reach %s", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("editor", { overview: "view" }) })).statusCode).toBe(403);
  });

  it("counts the thank yous waiting on each sign up", async () => {
    const res = await run(routes.getThanksWaiting, { token: tokenFor("viewer") });
    expect(res.body).toEqual({ counts: { 9: 1 } });
  });

  it("starts the sender again when gifts were left queued (a restart, say)", async () => {
    thanksDb.hasQueuedThanks.mockResolvedValue(true);
    await run(routes.getThanksWaiting, { token: tokenFor("viewer") });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendQueuedThanks).toHaveBeenCalled();
  });

  it("shows staff each thank you with what happened to each gift, and why one was skipped", async () => {
    thanksDb.listThanksForStaff.mockResolvedValue([
      { ...thanks({ status: "approved" }), recipients: [{ donationId: 41, name: "Alex Example", amountPence: 2000, outcome: "skipped", skipReason: "suppressed", sentAt: null }] },
    ]);
    const res = await run(routes.getAdminThanks, { params: P, token: tokenFor("viewer") });
    const [t] = (res.body as { thanks: Array<Record<string, unknown>> }).thanks;
    expect(t).toMatchObject({ id: 3, status: "approved", statusWords: "Sending now", gifts: 1 });
    expect(t.recipients).toEqual([
      { donationId: 41, name: "Alex Example", amountPence: 2000, outcome: "skipped", outcomeWords: "Not sent: On the do not email list (a bounce, a complaint, or stopped by staff)", sentAt: null },
    ]);
  });

  it("approves as the signed in member of staff, answers, and only then sends in the background", async () => {
    let finished = 0;
    sendQueuedThanks.mockImplementation(async () => {
      finished = ++clock;
      return { sent: 1, skipped: 0, failed: 0 };
    });
    const res = await run(routes.postApproveThanks, { params: D, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(thanksDb.decideThanks).toHaveBeenCalledWith(9, 3, "approve", `admin:${STAFF}`, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendQueuedThanks).toHaveBeenCalledTimes(1);
    expect(res.sentAt).toBeLessThan(finished);
  });

  it("still answers when the sending fails at once", async () => {
    sendQueuedThanks.mockRejectedValue(new Error("boom"));
    const res = await run(routes.postApproveThanks, { params: D, token: tokenFor("editor") });
    await new Promise((r) => setTimeout(r, 0));
    expect(res.statusCode).toBe(200);
  });

  it("does not send, with a reason kept for staff, and emails nobody", async () => {
    thanksDb.decideThanks.mockResolvedValue(thanks({ status: "rejected", rejectReason: "Names a giver" }));
    const res = await run(routes.postRejectThanks, { params: D, body: { reason: " Names a giver " }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(thanksDb.decideThanks).toHaveBeenCalledWith(9, 3, "reject", `admin:${STAFF}`, "Names a giver");
    await new Promise((r) => setTimeout(r, 0));
    expect(sendQueuedThanks).not.toHaveBeenCalled();
  });

  it("keeps a reason to 500 characters", async () => {
    const res = await run(routes.postRejectThanks, { params: D, body: { reason: "a".repeat(501) }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(400);
  });

  it("says to look again when it was already decided, and not found when it is not this sign up's", async () => {
    thanksDb.decideThanks.mockRejectedValueOnce(new ThanksError("not_waiting"));
    expect((await run(routes.postApproveThanks, { params: D, token: tokenFor("editor") })).statusCode).toBe(409);
    thanksDb.decideThanks.mockRejectedValueOnce(new ThanksError("not_found"));
    expect((await run(routes.postApproveThanks, { params: D, token: tokenFor("editor") })).statusCode).toBe(404);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendQueuedThanks).not.toHaveBeenCalled();
  });

  it("refuses an id that is not one", async () => {
    expect((await run(routes.postApproveThanks, { params: { id: "9", thanksId: "x" }, token: tokenFor("editor") })).statusCode).toBe(400);
  });
});

describe("how the app mounts it", () => {
  // Read from the source: the app itself needs a whole environment to start.
  const app = readFileSync(resolve(__dirname, "../../src/app.ts"), "utf8");
  const at = (s: string) => app.indexOf(s);

  it("comes before the private area's router, whose retired link route would read thanks as a link", () => {
    expect(at("app.use(fundraiserThanksRouter);")).toBeGreaterThan(-1);
    expect(at("app.use(fundraiserThanksRouter);")).toBeLessThan(at("app.use(fundraiseRouter);"));
  });
});
