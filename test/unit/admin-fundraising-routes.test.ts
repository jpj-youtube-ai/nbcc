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
  fundraisingIsOn: vi.fn(),
  countWaitingLiveEmails: vi.fn(),
  setFundraiserSplit: vi.fn(),
}));
const { getUserAuthRowMock, sendApprovedEmail, sendWaitingLiveEmails, sendEditDecisionEmail, insertEventImage } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  sendApprovedEmail: vi.fn(),
  sendWaitingLiveEmails: vi.fn(),
  sendEditDecisionEmail: vi.fn(),
  insertEventImage: vi.fn(),
}));

vi.mock("../../src/db/fundraisers", () => {
  class FundraiserError extends Error {
    constructor(
      public readonly reason: string,
      public readonly field?: string,
    ) {
      super(reason);
    }
  }
  return { ...db, FundraiserError };
});
vi.mock("../../src/fundraising/send", () => ({
  sendApprovedEmail,
  sendWaitingLiveEmails,
  sendEditDecisionEmail,
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  // Event pages: an approved public event has a page of its own now.
  eventPageUrl: (slug: string) => `https://nbcc.test/event/${slug}`,
}));
// Fundraising categories: the starting list stands in for the database's (src/fundraising/categories.ts).
vi.mock("../../src/db/fundraising-categories", () => ({ loadCategories: async () => [] }));
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
// Team pages: a declined team's invites are deleted at once.
const teamDb = vi.hoisted(() => ({ deleteTeamInvites: vi.fn() }));
vi.mock("../../src/db/fundraising-teams", () => teamDb);

