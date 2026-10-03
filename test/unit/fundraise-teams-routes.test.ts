import { describe, it, expect, vi, beforeEach } from "vitest";

// Team pages (Jaimie, 2026-10-03): the public side of a team, with the database and the emails
// mocked. Joining makes a member page waiting for staff, linked to the team in the same transaction;
// a whole team split is the team's, whatever is sent; an invite's link fills the form in; the team
// organiser sees their team and can take someone off it; and the new team organiser confirms a
// handover with the code staff sent. Every name and address here is invented.

const db = vi.hoisted(() => ({ getBySlug: vi.fn(), createFundraiser: vi.fn(), fundraisingIsOn: vi.fn() }));
const teams = vi.hoisted(() => ({
  linkMember: vi.fn(),
  findTeamInviteByHash: vi.fn(),
  listTeamMembers: vi.fn(),
  removeTeamMember: vi.fn(),
  confirmHandover: vi.fn(),
}));
const send = vi.hoisted(() => ({ sendJoinEmails: vi.fn(), sendMemberRemovedEmail: vi.fn() }));
const manage = vi.hoisted(() => ({ signedIn: vi.fn(), ownFundraiser: vi.fn(), fromOurOwnPage: vi.fn() }));

vi.mock("../../src/db/fundraisers", async () => {
  class FundraiserError extends Error {}
  return { ...db, FundraiserError };
});
vi.mock("../../src/db/fundraising-teams", async () => {
  class TeamError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...teams, TeamError };
});
vi.mock("../../src/fundraising/team-send", () => send);
vi.mock("../../src/routes/fundraise", () => manage);
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, verifyCaptcha: vi.fn() }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", ADMIN_SESSION_SECRET: "s".repeat(40) } }));

import { postJoinTeam, postTeamInvitePrefill, getManageTeam, postRemoveTeamMember, postHandoverConfirm } from "../../src/routes/fundraise-teams";
import { meter, UNDER_18, type FundraiserRecord } from "../../src/fundraising/model";
import { hashTeamInviteToken, handoverCodeKey } from "../../src/fundraising/teams";
import { hashSignInCode } from "../../src/fundraising/sign-in";

/* eslint-disable @typescript-eslint/no-explicit-any */
let ip = 0;
async function run(handler: (req: any, res: any) => unknown, o: { body?: unknown; params?: Record<string, string> } = {}) {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  await handler({ body: o.body ?? {}, params: o.params ?? {}, ip: `10.7.0.${++ip}`, headers: {} } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const team = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 40, slug: "ej", path: "raising", kind: "santa_dash", kindOther: null, title: "Exampleton Juniors", description: "Dashing.",
    eventDate: "2026-12-05", startTime: null, venue: "", town: "Exampleton", targetPence: 200000, public: true, status: "approved",
    name: "Robin Organiser", email: "robin@example.com", isTeam: true, teamShareMode: null, sharesWithOther: false,
    nbccSharePercent: null, otherCauseName: null, meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 200000 }), ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter> };

const join = (over: Record<string, unknown> = {}) => ({ firstName: "Jack", lastName: "Sample", email: "parent@example.com", over18: true, ...over });

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(teams), ...Object.values(send), ...Object.values(manage)]) fn.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  db.getBySlug.mockResolvedValue(team());
  db.createFundraiser.mockImplementation(async (s: Record<string, unknown>) => ({ id: 41, slug: "jp", teamId: 40, ...s }));
  manage.fromOurOwnPage.mockReturnValue(true);
  manage.signedIn.mockResolvedValue({ email: "robin@example.com", sessionHash: "h" });
  manage.ownFundraiser.mockResolvedValue(team());
});

