import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-493: Admin > Fundraising's API. Every route needs a session and the "fundraising" section:
// view to look, edit to change anything, and the switch is for admins only. The database and the
// emails are mocked. Every name and address here is invented.

const db = vi.hoisted(() => ({
  addCash: vi.fn(),
  decideEdit: vi.fn(),
  fundraiserHistory: vi.fn(),
  getFundraiser: vi.fn(),
  getFundraisingSettings: vi.fn(),
  listAllFundraisers: vi.fn(),
  listCash: vi.fn(),
  listEdits: vi.fn(),
  moveFundraiser: vi.fn(),
  patchFundraiser: vi.fn(),
  removeCash: vi.fn(),
  setFundraisingOn: vi.fn(),
  setMessageHidden: vi.fn(),
  wallRows: vi.fn(),
}));
const { getUserAuthRowMock, sendApprovedEmail, insertEventImage } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  sendApprovedEmail: vi.fn(),
  insertEventImage: vi.fn(),
}));

vi.mock("../../src/db/fundraisers", () => {
  class FundraiserError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...db, FundraiserError };
});
vi.mock("../../src/fundraising/send", () => ({
  sendApprovedEmail,
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
}));
vi.mock("../../src/db/events", () => ({ insertEventImage }));
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

import * as routes from "../../src/routes/admin-fundraising";
import { signAdminSession } from "../../src/admin/session";
import { FundraiserError } from "../../src/db/fundraisers";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

const SECRET = "test-admin-secret";
const EMAIL = "kim.fundraising@nbcc.test";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: EMAIL, status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: EMAIL, role, now: new Date(), secret: SECRET }).token;
}

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
type Opts = { token?: string | null; body?: unknown; params?: Record<string, string> };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ headers, body: o.body ?? {}, params: o.params ?? {} } as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord => ({
  id: 9,
  slug: "sams-sponsored-walk",
  path: "raising",
  kind: "run_walk",
  title: "Sam's Sponsored Walk",
  description: "Ten miles.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "",
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
  createdAt: "2026-10-02T10:00:00.000Z",
  approvedAt: null,
  approvedBy: null,
  updatedAt: "2026-10-02T10:00:00.000Z",
  updatedBy: null,
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  getUserAuthRowMock.mockReset();
  sendApprovedEmail.mockReset();
  insertEventImage.mockReset();
  db.getFundraisingSettings.mockResolvedValue({ pageOn: false, updatedAt: null, updatedBy: null });
  db.listAllFundraisers.mockResolvedValue([]);
  db.fundraiserHistory.mockResolvedValue([]);
});

const P = { id: "9" };
// Each route, the access it needs, and a body that gets past validation.
const VIEW: Array<[string, Handler, Opts]> = [
  ["the switch", routes.getAdminFundraisingSettings, {}],
  ["the list", routes.getAdminFundraisers, {}],
  ["one sign up", routes.getAdminFundraiser, { params: P }],
  ["its history", routes.getAdminFundraiserHistory, { params: P }],
];
const EDIT: Array<[string, Handler, Opts]> = [
  ["an edit", routes.patchAdminFundraiser, { params: P, body: { title: "New name" } }],
  ["approving", routes.postApproveFundraiser, { params: P }],
  ["declining", routes.postDeclineFundraiser, { params: P }],
  ["finishing", routes.postFinishFundraiser, { params: P }],
  ["approving a change", routes.postApproveEdit, { params: { id: "9", editId: "3" } }],
  ["rejecting a change", routes.postRejectEdit, { params: { id: "9", editId: "3" } }],
  ["adding cash", routes.postAdminCash, { params: P, body: { amountPence: 1500, paidInOn: "2026-10-01", note: "Bucket" } }],
  ["removing cash", routes.deleteAdminCash, { params: { id: "9", cashId: "4" } }],
  ["hiding a message", routes.postHideMessage, { params: { id: "9", donationId: "55" } }],
  ["showing a message", routes.postShowMessage, { params: { id: "9", donationId: "55" } }],
  ["uploading a photo", routes.postAdminFundraiserImage, { body: { mime: "image/png", dataBase64: "aGVsbG8=" } }],
];

describe("who may do what", () => {
  it.each([...VIEW, ...EDIT, ["switching it", routes.patchAdminFundraisingSettings, { body: { pageOn: true } }] as [string, Handler, Opts]])(
    "%s needs a session",
    async (_what, handler, o) => {
      expect((await run(handler, { ...o, token: null })).statusCode).toBe(401);
    },
  );

  it.each(VIEW)("a viewer may look at %s", async (_what, handler, o) => {
    db.getFundraiser.mockResolvedValue({ ...record(), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }), editWaiting: false });
    db.listEdits.mockResolvedValue([]);
    db.listCash.mockResolvedValue([]);
    db.wallRows.mockResolvedValue([]);
    expect((await run(handler, { ...o, token: tokenFor("viewer") })).statusCode).toBe(200);
  });

  it.each(EDIT)("a viewer may not do %s", async (_what, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer") })).statusCode).toBe(403);
  });

  it.each(VIEW)("someone without the section may not see %s", async (_what, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("editor", { overview: "view" }) })).statusCode).toBe(403);
  });

  it("only an admin may switch fundraising on, even an editor with edit", async () => {
    db.setFundraisingOn.mockResolvedValue({ pageOn: true, updatedAt: "2026-10-02T12:00:00.000Z", updatedBy: `admin:${EMAIL}` });
    expect((await run(routes.patchAdminFundraisingSettings, { token: tokenFor("editor"), body: { pageOn: true } })).statusCode).toBe(403);
    expect(db.setFundraisingOn).not.toHaveBeenCalled();
    const res = await run(routes.patchAdminFundraisingSettings, { token: tokenFor("admin"), body: { pageOn: true } });
    expect(res.statusCode).toBe(200);
    expect(db.setFundraisingOn).toHaveBeenCalledWith(true, `admin:${EMAIL}`);
  });
});