import * as routes from "../../src/routes/admin-fundraising";
import { SPLIT_LOCKED } from "../../src/routes/admin-fundraising";
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
  sendApprovedEmail.mockReset().mockResolvedValue(true);
  sendWaitingLiveEmails.mockReset().mockResolvedValue({ sent: 0, failed: 0 });
  sendEditDecisionEmail.mockReset().mockResolvedValue(true);
  insertEventImage.mockReset();
  db.getFundraisingSettings.mockResolvedValue({ pageOn: false, updatedAt: null, updatedBy: null });
  db.listAllFundraisers.mockResolvedValue([]);
  db.fundraiserHistory.mockResolvedValue([]);
  db.fundraisingIsOn.mockResolvedValue(true);
  db.countWaitingLiveEmails.mockResolvedValue(0);
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
    db.moveFundraiser.mockResolvedValue({ before: record({ status: "new" }), after, livePending: false });
    const res = await run(routes.postApproveFundraiser, { params: P, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(db.moveFundraiser).toHaveBeenCalledWith(9, "approve", `admin:${EMAIL}`, null);
    expect(sendApprovedEmail).toHaveBeenCalledWith(after);
    expect((res.body as { fundraiser: { pageUrl: string } }).fundraiser.pageUrl).toBe("https://nbcc.test/fundraise/sams-sponsored-walk");
  });

  // TASK-497: the "you're approved, your page will appear" email is retired. A page holder
  // approved while fundraising is off is marked as waiting (in moveFundraiser's transaction) and
  // emailed "Your page is live" at the switch on.
  it("approves a page holder while fundraising is off, marked as waiting, and emails nothing yet", async () => {
    const after = record({ status: "approved" });
    db.moveFundraiser.mockResolvedValue({ before: record({ status: "new" }), after, livePending: true });
    const res = await run(routes.postApproveFundraiser, { params: P, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(sendApprovedEmail).not.toHaveBeenCalled();
  });

  it("still approves when the email throws", async () => {
    db.moveFundraiser.mockResolvedValue({ before: record({ status: "new" }), after: record({ status: "approved" }), livePending: false });
    sendApprovedEmail.mockRejectedValue(new Error("SES is down"));
    expect((await run(routes.postApproveFundraiser, { params: P, token: tokenFor("editor") })).statusCode).toBe(200);
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
    // TASK-511: an address a page used to have is never reused either, as it still leads to that page.
    expect(res.body).toEqual({ error: "Another fundraiser has that web address, or had it before, so it cannot be used" });
  });

  it("refuses to decide a change the organiser has since replaced, and says to look again", async () => {
    db.decideEdit.mockRejectedValue(new FundraiserError("replaced"));
    const res = await run(routes.postApproveEdit, { params: { id: "9", editId: "3" }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "This change has been replaced; look again" });
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

describe("switching fundraising on (TASK-497)", () => {
  const on = { pageOn: true, updatedAt: "2026-10-02T12:00:00.000Z", updatedBy: `admin:${EMAIL}` };

  it("sends Your page is live to everyone approved while it was off", async () => {
    db.setFundraisingOn.mockResolvedValue(on);
    sendWaitingLiveEmails.mockResolvedValue({ sent: 2, failed: 0 });
    const res = await run(routes.patchAdminFundraisingSettings, { token: tokenFor("admin"), body: { pageOn: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(on);
    expect(sendWaitingLiveEmails).toHaveBeenCalledTimes(1);
    // Only once the switch has been saved.
    expect(db.setFundraisingOn.mock.invocationCallOrder[0]).toBeLessThan(sendWaitingLiveEmails.mock.invocationCallOrder[0]);
  });

  it("answers the admin straight away, without waiting for the emails to go", async () => {
    db.setFundraisingOn.mockResolvedValue(on);
    sendWaitingLiveEmails.mockReturnValue(new Promise(() => {})); // never settles
    const res = await run(routes.patchAdminFundraisingSettings, { token: tokenFor("admin"), body: { pageOn: true } });
    expect(res.statusCode).toBe(200);
    expect(sendWaitingLiveEmails).toHaveBeenCalledTimes(1);
  });

  it("still switches on when starting the emails throws at once", async () => {
    db.setFundraisingOn.mockResolvedValue(on);
    sendWaitingLiveEmails.mockImplementation(() => {
      throw new Error("boom");
    });
    expect((await run(routes.patchAdminFundraisingSettings, { token: tokenFor("admin"), body: { pageOn: true } })).statusCode).toBe(200);
  });

  it("tells the screen how many are waiting, for the question before switching on", async () => {
    db.getFundraisingSettings.mockResolvedValue({ pageOn: false, updatedAt: null, updatedBy: null });
    db.countWaitingLiveEmails.mockResolvedValue(3);
    const res = await run(routes.getAdminFundraisingSettings, { token: tokenFor("viewer") });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ pageOn: false, updatedAt: null, updatedBy: null, liveEmailsWaiting: 3 });
  });

  it("still answers with the switch when the count fails, just without the number", async () => {
    db.countWaitingLiveEmails.mockRejectedValue(new Error("database went away"));
    const res = await run(routes.getAdminFundraisingSettings, { token: tokenFor("viewer") });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ pageOn: false, updatedAt: null, updatedBy: null });
  });

  it("sends nothing when switching it off", async () => {
    db.setFundraisingOn.mockResolvedValue({ ...on, pageOn: false });
    expect((await run(routes.patchAdminFundraisingSettings, { token: tokenFor("admin"), body: { pageOn: false } })).statusCode).toBe(200);
    expect(sendWaitingLiveEmails).not.toHaveBeenCalled();
  });

  it("still switches on when the emails fail", async () => {
    db.setFundraisingOn.mockResolvedValue(on);
    sendWaitingLiveEmails.mockRejectedValue(new Error("database went away"));
    const res = await run(routes.patchAdminFundraisingSettings, { token: tokenFor("admin"), body: { pageOn: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(on);
  });

  it("sends nothing when the switch could not be saved", async () => {
    db.setFundraisingOn.mockRejectedValue(new Error("database went away"));
    expect((await run(routes.patchAdminFundraisingSettings, { token: tokenFor("admin"), body: { pageOn: true } })).statusCode).toBe(500);
    expect(sendWaitingLiveEmails).not.toHaveBeenCalled();
  });
});

describe("deciding a change emails the organiser (TASK-497)", () => {
  const E = { id: "9", editId: "3" };

  it.each([
    ["approving", routes.postApproveEdit, true],
    ["rejecting", routes.postRejectEdit, false],
  ] as const)("%s a change tells the organiser, with whether the pages are open", async (_what, handler, approve) => {
    const after = record();
    db.decideEdit.mockResolvedValue(after);
    db.fundraisingIsOn.mockResolvedValue(false);
    const res = await run(handler, { params: E, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    expect(db.decideEdit).toHaveBeenCalledWith(9, 3, approve, `admin:${EMAIL}`);
    expect(sendEditDecisionEmail).toHaveBeenCalledWith(after, approve, false);
  });

  it.each([routes.postApproveEdit, routes.postRejectEdit])("still decides when the email throws", async (handler) => {
    db.decideEdit.mockResolvedValue(record());
    sendEditDecisionEmail.mockRejectedValue(new Error("SES is down"));
    expect((await run(handler, { params: E, token: tokenFor("editor") })).statusCode).toBe(200);
  });

  it("emails nobody when the change could not be decided", async () => {
    db.decideEdit.mockRejectedValue(new FundraiserError("not_waiting"));
    expect((await run(routes.postRejectEdit, { params: E, token: tokenFor("editor") })).statusCode).toBe(409);
    expect(sendEditDecisionEmail).not.toHaveBeenCalled();
  });
});

// TASK-499: staff can change every new answer: the address in its boxes, the split requests and the
// event questions. The same section rule as every other change.
describe("changing the new answers", () => {
  const body = {
    postLine1: "2 Example Road",
    postLine2: "",
    postTown: "Exampleton",
    postPostcode: "ex1 1ex",
    wants: { posterCount: 3, leafletCount: 40, bucketCount: 1, tinCount: 2, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    cardLine: "Eight rounds and a raffle.",
    endTime: "22:30",
    timeTbc: true,
    venueAddress: "Main Street",
    venuePostcode: "ka1 1aa",
    access: ["a hearing loop", "step free entry"],
    price: "£5",
    booking: "away",
    ticketUrl: "https://tickets.example.com/quiz",
    ageLimit: "18 and over",
    dressCode: "",
    included: "A mince pie",
    creditName: "The Quiz Team",
  };

  it("saves every one, tidied, for an editor", async () => {
    db.patchFundraiser.mockResolvedValue(record({ path: "event" }));
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body });
    expect(res.statusCode).toBe(200);
    const [id, patch, actor] = db.patchFundraiser.mock.calls[0];
    expect(id).toBe(9);
    expect(actor).toBe(`admin:${EMAIL}`);
    expect(patch).toEqual({
      ...body,
      postLine2: null,
      postPostcode: "EX1 1EX",
      venuePostcode: "KA1 1AA",
      access: ["step free entry", "a hearing loop"],
      dressCode: null,
    });
  });

  it("is refused to a viewer, and saves nothing", async () => {
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("viewer"), body });
    expect(res.statusCode).toBe(403);
    expect(db.patchFundraiser).not.toHaveBeenCalled();
  });

  it("names each answer it cannot use", async () => {
    const res = await run(routes.patchAdminFundraiser, {
      params: P,
      token: tokenFor("editor"),
      body: { ticketUrl: "http://tickets.example.com", postPostcode: "12345" },
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys((res.body as { fields: object }).fields).sort()).toEqual(["postPostcode", "ticketUrl"]);
    const times = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { startTime: "19:00", endTime: "18:00" } });
    expect((times.body as { fields: object }).fields).toEqual({ endTime: "The finish time is before the start." });
    expect(db.patchFundraiser).not.toHaveBeenCalled();
  });

  it("still saves the old single address box of a sign up from before", async () => {
    db.patchFundraiser.mockResolvedValue(record({ postAddress: "1 Example Street" }));
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { postAddress: "1 Example Street" } });
    expect(res.statusCode).toBe(200);
    expect(db.patchFundraiser.mock.calls[0][1]).toEqual({ postAddress: "1 Example Street" });
  });

  it("sends the new answers to the admin screen with the rest", async () => {
    db.getFundraiser.mockResolvedValue({
      ...record({ path: "event", cardLine: "A line.", booking: "door", access: ["a hearing loop"], postLine1: "1 Example Road" }),
      meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }),
      editWaiting: false,
    });
    db.listEdits.mockResolvedValue([]);
    db.listCash.mockResolvedValue([]);
    db.wallRows.mockResolvedValue([]);
    const res = await run(routes.getAdminFundraiser, { params: P, token: tokenFor("viewer") });
    expect(res.statusCode).toBe(200);
    expect((res.body as { fundraiser: Record<string, unknown> }).fundraiser).toMatchObject({
      cardLine: "A line.",
      booking: "door",
      access: ["a hearing loop"],
      postLine1: "1 Example Road",
    });
  });
});