describe("joining a team", () => {
  it("makes a member page waiting for staff, linked to the team in the same transaction, and emails", async () => {
    const res = await run(postJoinTeam, { params: { slug: "ej" }, body: join({ targetPence: 5000, why: "For Christmas." }) });
    expect(res.statusCode).toBe(200);
    const [s, extra] = db.createFundraiser.mock.calls[0];
    expect(s).toMatchObject({ title: "Jack's page for Exampleton Juniors", email: "parent@example.com", targetPence: 5000, description: "For Christmas.", kind: "santa_dash" });
    const client = {};
    await extra(client, 41);
    expect(teams.linkMember).toHaveBeenCalledWith(client, 41, 40, null);
    expect(send.sendJoinEmails).toHaveBeenCalledWith(expect.objectContaining({ id: 41 }), expect.objectContaining({ id: 40 }));
  });

  it("carries an invite's token so that invite is marked joined", async () => {
    const token = "a".repeat(43);
    await run(postJoinTeam, { params: { slug: "ej" }, body: join({ invite: token }) });
    await db.createFundraiser.mock.calls[0][1]({}, 41);
    expect(teams.linkMember.mock.calls[0][3]).toBe(hashTeamInviteToken(token));
  });

  it("refuses someone under 18 with the kind note, storing nothing", async () => {
    const res = await run(postJoinTeam, { params: { slug: "ej" }, body: join({ over18: false }) });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields.over18).toBe(UNDER_18);
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });

  it("gives every member of a whole team split the team's split", async () => {
    db.getBySlug.mockResolvedValue(team({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder", teamShareMode: "team" }));
    await run(postJoinTeam, { params: { slug: "ej" }, body: join({ sharesWithOther: false }) });
    expect(db.createFundraiser.mock.calls[0][0]).toMatchObject({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder" });
  });

  it("is only for an approved team, while fundraising is on", async () => {
    db.getBySlug.mockResolvedValue(team({ isTeam: false }));
    expect((await run(postJoinTeam, { params: { slug: "ej" }, body: join() })).statusCode).toBe(404);
    db.getBySlug.mockResolvedValue(team({ status: "finished" }));
    expect((await run(postJoinTeam, { params: { slug: "ej" }, body: join() })).statusCode).toBe(404);
    db.getBySlug.mockResolvedValue(team());
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await run(postJoinTeam, { params: { slug: "ej" }, body: join() })).statusCode).toBe(404);
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });

  it("says so when the team closed in the same moment", async () => {
    const { TeamError } = await import("../../src/db/fundraising-teams");
    db.createFundraiser.mockRejectedValue(new (TeamError as unknown as new (r: string) => Error)("team_closed"));
    expect((await run(postJoinTeam, { params: { slug: "ej" }, body: join() })).statusCode).toBe(404);
  });

  it("pretends all is well to a bot that fills the hidden box, storing nothing", async () => {
    const res = await run(postJoinTeam, { params: { slug: "ej" }, body: join({ company: "Spam Ltd" }) });
    expect(res.statusCode).toBe(200);
    expect(db.createFundraiser).not.toHaveBeenCalled();
  });
});

describe("an invite's link filling in the join form", () => {
  const invite = (over: Record<string, unknown> = {}) => ({
    id: 7, teamId: 40, teamSlug: "ej", firstName: "Jack", lastName: "Sample", email: "parent@example.com", createdAt: "2026-10-03T10:00:00Z",
    sentAt: "2026-10-03T10:00:00Z", remindedAt: null, joinedAt: null, deletedAt: null, joinedFundraiserId: null, teamStatus: "approved", ...over,
  });

  it("gives back the first name, surname and email, and the team, nothing else", async () => {
    teams.findTeamInviteByHash.mockResolvedValue(invite());
    const res = await run(postTeamInvitePrefill, { body: { token: "a".repeat(43) } });
    expect(res.body).toEqual({ firstName: "Jack", lastName: "Sample", email: "parent@example.com", teamSlug: "ej" });
    expect(teams.findTeamInviteByHash).toHaveBeenCalledWith(hashTeamInviteToken("a".repeat(43)));
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("gives one plain answer for anything else: unknown, joined, deleted or not a token", async () => {
    for (const found of [null, invite({ joinedAt: "2026-10-04T10:00:00Z" }), invite({ deletedAt: "2026-10-30T10:00:00Z", firstName: null, email: null })]) {
      teams.findTeamInviteByHash.mockResolvedValue(found);
      const res = await run(postTeamInvitePrefill, { body: { token: "a".repeat(43) } });
      expect(res.statusCode).toBe(404);
    }
    expect((await run(postTeamInvitePrefill, { body: { token: "short" } })).statusCode).toBe(404);
  });
});

describe("the team organiser's private area", () => {
  const member = (id: number, name: string, over: Partial<FundraiserRecord> = {}) =>
    ({ ...team({ id, slug: `m${id}`, name, firstName: name.split(" ")[0], isTeam: false, teamId: 40, status: "approved", targetPence: 5000 }), ...over }) as FundraiserRecord;

  it("shows the join link, the message to forward, and the members approved and waiting, A to Z", async () => {
    teams.listTeamMembers.mockResolvedValue([
      member(42, "Zara Example"),
      member(41, "Ava Sample", { status: "new" }),
      member(43, "Ben Gone", { teamLeftAt: "2026-10-10T10:00:00Z" }),
      member(44, "Cal No", { status: "declined" }),
    ]);
    const res = await run(getManageTeam, { params: { id: "40" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.joinUrl).toBe("https://nbcc.test/fundraise/ej/join");
    expect(res.body.forwardMessage).toContain("https://nbcc.test/fundraise/ej/join");
    expect(res.body.members.map((m: { name: string; status: string }) => [m.name, m.status])).toEqual([
      ["Ava Sample", "waiting"],
      ["Zara Example", "live"],
    ]);
    expect(JSON.stringify(res.body)).not.toContain("example.com\"");
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("is only for a team", async () => {
    manage.ownFundraiser.mockResolvedValue(team({ isTeam: false }));
    expect((await run(getManageTeam, { params: { id: "40" } })).statusCode).toBe(404);
  });

  it("takes a member off the team, and tells staff", async () => {
    teams.removeTeamMember.mockResolvedValue({ team: team(), member: member(41, "Ava Sample") });
    const res = await run(postRemoveTeamMember, { params: { id: "40", memberId: "41" } });
    expect(res.statusCode).toBe(200);
    expect(teams.removeTeamMember).toHaveBeenCalledWith(40, 41, "robin@example.com");
    expect(send.sendMemberRemovedEmail).toHaveBeenCalled();
  });

  it("refuses a change another website's page sent", async () => {
    manage.fromOurOwnPage.mockImplementation((_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      res.status(403).json({ error: "Please use the form on our website." });
      return false;
    });
    expect((await run(postRemoveTeamMember, { params: { id: "40", memberId: "41" } })).statusCode).toBe(403);
    expect(teams.removeTeamMember).not.toHaveBeenCalled();
  });
});

describe("confirming a handover", () => {
  it("checks the code against the hash for that team and email, and says which team", async () => {
    teams.confirmHandover.mockImplementation(async (email: string, matches: (h: { id: number; teamId: number; codeHash: string }) => boolean) =>
      matches({ id: 3, teamId: 40, codeHash: hashSignInCode(handoverCodeKey(40, email), "123456", "s".repeat(40)) })
        ? { status: "ok", team: team({ name: "Sam New" }) }
        : { status: "wrong" },
    );
    const ok = await run(postHandoverConfirm, { body: { email: "Sam@Example.com", code: "123 456" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual({ status: "ok", title: "Exampleton Juniors" });
    const wrong = await run(postHandoverConfirm, { body: { email: "sam@example.com", code: "654321" } });
    expect(wrong.statusCode).toBe(401);
  });

  it("asks for the email and the 6 digit code", async () => {
    expect((await run(postHandoverConfirm, { body: { email: "sam@example.com", code: "12" } })).statusCode).toBe(400);
    expect(teams.confirmHandover).not.toHaveBeenCalled();
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("where the team routes are mounted", () => {
  const app = readFileSync(resolve(__dirname, "../../src/app.ts"), "utf8");
  const at = (s: string) => app.indexOf(s);

  it("before fundraiseRouter, whose retired link route would otherwise take /manage/handover", () => {
    expect(at("app.use(fundraiseTeamsRouter);")).toBeGreaterThan(-1);
    expect(at("app.use(fundraiseTeamsRouter);")).toBeLessThan(at("app.use(fundraiseRouter);"));
  });

  it("and the admin's team routes too", () => {
    expect(at("app.use(adminFundraisingTeamsRouter);")).toBeGreaterThan(-1);
  });
});

describe("an invite's link, after review", () => {
  const inv = { id: 7, teamId: 40, teamSlug: "ej", teamStatus: "approved", firstName: "Jack", lastName: "Sample", email: "parent@example.com", createdAt: "2026-10-03T10:00:00Z", sentAt: "2026-10-03T10:00:00Z", remindedAt: null, joinedAt: null, deletedAt: null, joinedFundraiserId: null };

  it("fills in nothing while fundraising is off", async () => {
    teams.findTeamInviteByHash.mockResolvedValue(inv);
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await run(postTeamInvitePrefill, { body: { token: "a".repeat(43) } })).statusCode).toBe(404);
  });

  it("fills in nothing for a team no longer approved", async () => {
    teams.findTeamInviteByHash.mockResolvedValue({ ...inv, teamStatus: "finished" });
    expect((await run(postTeamInvitePrefill, { body: { token: "a".repeat(43) } })).statusCode).toBe(404);
  });
});
