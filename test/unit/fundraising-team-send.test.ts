import { describe, it, expect, vi } from "vitest";

// Team pages (Jaimie, 2026-10-03): sending, when staff approve a team. The people the team organiser
// added are invited then (never before), each claimed before it is sent so none goes twice, given
// back if the send fails, and skipped if the address asked us to stop. Then the team organiser hears
// their team page is live, ALWAYS with the join link. Every name and address here is invented.

vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot", ADMIN_SESSION_SECRET: "s".repeat(32) },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { sendTeamApproved, type TeamSendDeps } from "../../src/fundraising/team-send";
import type { FundraiserRecord } from "../../src/fundraising/model";

const team = {
  id: 40,
  slug: "ej",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "Santa dash",
  title: "Exampleton Juniors",
  eventDate: "2026-12-05",
  public: true,
  status: "approved",
  name: "Robin Organiser",
  email: "robin@example.com",
  isTeam: true,
} as unknown as FundraiserRecord;

const held = (id: number, email: string, first = "Ava") => ({
  id, teamId: 40, firstName: first, lastName: "Example", email, createdAt: "2026-10-01T10:00:00Z", sentAt: null, remindedAt: null, joinedAt: null, deletedAt: null, joinedFundraiserId: null,
});

function deps(over: Partial<TeamSendDeps> = {}) {
  const sent: Array<{ kind: string; to: string; subject: string; text: string }> = [];
  const d: TeamSendDeps = {
    fundraisingOn: vi.fn(async () => true),
    listHeld: vi.fn(async () => [held(7, "ava@example.com"), held(8, "parent@example.com", "Jack"), held(9, "stop@example.com")]),
    blocked: vi.fn(async (email: string) => email === "stop@example.com"),
    claimInvite: vi.fn(async () => true),
    releaseInvite: vi.fn(async () => undefined),
    newToken: vi.fn(() => "t".repeat(43)),
    send: vi.fn(async (kind, _name, m) => {
      sent.push({ kind, to: m.email, subject: m.subject, text: m.text });
    }),
    ...over,
  };
  return { d, sent };
}

describe("approving a team", () => {
  it("invites everyone added, except an address that asked us to stop, then tells the team organiser", async () => {
    const { d, sent } = deps();
    const r = await sendTeamApproved(team, d);
    expect(r).toEqual({ invited: 2, failed: 0, skipped: 1, liveSent: true });
    expect(sent.map((s) => [s.kind, s.to])).toEqual([
      ["fundraiseTeamInvite", "ava@example.com"],
      ["fundraiseTeamInvite", "parent@example.com"],
      ["fundraiseTeamLive", "robin@example.com"],
    ]);
    expect(sent[1].text).toContain("(or Jack, if this is a parent or guardian’s email)");
    expect(sent[0].text).toContain(`https://nbcc.scot/fundraise/ej/join?invite=${"t".repeat(43)}`);
    expect(sent[2].text).toContain("https://nbcc.scot/fundraise/ej/join");
    expect(sent[2].text).toContain("the 2 people you added");
  });

  it("speaks to the parent or guardian when the team organiser ticked under 18", async () => {
    const { d, sent } = deps({ listHeld: vi.fn(async () => [{ ...held(8, "parent@example.com", "Jack"), under18: true }]) });
    await sendTeamApproved(team, d);
    expect(sent[0].subject).toBe("Robin has invited Jack to join Exampleton Juniors");
    expect(sent[0].text).toContain("as the parent or guardian of Jack");
  });

  it("claims each invite with its token's hash before sending it", async () => {
    const { d } = deps();
    await sendTeamApproved(team, d);
    expect(d.claimInvite).toHaveBeenCalledWith(7, expect.stringMatching(/^[0-9a-f]{64}$/));
    const order = (d.claimInvite as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const firstSend = (d.send as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(order).toBeLessThan(firstSend);
  });

  it("never sends one claimed already, and gives one back whose send failed", async () => {
    const { d, sent } = deps({
      claimInvite: vi.fn(async (id: number) => id !== 7),
      send: vi.fn(async (kind: string, _n: string | null, m: { email: string; subject: string; text: string }) => {
        if (m.email === "parent@example.com") throw new Error("SES says no");
        sent.push({ kind, to: m.email, subject: m.subject, text: m.text });
      }),
    });
    const r = await sendTeamApproved(team, d);
    expect(r).toEqual({ invited: 0, failed: 1, skipped: 2, liveSent: true });
    expect(d.releaseInvite).toHaveBeenCalledWith(8);
    expect(sent.map((s) => s.kind)).toEqual(["fundraiseTeamLive"]);
  });

  it("still tells the team organiser when the invites could not be read", async () => {
    const { d, sent } = deps({ listHeld: vi.fn(async () => Promise.reject(new Error("db down"))) });
    const r = await sendTeamApproved(team, d);
    expect(r.liveSent).toBe(true);
    expect(sent.map((s) => s.kind)).toEqual(["fundraiseTeamLive"]);
  });

  it("never throws, even when the live email fails", async () => {
    const { d } = deps({ listHeld: vi.fn(async () => []), send: vi.fn(async () => Promise.reject(new Error("down"))) });
    await expect(sendTeamApproved(team, d)).resolves.toMatchObject({ liveSent: false });
  });

  it("says the team is approved, without a page link, when it is kept off the website", async () => {
    const { d, sent } = deps({ listHeld: vi.fn(async () => []) });
    await sendTeamApproved({ ...team, public: false }, d);
    expect(sent[0].subject).toBe("Your team is approved: Exampleton Juniors");
  });
});

describe("nothing team related goes while fundraising is off (review)", () => {
  it("sends no invite and no live email", async () => {
    const { d, sent } = deps({ fundraisingOn: vi.fn(async () => false) });
    const r = await sendTeamApproved(team, d);
    expect(r).toEqual({ invited: 0, failed: 0, skipped: 0, liveSent: false });
    expect(sent).toEqual([]);
    expect(d.claimInvite).not.toHaveBeenCalled();
  });

  it("names nobody in the email log's name for an invite", async () => {
    const { d } = deps();
    await sendTeamApproved(team, d);
    const invites = (d.send as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "fundraiseTeamInvite");
    expect(invites.length).toBe(2);
    for (const c of invites) expect(c[1]).toBeNull();
  });

  it("never logs an invitee's address when a send fails", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
    const { d } = deps({ send: vi.fn(async () => Promise.reject(new Error("Rejected: parent@example.com is suppressed"))) });
    await sendTeamApproved(team, d);
    spy.mockRestore();
    expect(errors.join("\n")).not.toContain("@example.com");
  });
});
