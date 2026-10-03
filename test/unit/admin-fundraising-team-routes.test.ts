import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-503: the API behind the team's tools in Admin > Fundraising. Viewers look; editors and
// admins invite, record calls and take a fundraiser off Get involved; only admins set who gets the
// Monday summary and send a test of it. The database and the emails are mocked. Every name and
// address here is invented.

const team = vi.hoisted(() => ({
  createInvite: vi.fn(),
  resendInvite: vi.fn(),
  removeInvite: vi.fn(),
  listOpenInvites: vi.fn(),
  countRecentInvites: vi.fn(),
  listSigners: vi.fn(),
  getSigner: vi.fn(),
  recordFundraiserCall: vi.fn(),
  listFundraiserCalls: vi.fn(),
  setOffList: vi.fn(),
  getSummarySettings: vi.fn(),
  saveSummaryRecipients: vi.fn(),
}));
const { getUserAuthRowMock, listAllFundraisers, sendFundraiseInvite, sendSummaryTest } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  listAllFundraisers: vi.fn(),
  sendFundraiseInvite: vi.fn(),
  sendSummaryTest: vi.fn(),
}));

vi.mock("../../src/db/fundraising-team", () => {
  class TeamError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...team, TeamError };
});
vi.mock("../../src/db/fundraisers", () => ({ listAllFundraisers }));
vi.mock("../../src/clients/email", () => ({ sendFundraiseInvite }));
vi.mock("../../src/fundraising/summary-runner", () => ({ sendSummaryTest }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/admin-fundraising-team";
import { signAdminSession } from "../../src/admin/session";
import { TeamError } from "../../src/db/fundraising-team";
import { hashInviteToken } from "../../src/fundraising/invite";

const SECRET = "test-admin-secret";
const EMAIL = "fern@example.com";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 3, email: EMAIL, status: "active", role, permissions });
  return signAdminSession({ sub: 3, email: EMAIL, role, now: new Date(), secret: SECRET }).token;
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

const invite = (over: Record<string, unknown> = {}) => ({
  id: 4,
  name: "Alex Example",
  firstName: "Alex",
  lastName: "Example",
  email: "alex@example.com",
  note: "Lovely to chat",
  signedBy: "Fern",
  sentBy: "admin:fern@example.com",
  createdAt: "2026-10-01T09:00:00.000Z",
  resentAt: null,
  ...over,
});