// Review fix: the finish time can never end up before the start through a change of one of them.
describe("a change that would put the finish before the start", () => {
  it("names the start when staff move only the start past the stored finish", async () => {
    db.patchFundraiser.mockRejectedValue(new FundraiserError("bad_times", "startTime"));
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { startTime: "13:00" } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Some of it needs another look", fields: { startTime: "The finish time is before the start." } });
  });

  it("names the finish when staff move only the finish before the stored start", async () => {
    db.patchFundraiser.mockRejectedValue(new FundraiserError("bad_times", "endTime"));
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { endTime: "09:00" } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Some of it needs another look", fields: { endTime: "The finish time is before the start." } });
  });

  it("says why an organiser's change cannot be approved, and emails nobody", async () => {
    db.decideEdit.mockRejectedValue(new FundraiserError("bad_times", "startTime"));
    const res = await run(routes.postApproveEdit, { params: { id: "9", editId: "3" }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "This change would put the finish time before the start. Change the finish time first, or reject it." });
    expect(sendEditDecisionEmail).not.toHaveBeenCalled();
  });
});

// Fundraising categories: staff may move a sign up to any category on offer, never to an old one
// or one that is not there; and an old sign up's category is named as it always was.
describe("a sign up's category", () => {
  it("can be changed to any category on offer", async () => {
    db.patchFundraiser.mockResolvedValue(record({ kind: "walk" }));
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { kind: "walk" } });
    expect(res.statusCode).toBe(200);
    expect(db.patchFundraiser).toHaveBeenCalledWith(9, { kind: "walk" }, `admin:${EMAIL}`);
    expect((res.body as { fundraiser: { kindLabel: string } }).fundraiser.kindLabel).toBe("Walk");
  });

  it.each(["run_walk", "nope"])("cannot be changed to %s", async (kind) => {
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("editor"), body: { kind } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields.kind).toBe("Choose one of the categories on the list.");
    expect(db.patchFundraiser).not.toHaveBeenCalled();
  });

  it("of an old sign up is named by its old category, in the list and when opened", async () => {
    db.listAllFundraisers.mockResolvedValue([{ ...record(), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }), editWaiting: false }]);
    const list = await run(routes.getAdminFundraisers, { token: tokenFor("viewer") });
    expect((list.body as { fundraisers: Array<{ kind: string; kindLabel: string }> }).fundraisers[0]).toMatchObject({ kind: "run_walk", kindLabel: "Run or walk" });
    db.getFundraiser.mockResolvedValue({ ...record({ kind: "quiz", kindLabel: "Quiz night" }), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }), editWaiting: false });
    db.listEdits.mockResolvedValue([]);
    db.listCash.mockResolvedValue([]);
    db.wallRows.mockResolvedValue([]);
    const one = await run(routes.getAdminFundraiser, { params: P, token: tokenFor("viewer") });
    expect((one.body as { fundraiser: { kindLabel: string } }).fundraiser.kindLabel).toBe("Quiz night");
  });
});