describe("approving and the rest", () => {
  it("approves, and then emails the organiser", async () => {
    const after = record({ status: "approved" });
    db.moveFundraiser.mockResolvedValue({ before: record({ status: "new" }), after });
    const res = await run(routes.postApproveFundraiser, { params: P, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(db.moveFundraiser).toHaveBeenCalledWith(9, "approve", `admin:${EMAIL}`, null);
    expect(sendApprovedEmail).toHaveBeenCalledWith(after);
    expect((res.body as { fundraiser: { pageUrl: string } }).fundraiser.pageUrl).toBe("https://nbcc.test/fundraise/sams-sponsored-walk");
  });

  it("declines with a reason kept for staff, and emails nobody", async () => {
    db.moveFundraiser.mockResolvedValue({ before: record({ status: "new" }), after: record({ status: "declined" }) });
    await run(routes.postDeclineFundraiser, { params: P, token: tokenFor("editor"), body: { reason: "Not for us this time" } });
    expect(db.moveFundraiser).toHaveBeenCalledWith(9, "decline", `admin:${EMAIL}`, "Not for us this time");
    expect(sendApprovedEmail).not.toHaveBeenCalled();
  });

  it("says plainly when a move makes no sense, or a web address is taken", async () => {
    db.moveFundraiser.mockRejectedValue(new FundraiserError("bad_status"));
    expect((await run(routes.postFinishFundraiser, { params: P, token: tokenFor("editor") })).statusCode).toBe(409);
    db.patchFundraiser.mockRejectedValue(new FundraiserError("slug_taken"));
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { slug: "taken-already" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Another fundraiser already uses that web address" });
  });

  it("refuses an edit it cannot use, naming the field", async () => {
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { imageSrc: "https://elsewhere.example/a.jpg" } });
    expect(res.statusCode).toBe(400);
    expect(Object.keys((res.body as { fields: object }).fields)).toEqual(["imageSrc"]);
  });

  it("adds cash paid in, and refuses cash with no amount or a date that does not exist", async () => {
    db.addCash.mockResolvedValue({ id: 4 });
    const ok = await run(routes.postAdminCash, { params: P, token: tokenFor("editor"), body: { amountPence: 1500, paidInOn: "2026-10-01" } });
    expect(ok.statusCode).toBe(201);
    expect(db.addCash).toHaveBeenCalledWith(9, { amountPence: 1500, paidInOn: "2026-10-01", note: "" }, `admin:${EMAIL}`);
    expect((await run(routes.postAdminCash, { params: P, token: tokenFor("editor"), body: { amountPence: 0, paidInOn: "2026-10-01" } })).statusCode).toBe(400);
    expect((await run(routes.postAdminCash, { params: P, token: tokenFor("editor"), body: { amountPence: 100, paidInOn: "2026-02-30" } })).statusCode).toBe(400);
  });

  it("refuses an id that is not one", async () => {
    expect((await run(routes.getAdminFundraiser, { params: { id: "abc" }, token: tokenFor("admin") })).statusCode).toBe(400);
  });

  it("shows staff the whole wall, hidden messages included", async () => {
    db.getFundraiser.mockResolvedValue({ ...record(), meter: meter({ onlinePence: 100, cashPence: 0, targetPence: 25000 }), editWaiting: true });
    db.listEdits.mockResolvedValue([{ id: 3, changes: { targetPence: 30000 }, status: "waiting", createdAt: "x", decidedAt: null, decidedBy: null }]);
    db.listCash.mockResolvedValue([]);
    db.wallRows.mockResolvedValue([
      { donationId: 55, fullName: "Alex Example", anonymous: false, showName: true, showAmount: true, amountPence: 100, refundedPence: 0, message: "rude", hidden: true, createdAt: "x" },
    ]);
    const res = await run(routes.getAdminFundraiser, { params: P, token: tokenFor("viewer") });
    const body = res.body as { wall: Array<{ hidden: boolean; shortName: string }>; waitingEdit: { id: number } };
    expect(body.wall[0]).toMatchObject({ donationId: 55, hidden: true, shortName: "Alex E.", fullName: "Alex Example" });
    expect(body.waitingEdit.id).toBe(3);
  });
});