const fundraiser = (over: Record<string, unknown> = {}) => ({
  id: 9,
  status: "approved",
  public: true,
  path: "raising",
  eventDate: "2026-12-06",
  finishedRequestedAt: null,
  offListAt: null,
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(team)) fn.mockReset();
  getUserAuthRowMock.mockReset();
  listAllFundraisers.mockReset().mockResolvedValue([]);
  sendFundraiseInvite.mockReset().mockResolvedValue(undefined);
  sendSummaryTest.mockReset().mockResolvedValue(undefined);
  team.listOpenInvites.mockResolvedValue([]);
  team.listFundraiserCalls.mockResolvedValue([]);
  team.listSigners.mockResolvedValue([{ id: 3, firstName: "Fern" }, { id: 5, firstName: "Rowan" }]);
  team.getSigner.mockImplementation(async (id: number) => (id === 3 ? { id: 3, firstName: "Fern" } : id === 5 ? { id: 5, firstName: "Rowan" } : null));
  team.countRecentInvites.mockResolvedValue(0);
  team.createInvite.mockImplementation(async (i: Record<string, unknown>) =>
    invite({ name: `${i.firstName} ${i.lastName}`, firstName: i.firstName, lastName: i.lastName, email: i.email, note: i.note, signedBy: i.signedBy }),
  );
  team.resendInvite.mockResolvedValue(invite({ resentAt: "2026-10-08T09:00:00.000Z" }));
  team.getSummarySettings.mockResolvedValue({ recipients: ["fern@example.com"], lastWeek: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const P = { id: "9" };
const GOOD_INVITE = { firstName: "Mary Jane", lastName: "Smith", email: "mary@example.com", note: "Lovely to chat", signedBy: 5 };

const VIEW: Array<[string, Handler, Opts]> = [["the team's tools", routes.getFundraisingTeam, {}]];
const EDIT: Array<[string, Handler, Opts]> = [
  ["inviting", routes.postInvite, { body: GOOD_INVITE }],
  ["resending", routes.postResendInvite, { params: { id: "4" } }],
  ["removing an invite", routes.deleteInvite, { params: { id: "4" } }],
  ["recording a call", routes.postFundraiserCall, { params: P, body: { which: "before" } }],
  ["taking it off Get involved", routes.postOffList, { params: P }],
  ["putting it back", routes.postOnList, { params: P }],
];
const ADMIN: Array<[string, Handler, Opts]> = [
  ["reading the summary list", routes.getSummary, {}],
  ["saving the summary list", routes.putSummary, { body: { recipients: ["fern@example.com"] } }],
  ["sending a test", routes.postSummaryTest, {}],
];

describe("who may do what", () => {
  it.each([...VIEW, ...EDIT, ...ADMIN])("%s needs a session", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: null })).statusCode).toBe(401);
  });

  it.each([...VIEW])("a viewer may see %s", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer") })).statusCode).toBe(200);
  });

  it.each([...EDIT, ...ADMIN])("a viewer may not do %s", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("viewer") })).statusCode).toBe(403);
  });

  it.each(EDIT)("an editor may do %s", async (_w, handler, o) => {
    team.setOffList.mockResolvedValue({ offListAt: null });
    team.recordFundraiserCall.mockResolvedValue({ which: "before", calledAt: "2026-11-30T10:00:00.000Z", calledBy: EMAIL, note: null });
    expect((await run(handler, { ...o, token: tokenFor("editor") })).statusCode).toBeLessThan(300);
  });

  it.each(ADMIN)("an editor may not do %s", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("editor") })).statusCode).toBe(403);
  });

  it.each(ADMIN)("an admin may do %s", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: tokenFor("admin") })).statusCode).toBeLessThan(300);
  });

  it("someone without fundraising access sees none of it", async () => {
    expect((await run(routes.getFundraisingTeam, { token: tokenFor("admin", { fundraising: "none" }) })).statusCode).toBe(403);
  });
});

