import { describe, it, expect, vi, beforeEach } from "vitest";

// Jaimie, 2026-10-04: a NEW email to the team organiser when staff approve a new team member's
// page, so "you get the team's emails" (in "Your team page is live" and the handover email) is true.
// It is new wording, so it is held until an admin approves it (key "team_joined", with the other
// wording sign offs), and it is an automatic email, so it also waits for the Automatic emails switch
// and for fundraising to be on. While it is held nothing is sent and nothing is logged. Never to the
// team organiser about their own page, never for a page in memory of someone, never to an address
// that asked us to stop. A member under 18 is named by the child's first name as the page shows it,
// and the email only ever goes to the team organiser. Every name and address here is invented.

vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test", ADMIN_SESSION_SECRET: "s".repeat(32) },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { buildTeamMemberJoinedEmail, sampleTeamMemberJoinedEmail } from "../../src/fundraising/team-page-emails";
import { sendTeamMemberJoined, type TeamJoinedDeps } from "../../src/fundraising/team-send";
import { TEAM_JOINED_KEY, TEAM_WORDING_KEYS } from "../../src/fundraising/teams";
import { WORDING_KEYS } from "../../src/fundraising/touch-rules";
import { INVITE_WORDING_KEYS } from "../../src/fundraising/invite";
import { PLEDGE_WORDING_KEYS } from "../../src/pledges/model";
import type { FundraiserRecord } from "../../src/fundraising/model";