// Jaimie, 2026-10-03: the split with another cause. Organisers can never change it; an admin may
// correct it in the admin, and only while the fundraiser has no gifts (the database refuses after
// that, under the row's lock). The other cause here is invented.
describe("correcting the split with another cause", () => {
  const SPLIT = { sharesWithOther: true, nbccSharePercent: 70, otherCauseName: "Kilmarnock Food Larder" };

  it("is for admins only: an editor with edit may not", async () => {
    const res = await run(routes.putAdminFundraiserSplit, { params: P, token: tokenFor("editor"), body: SPLIT });
    expect(res.statusCode).toBe(403);
    expect(db.setFundraiserSplit).not.toHaveBeenCalled();
    expect((await run(routes.putAdminFundraiserSplit, { params: P, token: tokenFor("viewer"), body: SPLIT })).statusCode).toBe(403);
    expect((await run(routes.putAdminFundraiserSplit, { params: P, token: null, body: SPLIT })).statusCode).toBe(401);
  });

  it("saves it while there are no gifts, recording who did it", async () => {
    db.setFundraiserSplit.mockResolvedValue(record(SPLIT));
    const res = await run(routes.putAdminFundraiserSplit, { params: P, token: tokenFor("admin"), body: SPLIT });
    expect(res.statusCode).toBe(200);
    expect(db.setFundraiserSplit).toHaveBeenCalledWith(9, SPLIT, `admin:${EMAIL}`);
    expect((res.body as { fundraiser: { nbccSharePercent: number } }).fundraiser.nbccSharePercent).toBe(70);
  });

  it("refuses it once there is a gift, in plain words", async () => {
    db.setFundraiserSplit.mockRejectedValue(new FundraiserError("has_gifts"));
    const res = await run(routes.putAdminFundraiserSplit, { params: P, token: tokenFor("admin"), body: SPLIT });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: SPLIT_LOCKED });
    expect(SPLIT_LOCKED).toBe(
      "The split cannot be changed now: this fundraiser has had its first gift, and people gave on the split as it stood. Please call or email the organiser.",
    );
  });

  it("checks it with the form's rules", async () => {
    const res = await run(routes.putAdminFundraiserSplit, { params: P, token: tokenFor("admin"), body: { sharesWithOther: true, nbccSharePercent: 0 } });
    expect(res.statusCode).toBe(400);
    expect(Object.keys((res.body as { fields: Record<string, string> }).fields).sort()).toEqual(["nbccSharePercent", "otherCauseName"]);
    expect(db.setFundraiserSplit).not.toHaveBeenCalled();
  });

  it("is never part of the ordinary edit, so an editor cannot slip it in there", async () => {
    const res = await run(routes.patchAdminFundraiser, { params: P, token: tokenFor("admin"), body: { nbccSharePercent: 10 } });
    expect(res.statusCode).toBe(400);
    expect(db.patchFundraiser).not.toHaveBeenCalled();
  });
});