describe("the team's tools", () => {
  it("gives the calls and prompts for each fundraiser, the open invites, who can sign, and who is asking", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    try {
      listAllFundraisers.mockResolvedValue([
        fundraiser(),
        fundraiser({ id: 10, eventDate: null }),
        fundraiser({ id: 11, eventDate: "2026-10-01" }),
        fundraiser({ id: 12, eventDate: null, finishedRequestedAt: "2026-11-30T10:00:00.000Z" }),
      ]);
      team.listOpenInvites.mockResolvedValue([invite(), invite({ id: 5, createdAt: "2026-11-20T09:00:00.000Z" })]);
      const res = await run(routes.getFundraisingTeam, { token: tokenFor("editor") });
      const body = res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(body.today).toBe("2026-12-01");
      expect(body.me).toBe(3);
      expect(body.calls["9"]).toMatchObject({ due: true, dueWhich: "before", before: { dueOn: "2026-11-29" }, after: { dueOn: "2026-12-13" } });
      expect(body.calls["10"]).toBeUndefined();
      expect(body.prompts).toEqual({ "11": "date", "12": "finished" });
      // Sent 61 days ago: its link has expired, so the admin marks it, with Resend still there.
      expect(body.invites).toEqual([
        { ...invite(), expired: true },
        { ...invite({ id: 5, createdAt: "2026-11-20T09:00:00.000Z" }), expired: false },
      ]);
      expect(body.signers).toEqual([{ id: 3, firstName: "Fern" }, { id: 5, firstName: "Rowan" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("inviting someone", () => {
  it("stores the invite with only its token's hash, and emails the link from the events inbox, signed by who was chosen", async () => {
    const res = await run(routes.postInvite, { token: tokenFor("editor"), body: GOOD_INVITE });
    expect(res.statusCode).toBe(201);
    const stored = team.createInvite.mock.calls[0][0];
    expect(stored).toMatchObject({ firstName: "Mary Jane", lastName: "Smith", email: "mary@example.com", note: "Lovely to chat", signedBy: "Rowan" });
    expect(stored).not.toHaveProperty("name");
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(team.createInvite.mock.calls[0][1]).toBe("admin:fern@example.com");
    const [name, mail] = sendFundraiseInvite.mock.calls[0];
    expect(name).toBe("Mary Jane Smith");
    expect(mail).toMatchObject({ email: "mary@example.com", from: "events@nbcc.test", replyTo: "events@nbcc.test" });
    // Greeted by the whole first name staff typed, not the first word of one name box.
    expect(mail.text).toContain("Hi Mary Jane,");
    expect(mail.text).toContain("Warmest wishes,\nRowan\nNBCC Team");
    const token = String(mail.text).match(/fundraise\?invite=([A-Za-z0-9_-]{43})/)![1];
    expect(hashInviteToken(token)).toBe(stored.tokenHash);
    // The token goes only in the email, never back to the page.
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(res.body).toMatchObject({ emailed: true, invite: { id: 4 } });
  });

  // Jaimie 2026-10-03: the member of staff who sends it gets a copy. The person signed in, from the
  // admin session, not whoever it is signed by (here Rowan signs it and Fern sends it).
  it("copies in the member of staff who sent it, not the person it is signed by, and records the copy", async () => {
    await run(routes.postInvite, { token: tokenFor("editor"), body: GOOD_INVITE });
    expect(sendFundraiseInvite.mock.calls[0][1].cc).toBe("fern@example.com");
    expect(team.createInvite.mock.calls[0][0].cc).toBe("fern@example.com");
  });

  it("sends with no copy when the sender is the person invited, and records none", async () => {
    await run(routes.postInvite, { token: tokenFor("editor"), body: { ...GOOD_INVITE, email: "Fern@Example.com" } });
    expect(sendFundraiseInvite).toHaveBeenCalledTimes(1);
    expect(sendFundraiseInvite.mock.calls[0][1].cc).toBeUndefined();
    expect(team.createInvite.mock.calls[0][0].cc).toBeNull();
  });

  it("keeps the invite when the email does not go, and says so", async () => {
    sendFundraiseInvite.mockRejectedValue(new Error("SES said no"));
    const res = await run(routes.postInvite, { token: tokenFor("editor"), body: GOOD_INVITE });
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ emailed: false });
  });

  it("refuses a form that needs another look, naming the box", async () => {
    const res = await run(routes.postInvite, { token: tokenFor("editor"), body: { ...GOOD_INVITE, email: "alex@", note: "a".repeat(5001) } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields).toMatchObject({ email: expect.any(String), note: expect.any(String) });
    expect(team.createInvite).not.toHaveBeenCalled();
  });

  it("names the first name and surname boxes when they are empty", async () => {
    const res = await run(routes.postInvite, { token: tokenFor("editor"), body: { ...GOOD_INVITE, firstName: " ", lastName: "" } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields).toMatchObject({ firstName: "Add their first name.", lastName: "Add their surname." });
    expect(team.createInvite).not.toHaveBeenCalled();
  });

  // An admin page loaded before the two boxes still sends one name, for a while.
  it("still takes one name from a page loaded before the two boxes, split at its first space", async () => {
    const res = await run(routes.postInvite, { token: tokenFor("editor"), body: { name: "Mary Jane Smith", email: "mary@example.com", signedBy: 5 } });
    expect(res.statusCode).toBe(201);
    expect(team.createInvite.mock.calls[0][0]).toMatchObject({ firstName: "Mary", lastName: "Jane Smith", email: "mary@example.com" });
    expect(sendFundraiseInvite.mock.calls[0][1].text).toContain("Hi Mary,");
  });

  it("asks for a refresh, naming no box, when that one name is a single word", async () => {
    const res = await run(routes.postInvite, { token: tokenFor("editor"), body: { name: "Mary", email: "mary@example.com", signedBy: 5 } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Please refresh the page and try again." });
    expect(team.createInvite).not.toHaveBeenCalled();
  });

  it("refuses a signer who is not on the team", async () => {
    const res = await run(routes.postInvite, { token: tokenFor("editor"), body: { ...GOOD_INVITE, signedBy: 99 } });
    expect(res.statusCode).toBe(400);
    expect(team.createInvite).not.toHaveBeenCalled();
  });

  it("allows 50 a day for each member of staff", async () => {
    team.countRecentInvites.mockResolvedValue(50);
    const res = await run(routes.postInvite, { token: tokenFor("admin"), body: GOOD_INVITE });
    expect(res.statusCode).toBe(429);
    expect(team.countRecentInvites).toHaveBeenCalledWith("admin:fern@example.com");
    expect(team.createInvite).not.toHaveBeenCalled();
    expect(sendFundraiseInvite).not.toHaveBeenCalled();
  });
});

describe("resending and removing an invite", () => {
  it("gives it a new token and emails it again, signed as before", async () => {
    const res = await run(routes.postResendInvite, { token: tokenFor("editor"), params: { id: "4" } });
    expect(res.statusCode).toBe(200);
    const [id, hash, actor] = team.resendInvite.mock.calls[0];
    expect([id, actor]).toEqual([4, "admin:fern@example.com"]);
    const token = String(sendFundraiseInvite.mock.calls[0][1].text).match(/fundraise\?invite=([A-Za-z0-9_-]{43})/)![1];
    expect(hashInviteToken(token)).toBe(hash);
    expect(sendFundraiseInvite.mock.calls[0][1].text).toContain("Warmest wishes,\nFern\nNBCC Team");
    expect(sendFundraiseInvite.mock.calls[0][1].text).toContain("Hi Alex,");
  });

  it("copies in the member of staff who resends it, and passes them on for the record", async () => {
    team.resendInvite.mockResolvedValue(invite({ signedBy: "Rowan" }));
    await run(routes.postResendInvite, { token: tokenFor("editor"), params: { id: "4" } });
    expect(sendFundraiseInvite.mock.calls[0][1].cc).toBe("fern@example.com");
    expect(team.resendInvite.mock.calls[0][3]).toBe("fern@example.com");
  });

  it("counts towards the day's 50", async () => {
    team.countRecentInvites.mockResolvedValue(50);
    expect((await run(routes.postResendInvite, { token: tokenFor("editor"), params: { id: "4" } })).statusCode).toBe(429);
    expect(team.resendInvite).not.toHaveBeenCalled();
  });

  it("says when it has been taken up or removed meanwhile", async () => {
    team.resendInvite.mockRejectedValue(new TeamError("not_found"));
    expect((await run(routes.postResendInvite, { token: tokenFor("editor"), params: { id: "4" } })).statusCode).toBe(404);
    team.removeInvite.mockRejectedValue(new TeamError("not_found"));
    expect((await run(routes.deleteInvite, { token: tokenFor("editor"), params: { id: "4" } })).statusCode).toBe(404);
  });

  it("removes one", async () => {
    const res = await run(routes.deleteInvite, { token: tokenFor("editor"), params: { id: "4" } });
    expect(res.body).toEqual({ removed: 4 });
    expect(team.removeInvite).toHaveBeenCalledWith(4, "admin:fern@example.com");
  });

  it("refuses an id that is not one", async () => {
    expect((await run(routes.deleteInvite, { token: tokenFor("editor"), params: { id: "x" } })).statusCode).toBe(400);
  });
});

describe("recording a call", () => {
  it("records which call, the note, and who made it", async () => {
    team.recordFundraiserCall.mockResolvedValue({ which: "after", calledAt: "2026-12-14T10:00:00.000Z", calledBy: EMAIL, note: "Raised loads" });
    const res = await run(routes.postFundraiserCall, { token: tokenFor("editor"), params: P, body: { which: "after", note: "  Raised loads " } });
    expect(res.statusCode).toBe(200);
    expect(team.recordFundraiserCall).toHaveBeenCalledWith(9, "after", "Raised loads", EMAIL, "admin:fern@example.com");
  });

  it("treats a blank note as none", async () => {
    team.recordFundraiserCall.mockResolvedValue({});
    await run(routes.postFundraiserCall, { token: tokenFor("editor"), params: P, body: { which: "before", note: "   " } });
    expect(team.recordFundraiserCall.mock.calls[0][2]).toBeNull();
  });

  it("refuses a note over 500 characters, an unknown call, or anything else sent", async () => {
    for (const body of [{ which: "before", note: "a".repeat(501) }, { which: "during" }, { which: "before", calledAt: "2026-01-01" }]) {
      expect((await run(routes.postFundraiserCall, { token: tokenFor("editor"), params: P, body })).statusCode).toBe(400);
    }
    expect(team.recordFundraiserCall).not.toHaveBeenCalled();
  });

  it("says so for a fundraiser not there or without a date", async () => {
    team.recordFundraiserCall.mockRejectedValue(new TeamError("not_found"));
    expect((await run(routes.postFundraiserCall, { token: tokenFor("editor"), params: P, body: { which: "before" } })).statusCode).toBe(404);
  });
});

describe("taking a fundraiser off Get involved", () => {
  it("takes it off, and puts it back", async () => {
    team.setOffList.mockResolvedValueOnce({ offListAt: "2026-12-01T10:00:00.000Z" }).mockResolvedValueOnce({ offListAt: null });
    expect((await run(routes.postOffList, { token: tokenFor("editor"), params: P })).body).toEqual({ offListAt: "2026-12-01T10:00:00.000Z" });
    expect(team.setOffList).toHaveBeenLastCalledWith(9, true, "admin:fern@example.com");
    expect((await run(routes.postOnList, { token: tokenFor("editor"), params: P })).body).toEqual({ offListAt: null });
    expect(team.setOffList).toHaveBeenLastCalledWith(9, false, "admin:fern@example.com");
  });

  it("refuses one that is not approved", async () => {
    team.setOffList.mockRejectedValue(new TeamError("bad_status"));
    expect((await run(routes.postOffList, { token: tokenFor("editor"), params: P })).statusCode).toBe(409);
  });
});

describe("the Monday summary's list", () => {
  it("is read by an admin", async () => {
    const res = await run(routes.getSummary, { token: tokenFor("admin") });
    expect(res.body).toEqual({ recipients: ["fern@example.com"], lastWeek: null });
  });

  it("is saved tidied, by an admin", async () => {
    const res = await run(routes.putSummary, { token: tokenFor("admin"), body: { recipients: [" Rowan@Example.com", "fern@example.com"] } });
    expect(res.statusCode).toBe(200);
    expect(team.saveSummaryRecipients).toHaveBeenCalledWith(["fern@example.com", "rowan@example.com"], "admin:fern@example.com");
  });

  it("refuses an address that is not whole, or one twice", async () => {
    for (const recipients of [["fern@"], ["fern@example.com", "FERN@example.com"]]) {
      const res = await run(routes.putSummary, { token: tokenFor("admin"), body: { recipients } });
      expect(res.statusCode).toBe(400);
    }
    expect((await run(routes.putSummary, { token: tokenFor("admin"), body: { recipients: [], extra: 1 } })).statusCode).toBe(400);
    expect(team.saveSummaryRecipients).not.toHaveBeenCalled();
  });

  it("sends a test to the admin asking, and nobody else", async () => {
    const res = await run(routes.postSummaryTest, { token: tokenFor("admin") });
    expect(res.body).toEqual({ sentTo: EMAIL });
    expect(sendSummaryTest).toHaveBeenCalledWith(EMAIL);
  });

  it("says when the test did not go", async () => {
    sendSummaryTest.mockRejectedValue(new Error("SES said no"));
    expect((await run(routes.postSummaryTest, { token: tokenFor("admin") })).statusCode).toBe(502);
  });
});
