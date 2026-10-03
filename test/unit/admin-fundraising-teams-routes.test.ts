import { describe, it, expect, vi, beforeEach } from "vitest";

// Team pages (Jaimie, 2026-10-03): Admin > Fundraising, for teams. Staff see a team's members (A to
// Z, every status), its invites (held, sent, reminded, joined, deleted), its whole team or organiser
// only split, and the combined meter; a member page says which team it is joining. Staff hand the
// team organiser role over (editors and admins): the new team organiser is emailed a code, kept here
// only as its keyed hash. The database and the emails are mocked; every name here is invented.

const db = vi.hoisted(() => ({ getFundraiser: vi.fn(), fundraisingIsOn: vi.fn() }));
const teams = vi.hoisted(() => ({
  listTeamMembers: vi.fn(),
  listTeamInvites: vi.fn(),
  openHandoverFor: vi.fn(),
  startHandover: vi.fn(),
  cancelHandover: vi.fn(),
  removeTeamMemberByStaff: vi.fn(),
}));
const send = vi.hoisted(() => ({ sendHandoverCodeEmail: vi.fn() }));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/fundraisers", () => db);
vi.mock("../../src/db/fundraising-teams", async () => {
  class TeamError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...teams, TeamError };
});
vi.mock("../../src/fundraising/team-send", () => send);
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { getAdminTeam, postAdminHandover, postAdminHandoverCancel, postAdminRemoveMember } from "../../src/routes/admin-fundraising-teams";
import { signAdminSession } from "../../src/admin/session";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { handoverCodeKey } from "../../src/fundraising/teams";
import { signInCodeMatches } from "../../src/fundraising/sign-in";

const SECRET = "test-admin-secret";
function tokenFor(role: string) {
  getUserAuthRowMock.mockResolvedValue({ id: 3, email: "fern@example.com", status: "active", role, permissions: {} });
  return signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: SECRET }).token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(handler: (req: any, res: any) => Promise<unknown>, o: { token?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  await handler({ headers: o.token ? { authorization: `Bearer ${o.token}` } : {}, body: o.body ?? {}, params: o.params ?? {} } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const rec = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 40, slug: "ej", path: "raising", kind: "santa_dash", title: "Exampleton Juniors", public: true, status: "approved",
    name: "Robin Organiser", firstName: "Robin", lastName: "Organiser", email: "robin@example.com", targetPence: 200000,
    isTeam: true, teamShareMode: "team", sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder",
    meter: meter({ onlinePence: 1000, cashPence: 0, targetPence: 200000 }), ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter> };

const member = (id: number, name: string, over: Partial<FundraiserRecord> = {}) =>
  rec({ id, slug: `m${id}`, name, firstName: name.split(" ")[0], lastName: name.split(" ")[1], email: `${name.split(" ")[0].toLowerCase()}@example.com`, isTeam: false, teamId: 40, teamShareMode: null, meter: meter({ onlinePence: 2000, cashPence: 500, targetPence: 5000 }), ...over });

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(teams), ...Object.values(send)]) fn.mockReset();
  db.getFundraiser.mockImplementation(async (id: number) => (id === 40 ? rec() : id === 41 ? member(41, "Ava Sample") : null));
  teams.listTeamMembers.mockResolvedValue([member(42, "Zara Example"), member(41, "Ava Sample"), member(43, "Ben New", { status: "new" }), member(44, "Cal Gone", { teamLeftAt: "2026-10-10T10:00:00.000Z" })]);
  teams.listTeamInvites.mockResolvedValue([
    { id: 7, teamId: 40, firstName: "Dee", lastName: "Example", email: "dee@example.com", createdAt: "2026-10-01T10:00:00.000Z", sentAt: null, remindedAt: null, joinedAt: null, deletedAt: null, joinedFundraiserId: null },
    { id: 8, teamId: 40, firstName: null, lastName: null, email: null, createdAt: "2026-09-01T10:00:00.000Z", sentAt: "2026-09-02T10:00:00.000Z", remindedAt: null, joinedAt: "2026-09-03T10:00:00.000Z", deletedAt: "2026-10-02T10:00:00.000Z", joinedFundraiserId: 41 },
  ]);
  teams.openHandoverFor.mockResolvedValue(null);
  teams.startHandover.mockResolvedValue(3);
  db.fundraisingIsOn.mockResolvedValue(true);
  send.sendHandoverCodeEmail.mockResolvedValue(true);
});