const words = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "\u00a6").replace(/&#39;/g, "'");

describe("the wording key", () => {
  it("is its own key, apart from every other wording that is signed off", () => {
    expect(TEAM_JOINED_KEY).toBe("team_joined");
    expect([...TEAM_WORDING_KEYS]).toEqual(["team_joined"]);
    for (const other of [...WORDING_KEYS, ...INVITE_WORDING_KEYS, ...PLEDGE_WORDING_KEYS]) expect(other).not.toBe(TEAM_JOINED_KEY);
  });
});

describe("the email to the team organiser", () => {
  const mail = buildTeamMemberJoinedEmail({
    organiser: { name: "Robin Organiser", firstName: "Robin" },
    memberFirstName: "Ava",
    teamTitle: "Exampleton Juniors",
    teamUrl: "https://nbcc.test/fundraise/ej",
  });

  it("has the subject and heading Jaimie asked for", () => {
    expect(mail.subject).toBe("Ava has joined Exampleton Juniors");
    expect(mail.html).toContain(">Ava has joined your team!</h1>");
  });

  it("says who joined, and that their page now counts towards the team total, in the house voice", () => {
    expect(mail.text.split("\n")[0]).toBe("Hi Robin,");
    for (const part of [words(mail.html), mail.text]) {
      expect(part).toContain("Ava has joined");
      expect(part).toContain("Exampleton Juniors");
      expect(part).toContain("counts towards your team total");
    }
    expect(mail.text).toContain("Great news: Ava has joined Exampleton Juniors.");
    expect(mail.text).toContain("We've approved their page, and everything it raises now counts towards your team total.");
  });

  it("has the button to the team page, the usual sign off and the questions box", () => {
    expect(mail.html).toContain('href="https://nbcc.test/fundraise/ej"');
    expect(mail.html).toContain(">See your team page</a>");
    expect(mail.text).toContain("See your team page: https://nbcc.test/fundraise/ej");
    expect(mail.text).toContain("Cheering your whole team on,\nNBCC Team");
    expect(mail.html).toContain("Got any questions?");
    expect(mail.text).toContain("Got any questions?");
    expect(mail.html).toContain(">Fundraising for NBCC</p>");
  });

  it("is plain English in the one style: straight apostrophes, no dashes, no captain", () => {
    for (const part of [mail.subject, words(mail.html), mail.text]) {
      expect(part).not.toMatch(/[‘’–—]/);
      expect(part).not.toMatch(/captain/i);
    }
  });

  it("leaves the button out for a team kept off the website", () => {
    const off = buildTeamMemberJoinedEmail({ organiser: { name: "Robin Organiser", firstName: "Robin" }, memberFirstName: "Ava", teamTitle: "Exampleton Juniors", teamUrl: null });
    expect(off.html).not.toContain("See your team page");
    expect(off.text).not.toContain("See your team page");
    expect(off.text).toContain("counts towards your team total");
  });

  it("greets a group or a business with Hi there, and escapes what was typed", () => {
    const odd = buildTeamMemberJoinedEmail({ organiser: { name: "The Example Arms", creditName: "The Example Arms" }, memberFirstName: "<b>Ava</b>", teamTitle: "<i>Team</i> & co", teamUrl: null });
    expect(odd.text.split("\n")[0]).toBe("Hi there,");
    expect(odd.html).not.toContain("<b>Ava</b>");
    expect(odd.html).not.toContain("<i>Team</i>");
    expect(odd.html).toContain("&lt;i&gt;Team&lt;/i&gt; &amp; co");
  });

  it("still reads well with no first name to use", () => {
    const none = buildTeamMemberJoinedEmail({ organiser: { name: "Robin Organiser", firstName: "Robin" }, memberFirstName: null, teamTitle: "Exampleton Juniors", teamUrl: null });
    expect(none.subject).toBe("A new member has joined Exampleton Juniors");
    expect(none.html).toContain(">A new member has joined your team!</h1>");
    expect(none.text).toContain("Great news: a new member has joined Exampleton Juniors.");
  });

  it("has an invented example for the admin to read before approving it", () => {
    const sample = sampleTeamMemberJoinedEmail("https://nbcc.test/");
    expect(sample.subject).toBe("Alex has joined Team Tinsel");
    expect(sample.html).toContain('href="https://nbcc.test/fundraise/team-tinsel"');
  });
});

// --- sending it -------------------------------------------------------------------------------------

const team = (over: Partial<FundraiserRecord> = {}) =>
  ({ id: 40, slug: "ej", path: "raising", title: "Exampleton Juniors", public: true, status: "approved", name: "Robin Organiser", firstName: "Robin", email: "robin@example.com", isTeam: true, ...over }) as unknown as FundraiserRecord;
const member = (over: Partial<FundraiserRecord> = {}) =>
  ({ id: 41, slug: "ava", path: "raising", title: "Ava's page", public: true, status: "approved", name: "Ava Example", firstName: "Ava", email: "ava@example.com", teamId: 40, ...over }) as unknown as FundraiserRecord;

function deps(over: Partial<TeamJoinedDeps> = {}) {
  const sent: Array<{ kind: string; name: string | null; to: string; subject: string; text: string; from: string; replyTo: string }> = [];
  const d: TeamJoinedDeps = {
    getTeam: vi.fn(async () => team()),
    fundraisingOn: vi.fn(async () => true),
    touchOn: vi.fn(async () => true),
    approvedWordings: vi.fn(async () => new Set<string>(["team_joined"])),
    blocked: vi.fn(async () => false),
    send: vi.fn(async (kind, name, m) => {
      sent.push({ kind, name, to: m.email, subject: m.subject, text: m.text ?? "", from: m.from, replyTo: m.replyTo });
    }),
    ...over,
  };
  return { d, sent };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("telling the team organiser a new member's page is approved", () => {
  it("emails the team organiser, from and replying to the events inbox, under its own kind", async () => {
    const { d, sent } = deps();
    expect(await sendTeamMemberJoined(member(), d)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "fundraiseTeamMemberJoined", name: "Robin Organiser", to: "robin@example.com", subject: "Ava has joined Exampleton Juniors", from: "events@nbcc.test", replyTo: "events@nbcc.test" });
    expect(sent[0].text).toContain("See your team page: https://nbcc.test/fundraise/ej");
    expect(d.getTeam).toHaveBeenCalledWith(40);
  });

  it("is held, sending and logging nothing, until an admin approves its wording", async () => {
    const { d, sent } = deps({ approvedWordings: vi.fn(async () => new Set<string>(["target", "invite_memory", "pledge_pay"])) });
    expect(await sendTeamMemberJoined(member(), d)).toBe("held");
    expect(sent).toEqual([]);
    expect(d.send).not.toHaveBeenCalled();
  });

  it("is held when the approvals cannot be read", async () => {
    const { d } = deps({ approvedWordings: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await sendTeamMemberJoined(member(), d)).toBe("held");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("is held while Automatic emails is off, or fundraising is off, or either cannot be read", async () => {
    for (const over of [
      { touchOn: vi.fn(async () => false) },
      { fundraisingOn: vi.fn(async () => false) },
      { touchOn: vi.fn(async () => { throw new Error("db down"); }) },
      { fundraisingOn: vi.fn(async () => { throw new Error("db down"); }) },
    ] as Array<Partial<TeamJoinedDeps>>) {
      const { d } = deps(over);
      expect(await sendTeamMemberJoined(member(), d)).toBe("held");
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("never emails the team organiser about themselves", async () => {
    for (const m of [member({ email: "ROBIN@example.com " }), member({ id: 40 })]) {
      const { d } = deps();
      expect(await sendTeamMemberJoined(m, d)).toBe("skipped");
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("uses the child's first name as the page shows it, and never the parent's email", async () => {
    const { d, sent } = deps();
    await sendTeamMemberJoined(member({ name: "JACK example", firstName: "JACK", guardianFirstName: "Sarah", email: "parent@example.com" }), d);
    expect(sent[0].subject).toBe("Jack has joined Exampleton Juniors");
    expect(sent[0].to).toBe("robin@example.com");
    expect(JSON.stringify(sent[0])).not.toContain("parent@example.com");
    expect(JSON.stringify(sent[0])).not.toContain("Sarah");
    expect((d.send as ReturnType<typeof vi.fn>).mock.calls[0][2]).not.toHaveProperty("cc");
  });

  it("skips quietly for a page in memory of someone, whichever of the two it is", async () => {
    const a = deps();
    expect(await sendTeamMemberJoined(member({ inMemory: true }), a.d)).toBe("skipped");
    const b = deps({ getTeam: vi.fn(async () => team({ inMemory: true })) });
    expect(await sendTeamMemberJoined(member(), b.d)).toBe("skipped");
    expect(a.d.send).not.toHaveBeenCalled();
    expect(b.d.send).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("skips anything that is not an approved member page of a team that is still going", async () => {
    const cases: Array<[FundraiserRecord, Partial<TeamJoinedDeps>]> = [
      [member({ teamId: null }), {}],
      [member({ isTeam: true }), {}],
      [member({ status: "new" }), {}],
      [member({ teamLeftAt: "2026-10-01T10:00:00Z" }), {}],
      [member(), { getTeam: vi.fn(async () => null) }],
      [member(), { getTeam: vi.fn(async () => team({ isTeam: false })) }],
      [member(), { getTeam: vi.fn(async () => team({ status: "declined" })) }],
    ];
    for (const [m, over] of cases) {
      const { d } = deps(over);
      expect(await sendTeamMemberJoined(m, d)).toBe("skipped");
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("never emails an address that asked us to stop, or when the lists cannot be read", async () => {
    const a = deps({ blocked: vi.fn(async () => true) });
    expect(await sendTeamMemberJoined(member(), a.d)).toBe("skipped");
    const b = deps({ blocked: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await sendTeamMemberJoined(member(), b.d)).toBe("skipped");
    expect(a.d.send).not.toHaveBeenCalled();
    expect(b.d.send).not.toHaveBeenCalled();
  });

  it("leaves the button out for a team kept off the website", async () => {
    const { d, sent } = deps({ getTeam: vi.fn(async () => team({ public: false })) });
    await sendTeamMemberJoined(member(), d);
    expect(sent[0].text).not.toContain("See your team page");
  });

  it("never throws, and never logs an address, when the send fails", async () => {
    const { d } = deps({ send: vi.fn(async () => { throw new Error("rejected robin@example.com"); }) });
    expect(await sendTeamMemberJoined(member(), d)).toBe("failed");
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged).not.toContain("robin@example.com");
  });
});