// Team pages (Jaimie, 2026-10-03): a team's total in the admin's list is the whole team's, and a
// team can never be made an event.
describe("teams in Admin > Fundraising", () => {
  const m = (raised: number, target: number | null) => meter({ onlinePence: raised, cashPence: 0, targetPence: target });

  it("shows a team's combined total in the list; its members keep their own", async () => {
    db.getFundraisingSettings.mockResolvedValue({ pageOn: true, updatedAt: null, updatedBy: null });
    db.listAllFundraisers.mockResolvedValue([
      { ...record({ id: 40, isTeam: true, targetPence: 200000 }), meter: m(1000, 200000), editWaiting: false },
      { ...record({ id: 41, teamId: 40 }), meter: m(2500, 25000), editWaiting: false },
      { ...record({ id: 42, teamId: 40, status: "new" }), meter: m(700, 25000), editWaiting: false },
    ]);
    const res = await run(routes.getAdminFundraisers, { token: tokenFor("viewer") });
    const list = (res.body as { fundraisers: Array<{ id: number; meter: { raisedPence: number; targetPence: number } }> }).fundraisers;
    expect(list.find((f) => f.id === 40)!.meter).toMatchObject({ raisedPence: 3500, targetPence: 200000 });
    expect(list.find((f) => f.id === 41)!.meter.raisedPence).toBe(2500);
    expect(list.find((f) => f.id === 42)!.meter.raisedPence).toBe(700);
  });

  it("refuses to make a team an event, plainly", async () => {
    db.patchFundraiser.mockRejectedValue(new FundraiserError("team_path"));
    const res = await run(routes.patchAdminFundraiser, { params: { id: "40" }, token: tokenFor("editor"), body: { path: "event" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "A team raises money, so it can't be an event. Take everyone off the team first." });
  });
});

describe("declining a team (review)", () => {
  it("deletes the people its organiser added at once, and only for a team", async () => {
    teamDb.deleteTeamInvites.mockReset().mockResolvedValue(2);
    db.moveFundraiser.mockResolvedValue({ before: record({ id: 40, isTeam: true }), after: record({ id: 40, isTeam: true, status: "declined" }), livePending: false });
    const res = await run(routes.postDeclineFundraiser, { params: { id: "40" }, token: tokenFor("editor"), body: {} });
    expect(res.statusCode).toBe(200);
    expect(teamDb.deleteTeamInvites).toHaveBeenCalledWith(40);
    teamDb.deleteTeamInvites.mockClear();
    db.moveFundraiser.mockResolvedValue({ before: record(), after: record({ status: "declined" }), livePending: false });
    await run(routes.postDeclineFundraiser, { params: { id: "9" }, token: tokenFor("editor"), body: {} });
    expect(teamDb.deleteTeamInvites).not.toHaveBeenCalled();
  });
});

describe("correcting a team's split (review)", () => {
  it("passes whose split it is, and asks for it when a team shares", async () => {
    db.setFundraiserSplit.mockResolvedValue(record({ id: 40, isTeam: true }));
    const body = { sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder", teamShareMode: "team" };
    const ok = await run(routes.putAdminFundraiserSplit, { params: { id: "40" }, token: tokenFor("admin"), body });
    expect(ok.statusCode).toBe(200);
    expect(db.setFundraiserSplit).toHaveBeenCalledWith(40, { sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder" }, expect.any(String), "team");
    db.setFundraiserSplit.mockRejectedValue(new FundraiserError("team_mode_missing"));
    const asked = await run(routes.putAdminFundraiserSplit, { params: { id: "40" }, token: tokenFor("admin"), body: { ...body, teamShareMode: undefined } });
    expect(asked.statusCode).toBe(400);
    expect((asked.body as { fields: Record<string, string> }).fields).toEqual({ teamShareMode: "Tell us whether the split is just for you, or for the whole team." });
    const bad = await run(routes.putAdminFundraiserSplit, { params: { id: "40" }, token: tokenFor("admin"), body: { ...body, teamShareMode: "everyone" } });
    expect(bad.statusCode).toBe(400);
  });
});