describe("a team, for staff", () => {
  it("needs someone who can view fundraising", async () => {
    expect((await run(getAdminTeam, { params: { id: "40" } })).statusCode).toBe(401);
  });

  it("shows the members A to Z, every status, the invites where they are up to, the split and the combined meter", async () => {
    const res = await run(getAdminTeam, { token: tokenFor("viewer"), params: { id: "40" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.kind).toBe("team");
    expect(res.body.members.map((m: { name: string; status: string; left: boolean }) => [m.name, m.status, m.left])).toEqual([
      ["Ava Sample", "approved", false],
      ["Ben New", "new", false],
      ["Cal Gone", "approved", true],
      ["Zara Example", "approved", false],
    ]);
    expect(res.body.invites.map((i: { status: string; name: string | null }) => [i.status, i.name])).toEqual([
      ["held", "Dee Example"],
      ["joined", null],
    ]);
    expect(res.body.split).toBe("The whole team’s split: every member page shares 50% with NBCC, the rest to Exampleton Food Larder.");
    expect(res.body.joinUrl).toBe("https://nbcc.test/fundraise/ej/join");
    // The team's own £10, and two current approved members' £25 each (not the waiting one, not the one taken off).
    expect(res.body.meter.raisedPence).toBe(6000);
  });

  it("says which team a member page is joining", async () => {
    const res = await run(getAdminTeam, { token: tokenFor("viewer"), params: { id: "41" } });
    expect(res.body).toMatchObject({ kind: "member", team: { id: 40, title: "Exampleton Juniors", slug: "ej", shareMode: "team" }, left: false });
  });
});

describe("handing the team organiser role over", () => {
  it("is for editors and admins, never viewers", async () => {
    const res = await run(postAdminHandover, { token: tokenFor("viewer"), params: { id: "40" }, body: { memberId: 41, phone: "07700 900222" } });
    expect(res.statusCode).toBe(403);
    expect(teams.startHandover).not.toHaveBeenCalled();
  });

  it("to one of the team's members: their name and email, the phone staff give, and a code by email kept only as its hash", async () => {
    const res = await run(postAdminHandover, { token: tokenFor("editor"), params: { id: "40" }, body: { memberId: 41, phone: "07700 900222" } });
    expect(res.statusCode).toBe(200);
    const [teamId, to, codeHash, expiresAt, actor] = teams.startHandover.mock.calls[0];
    expect(teamId).toBe(40);
    expect(to).toEqual({ firstName: "Ava", lastName: "Sample", email: "ava@example.com", phone: "07700 900222" });
    expect(actor).toBe("admin:fern@example.com");
    const code = send.sendHandoverCodeEmail.mock.calls[0][2] as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(signInCodeMatches(handoverCodeKey(40, "ava@example.com"), code, codeHash, SECRET)).toBe(true);
    expect((expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(2.9 * 24 * 3600 * 1000);
    expect(JSON.stringify(res.body)).not.toContain(code);
  });

  it("to a new person", async () => {
    await run(postAdminHandover, { token: tokenFor("editor"), params: { id: "40" }, body: { firstName: "Sam", lastName: "New", email: "sam@example.com", phone: "07700 900123" } });
    expect(teams.startHandover.mock.calls[0][1]).toEqual({ firstName: "Sam", lastName: "New", email: "sam@example.com", phone: "07700 900123" });
  });

  it("refuses a member of another team, or a page that is not a team", async () => {
    db.getFundraiser.mockImplementation(async (id: number) => (id === 40 ? rec() : member(41, "Ava Sample", { teamId: 99 })));
    expect((await run(postAdminHandover, { token: tokenFor("editor"), params: { id: "40" }, body: { memberId: 41 } })).statusCode).toBe(400);
    db.getFundraiser.mockImplementation(async () => rec({ isTeam: false }));
    expect((await run(postAdminHandover, { token: tokenFor("editor"), params: { id: "40" }, body: { memberId: 41 } })).statusCode).toBe(409);
    expect(teams.startHandover).not.toHaveBeenCalled();
  });

  it("names a box that needs another look", async () => {
    const res = await run(postAdminHandover, { token: tokenFor("editor"), params: { id: "40" }, body: { firstName: "Sam", lastName: "New", email: "nope", phone: "07700 900123" } });
    expect(res.statusCode).toBe(400);
  });

  it("can be cancelled", async () => {
    teams.cancelHandover.mockResolvedValue(true);
    const res = await run(postAdminHandoverCancel, { token: tokenFor("editor"), params: { id: "40" } });
    expect(res.statusCode).toBe(200);
    expect(teams.cancelHandover).toHaveBeenCalledWith(40, "admin:fern@example.com");
  });
});

describe("staff taking someone off a team", () => {
  it("is for editors and admins, never viewers", async () => {
    const res = await run(postAdminRemoveMember, { token: tokenFor("viewer"), params: { id: "40", memberId: "41" } });
    expect(res.statusCode).toBe(403);
    expect(teams.removeTeamMemberByStaff).not.toHaveBeenCalled();
  });

  it("takes them off, recorded as the member of staff", async () => {
    teams.removeTeamMemberByStaff.mockResolvedValue({ team: rec(), member: member(41, "Ava Sample") });
    const res = await run(postAdminRemoveMember, { token: tokenFor("editor"), params: { id: "40", memberId: "41" } });
    expect(res.statusCode).toBe(200);
    expect(teams.removeTeamMemberByStaff).toHaveBeenCalledWith(40, 41, "admin:fern@example.com");
  });

  it("says so when they are no longer on the team", async () => {
    const { TeamError } = await import("../../src/db/fundraising-teams");
    teams.removeTeamMemberByStaff.mockRejectedValue(new (TeamError as unknown as new (r: string) => Error)("not_found"));
    const res = await run(postAdminRemoveMember, { token: tokenFor("editor"), params: { id: "40", memberId: "41" } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "That person is no longer on this team." });
  });
});

describe("handing over, after review", () => {
  it("only to an approved member still on the team", async () => {
    db.getFundraiser.mockImplementation(async (id: number) => (id === 40 ? rec() : member(41, "Ava Sample", { status: "new" })));
    const res = await run(postAdminHandover, { token: tokenFor("editor"), params: { id: "40" }, body: { memberId: 41, phone: "07700 900222" } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Choose someone whose page we have approved, on this team." });
    expect(teams.startHandover).not.toHaveBeenCalled();
  });
});

describe("no handover email while fundraising is off (review)", () => {
  it("refuses, emailing nobody", async () => {
    db.fundraisingIsOn.mockResolvedValue(false);
    const res = await run(postAdminHandover, { token: tokenFor("editor"), params: { id: "40" }, body: { firstName: "Sam", lastName: "New", email: "sam@example.com", phone: "07700 900123" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Fundraising is switched off, so we cannot email the code. Switch fundraising on first." });
    expect(teams.startHandover).not.toHaveBeenCalled();
    expect(send.sendHandoverCodeEmail).not.toHaveBeenCalled();
  });
});
