import { describe, it, expect } from "vitest";
import {
  TEAM_MEMBERS_MAX,
  checkTeamSignUp,
  checkJoin,
  memberSignUp,
  teamSplitFor,
  teamMeter,
  teamMemberList,
  joinUrl,
  forwardMessage,
  inviteStatus,
  inviteReminderDue,
  inviteDeleteDue,
  teamNudgeDue,
  handoverSchema,
  isCurrentMember,
  TEAM_MISSING,
  TEAM_SHARE_MODE_MISSING,
  JOIN_UNDER_18,
} from "../../src/fundraising/teams";
import { meter, UNDER_18, type FundraiserRecord } from "../../src/fundraising/model";

// Team pages (Jaimie, 2026-10-03): the rules, pure. A sponsorship fundraiser can be a team; the
// person who sets it up is the team organiser (never "captain"); people join with member pages of
// their own, which staff approve; gifts count on the member and on the team. Every name, team and
// address here is invented.

const member = (over: Record<string, unknown> = {}) => ({ firstName: "Ava", lastName: "Example", email: "ava@example.com", ...over });

describe("Just me, or a team?", () => {
  it("is only for raising money: an event is never a team, whatever is sent", () => {
    const r = checkTeamSignUp({ path: "event", team: "team", teamMembers: [member()] });
    expect(r.fields).toEqual({});
    expect(r.team).toEqual({ isTeam: false, shareMode: null, members: [] });
  });

  it("takes just me as no team", () => {
    expect(checkTeamSignUp({ path: "raising", team: "me", sharesWithOther: false }).team).toEqual({ isTeam: false, shareMode: null, members: [] });
  });

  it("reads no answer as just me: a form opened before the question, or any other sender, is unchanged", () => {
    expect(checkTeamSignUp({ path: "raising" })).toEqual({ team: { isTeam: false, shareMode: null, members: [] }, fields: {} });
  });

  it("asks again for an answer that is neither", () => {
    expect(checkTeamSignUp({ path: "raising", team: "both" }).fields).toEqual({ team: TEAM_MISSING });
  });

  it("keeps the people added, tidied, and drops rows left empty", () => {
    const r = checkTeamSignUp({
      path: "raising",
      team: "team",
      sharesWithOther: false,
      teamMembers: [member({ firstName: "  Ava ", email: " AVA@Example.com " }), { firstName: "", lastName: "", email: "" }, member({ firstName: "Ben", email: "ben@example.com" })],
    });
    expect(r.fields).toEqual({});
    expect(r.team).toEqual({
      isTeam: true,
      shareMode: null,
      members: [
        { firstName: "Ava", lastName: "Example", email: "ava@example.com" },
        { firstName: "Ben", lastName: "Example", email: "ben@example.com" },
      ],
    });
  });

  it("names each box of a half filled row, by its place", () => {
    const r = checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: false, teamMembers: [member(), { firstName: "Cal", lastName: "", email: "not an email" }] });
    expect(r.fields["teamMembers.1.lastName"]).toBe("Add their surname.");
    expect(r.fields["teamMembers.1.email"]).toBe("Check this email address.");
    expect(r.team).toBeNull();
  });

  it("refuses the same email twice", () => {
    const r = checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: false, teamMembers: [member(), member({ firstName: "Ava2", email: "AVA@example.com" })] });
    expect(r.fields["teamMembers.1.email"]).toBe("That email is already on the list.");
  });

  it(`takes up to ${TEAM_MEMBERS_MAX} people`, () => {
    const many = Array.from({ length: TEAM_MEMBERS_MAX + 1 }, (_, i) => member({ email: `p${i}@example.com` }));
    expect(checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: false, teamMembers: many }).fields.teamMembers).toBe(
      `You can add up to ${TEAM_MEMBERS_MAX} people here. Share the join link with anyone else.`,
    );
    expect(checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: false, teamMembers: many.slice(1) }).fields).toEqual({});
  });

  it("asks a sharing team whether the split is just the organiser's or the whole team's", () => {
    expect(checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: true }).fields).toEqual({ teamShareMode: TEAM_SHARE_MODE_MISSING });
    expect(checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: true, teamShareMode: "team" }).team?.shareMode).toBe("team");
    expect(checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: true, teamShareMode: "organiser" }).team?.shareMode).toBe("organiser");
  });

  it("never keeps a split mode for a team not sharing", () => {
    expect(checkTeamSignUp({ path: "raising", team: "team", sharesWithOther: false, teamShareMode: "team" }).team?.shareMode).toBeNull();
  });
});

// A team as the database has it.
const team = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 40,
    slug: "ej",
    path: "raising",
    kind: "santa_dash",
    kindOther: null,
    title: "Exampleton Juniors",
    description: "The under 12s, dashing in Santa suits.",
    eventDate: "2026-12-05",
    startTime: "10:00",
    venue: "Example Park",
    town: "Exampleton",
    targetPence: 200000,
    public: true,
    status: "approved",
    name: "Robin Organiser",
    firstName: "Robin",
    lastName: "Organiser",
    email: "robin@example.com",
    isTeam: true,
    teamShareMode: null,
    sharesWithOther: false,
    nbccSharePercent: null,
    otherCauseName: null,
    ...over,
  }) as FundraiserRecord;

describe("the join form", () => {
  const join = (over: Record<string, unknown> = {}) => ({ firstName: "Jack", lastName: "Sample", email: "parent@example.com", over18: true, ...over });

  it("needs a first name, surname, email and a Yes to 18 or over, nothing chosen for them", () => {
    const r = checkJoin({}, team());
    expect(Object.keys(r.fields).sort()).toEqual(["email", "firstName", "lastName", "over18"]);
    expect(r.join).toBeNull();
  });

  it("refuses a No to 18 or over with the same kind note as the sign up form", () => {
    expect(JOIN_UNDER_18).toBe(UNDER_18);
    expect(checkJoin(join({ over18: false }), team()).fields).toEqual({ over18: UNDER_18 });
  });

  it("takes an optional target and a line about why", () => {
    const r = checkJoin(join({ targetPence: 5000, why: "  For the kids at Christmas.  " }), team());
    expect(r.fields).toEqual({});
    expect(r.join).toMatchObject({ firstName: "Jack", lastName: "Sample", email: "parent@example.com", targetPence: 5000, why: "For the kids at Christmas." });
    expect(checkJoin(join({ targetPence: 500 }), team()).fields.targetPence).toBe("A target needs to be at least £10.");
  });

  it("never asks about sharing when the team is not sharing, or shares as a whole team", () => {
    expect(checkJoin(join({ sharesWithOther: true, nbccSharePercent: 40, otherCauseName: "Other Cause" }), team()).join?.split).toEqual({
      sharesWithOther: false,
      nbccSharePercent: null,
      otherCauseName: null,
    });
    const whole = team({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder", teamShareMode: "team" });
    expect(checkJoin(join({ sharesWithOther: false }), whole).join?.split).toEqual({
      sharesWithOther: true,
      nbccSharePercent: 50,
      otherCauseName: "Exampleton Food Larder",
    });
  });

  it("asks each member about sharing when it is just the organiser's split", () => {
    const own = team({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder", teamShareMode: "organiser" });
    expect(checkJoin(join(), own).fields.sharesWithOther).toBe("Tell us whether you are sharing what you raise with another cause.");
    expect(checkJoin(join({ sharesWithOther: true, nbccSharePercent: "75", otherCauseName: "Example Hospice" }), own).join?.split).toEqual({
      sharesWithOther: true,
      nbccSharePercent: 75,
      otherCauseName: "Example Hospice",
    });
    expect(checkJoin(join({ sharesWithOther: false }), own).join?.split.sharesWithOther).toBe(false);
  });

  it("treats a sharing team with no mode (only staff could leave it so) as the organiser's own", () => {
    expect(teamSplitFor(team({ sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "X", teamShareMode: null }))).toBeNull();
  });
});

describe("a member page, made from the team and the join form", () => {
  it("takes the team's kind, date, place and website choice, and the member's own name, email and target", () => {
    const s = memberSignUp(team(), {
      firstName: "Jack",
      lastName: "Sample",
      email: "parent@example.com",
      targetPence: 5000,
      why: "",
      split: { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null },
    });
    expect(s).toMatchObject({
      path: "raising",
      kind: "santa_dash",
      title: "Jack's page for Exampleton Juniors",
      description: "Jack is raising money for NBCC as part of Exampleton Juniors.",
      eventDate: "2026-12-05",
      startTime: "10:00",
      venue: "Example Park",
      town: "Exampleton",
      targetPence: 5000,
      public: true,
      name: "Jack Sample",
      firstName: "Jack",
      lastName: "Sample",
      email: "parent@example.com",
      phone: "",
      over18: true,
      sharesWithOther: false,
      socialOk: false,
      newsletterOk: false,
    });
    expect(s.wants).toEqual({ posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, shoutOut: false, attend: false });
  });

  it("uses their line about why as the story, and keeps the title within 100 characters", () => {
    const long = team({ title: "T".repeat(100) });
    const s = memberSignUp(long, { firstName: "Jack", lastName: "Sample", email: "p@example.com", targetPence: null, why: "For Christmas.", split: { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null } });
    expect(s.title.length).toBeLessThanOrEqual(100);
    expect(s.description).toBe("For Christmas.");
  });
});

describe("the team's meter", () => {
  it("adds the team's own gifts and cash to every member page's", () => {
    const own = meter({ onlinePence: 1000, cashPence: 500, targetPence: 200000, giftAidPence: 250 });
    const m = teamMeter(own, [
      meter({ onlinePence: 2000, cashPence: 0, targetPence: 5000, giftAidPence: 500 }),
      meter({ onlinePence: 0, cashPence: 1500, targetPence: null }),
    ], 200000);
    expect(m.raisedPence).toBe(5000);
    expect(m.onlinePence).toBe(3000);
    expect(m.cashPence).toBe(2000);
    expect(m.giftAidPence).toBe(750);
    expect(m.targetPence).toBe(200000);
    expect(m.percent).toBe(2);
  });
});

describe("the members on the team page", () => {
  const row = (id: number, name: string, over: Record<string, unknown> = {}) => ({
    id,
    slug: `m${id}`,
    name,
    firstName: name.split(" ")[0],
    status: "approved" as const,
    public: true,
    path: "raising" as const,
    teamLeftAt: null,
    meter: meter({ onlinePence: id * 100, cashPence: 0, targetPence: 5000 }),
    ...over,
  });

  it("lists approved and finished member pages A to Z by first name, never by money", () => {
    const list = teamMemberList([
      row(1, "zara Example"),
      row(2, "Ava Sample", { meter: meter({ onlinePence: 1, cashPence: 0, targetPence: null }) }),
      row(3, "Ben Example", { status: "finished" }),
      row(4, "Cal New", { status: "new" }),
      row(5, "Dee Gone", { teamLeftAt: "2026-10-10T10:00:00Z" }),
      row(6, "Eve Hidden", { public: false }),
    ]);
    expect(list.map((m) => m.name)).toEqual(["Ava S.", "Ben E.", "Zara E."]);
    expect(list[0]).toMatchObject({ url: "/fundraise/m2" });
    expect(list[2].meter.raisedPence).toBe(100);
  });

  it("says who is still a member: not left, and not declined", () => {
    expect(isCurrentMember({ status: "new", teamLeftAt: null })).toBe(true);
    expect(isCurrentMember({ status: "approved", teamLeftAt: null })).toBe(true);
    expect(isCurrentMember({ status: "declined", teamLeftAt: null })).toBe(false);
    expect(isCurrentMember({ status: "approved", teamLeftAt: "2026-10-10T10:00:00Z" })).toBe(false);
  });
});

describe("the join link and the message to forward", () => {
  it("is the team page's address with /join", () => {
    expect(joinUrl("https://nbcc.scot/", "ej")).toBe("https://nbcc.scot/fundraise/ej/join");
  });

  it("is ready to paste into a group chat, with the team and the link", () => {
    const msg = forwardMessage({ title: "Exampleton Juniors" }, "https://nbcc.scot/fundraise/ej/join");
    expect(msg).toContain("Exampleton Juniors");
    expect(msg).toContain("https://nbcc.scot/fundraise/ej/join");
    expect(msg).toContain("Night Before Christmas Campaign");
    expect(msg).not.toMatch(/captain/i);
    expect(msg).not.toMatch(/famil/i);
  });
});

describe("an invite, over time", () => {
  const now = new Date("2026-10-20T09:00:00Z");
  const inv = (over: Record<string, unknown> = {}) => ({
    createdAt: "2026-10-01T09:00:00Z",
    sentAt: "2026-10-14T09:00:00Z",
    remindedAt: null,
    joinedAt: null,
    deletedAt: null,
    ...over,
  });

  it("names where each is up to", () => {
    expect(inviteStatus(inv({ sentAt: null }))).toBe("held");
    expect(inviteStatus(inv())).toBe("sent");
    expect(inviteStatus(inv({ remindedAt: "2026-10-19T09:00:00Z" }))).toBe("reminded");
    expect(inviteStatus(inv({ joinedAt: "2026-10-19T09:00:00Z" }))).toBe("joined");
    expect(inviteStatus(inv({ deletedAt: "2026-10-19T09:00:00Z" }))).toBe("deleted");
    expect(inviteStatus(inv({ deletedAt: "2026-10-19T09:00:00Z", joinedAt: "2026-10-15T09:00:00Z" }))).toBe("joined");
  });

  it("is reminded once, 5 days after it was sent, while they have not joined and the event is still to come", () => {
    expect(inviteReminderDue(inv(), "2026-12-05", now)).toBe(true);
    expect(inviteReminderDue(inv({ sentAt: "2026-10-16T09:00:00Z" }), "2026-12-05", now)).toBe(false);
    expect(inviteReminderDue(inv({ remindedAt: "2026-10-19T09:00:00Z" }), "2026-12-05", now)).toBe(false);
    expect(inviteReminderDue(inv({ joinedAt: "2026-10-19T09:00:00Z" }), "2026-12-05", now)).toBe(false);
    expect(inviteReminderDue(inv({ sentAt: null }), "2026-12-05", now)).toBe(false);
    expect(inviteReminderDue(inv(), "2026-10-19", now)).toBe(false);
    expect(inviteReminderDue(inv(), null, now)).toBe(true);
  });

  it("is deleted 30 days after it was sent (or added, if never sent), or once the event is over, whichever is sooner", () => {
    expect(inviteDeleteDue(inv(), "2026-12-05", now)).toBe(false);
    expect(inviteDeleteDue(inv({ sentAt: "2026-09-20T08:00:00Z" }), "2026-12-05", now)).toBe(true);
    expect(inviteDeleteDue(inv({ sentAt: null, createdAt: "2026-09-19T09:00:00Z" }), "2026-12-05", now)).toBe(true);
    expect(inviteDeleteDue(inv(), "2026-10-19", now)).toBe(true);
    expect(inviteDeleteDue(inv(), "2026-10-20", now)).toBe(false);
    expect(inviteDeleteDue(inv({ deletedAt: "2026-10-19T09:00:00Z" }), "2026-10-01", now)).toBe(false);
  });
});

describe("the nudges to the team organiser", () => {
  const t = (over: Record<string, unknown> = {}) => ({
    isTeam: true,
    status: "approved" as const,
    approvedAt: "2026-10-10T15:00:00Z",
    eventDate: "2026-12-05",
    teamNudge1At: null,
    teamNudge2At: null,
    ...over,
  });

  it("goes on day 3 after the team page went live, while nobody has joined", () => {
    expect(teamNudgeDue(t(), 0, "2026-10-12")).toBeNull();
    expect(teamNudgeDue(t(), 0, "2026-10-13")).toBe(1);
    expect(teamNudgeDue(t(), 1, "2026-10-13")).toBeNull();
    expect(teamNudgeDue(t({ teamNudge1At: "2026-10-13T08:00:00Z" }), 0, "2026-10-14")).toBeNull();
  });

  it("goes again on day 10 only if still nobody has joined, and the first is never sent that late", () => {
    expect(teamNudgeDue(t({ teamNudge1At: "2026-10-13T08:00:00Z" }), 0, "2026-10-20")).toBe(2);
    expect(teamNudgeDue(t(), 0, "2026-10-20")).toBe(2);
    expect(teamNudgeDue(t({ teamNudge1At: "2026-10-13T08:00:00Z" }), 2, "2026-10-20")).toBeNull();
    expect(teamNudgeDue(t({ teamNudge2At: "2026-10-20T08:00:00Z" }), 0, "2026-10-21")).toBeNull();
  });

  it("catches up a missed morning or two, but not weeks later", () => {
    expect(teamNudgeDue(t(), 0, "2026-10-19")).toBe(1);
    expect(teamNudgeDue(t(), 0, "2026-10-27")).toBe(2);
    expect(teamNudgeDue(t(), 0, "2026-10-28")).toBeNull();
  });

  it("stops after the event date, and is only for an approved team", () => {
    expect(teamNudgeDue(t({ eventDate: "2026-10-12" }), 0, "2026-10-13")).toBeNull();
    expect(teamNudgeDue(t({ eventDate: "2026-10-13" }), 0, "2026-10-13")).toBe(1);
    expect(teamNudgeDue(t({ status: "finished" }), 0, "2026-10-13")).toBeNull();
    expect(teamNudgeDue(t({ isTeam: false }), 0, "2026-10-13")).toBeNull();
    expect(teamNudgeDue(t({ approvedAt: null }), 0, "2026-10-13")).toBeNull();
  });
});

describe("a handover, as staff start it", () => {
  it("takes one of the team's members", () => {
    expect(handoverSchema.safeParse({ memberId: 12 }).success).toBe(true);
  });

  it("or a new person: first name, surname, email and phone", () => {
    const ok = handoverSchema.safeParse({ firstName: "Sam", lastName: "New", email: " SAM@example.com ", phone: "07700 900123" });
    expect(ok.success && ok.data).toEqual({ firstName: "Sam", lastName: "New", email: "sam@example.com", phone: "07700 900123" });
    expect(handoverSchema.safeParse({ firstName: "Sam", lastName: "", email: "sam@example.com", phone: "07700 900123" }).success).toBe(false);
    expect(handoverSchema.safeParse({ firstName: "Sam", lastName: "New", email: "nope", phone: "07700 900123" }).success).toBe(false);
  });
});

import { hashTeamInviteToken, newTeamInviteToken, readTeamInviteToken, teamInviteUrl } from "../../src/fundraising/teams";
import { hashInviteToken } from "../../src/fundraising/invite";

describe("an invite's token", () => {
  it("is 32 random bytes, base64url, and only its hash is kept, apart from staff invites' hashes", () => {
    const t = newTeamInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newTeamInviteToken()).not.toBe(t);
    expect(hashTeamInviteToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTeamInviteToken(t)).not.toBe(hashInviteToken(t));
  });

  it("is read only in its own shape", () => {
    expect(readTeamInviteToken(" " + "a".repeat(43) + " ")).toBe("a".repeat(43));
    expect(readTeamInviteToken("a".repeat(42))).toBeNull();
    expect(readTeamInviteToken(42)).toBeNull();
  });

  it("rides on the join link", () => {
    expect(teamInviteUrl("https://nbcc.scot", "ej", "a".repeat(43))).toBe(`https://nbcc.scot/fundraise/ej/join?invite=${"a".repeat(43)}`);
  });
});

import { withTeamTotals } from "../../src/fundraising/teams";

describe("every team's total, from a list that holds its members", () => {
  const row = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    status: "approved" as const,
    targetPence: 5000,
    isTeam: false,
    teamId: null as number | null,
    teamLeftAt: null as string | null,
    meter: meter({ onlinePence: 1000, cashPence: 0, targetPence: 5000, giftAidPence: 250 }),
    ...over,
  });

  it("gives a team its own money plus every current approved or finished member's, against the team's target", () => {
    const list = withTeamTotals([
      row(40, { isTeam: true, targetPence: 200000, meter: meter({ onlinePence: 500, cashPence: 500, targetPence: 200000 }) }),
      row(41, { teamId: 40 }),
      row(42, { teamId: 40, status: "finished" }),
      row(43, { teamId: 40, status: "new" }),
      row(44, { teamId: 40, teamLeftAt: "2026-10-10T10:00:00Z" }),
      row(50),
    ]);
    expect(list[0].meter.raisedPence).toBe(3000);
    expect(list[0].meter.giftAidPence).toBe(500);
    expect(list[0].meter.targetPence).toBe(200000);
    // Members and everyone else keep their own.
    expect(list.slice(1).map((f) => f.meter.raisedPence)).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it("leaves a list with no team exactly as it was", () => {
    const list = [row(50)];
    expect(withTeamTotals(list)).toEqual(list);
  });
});

import { TEAM_ALWAYS_PUBLIC } from "../../src/fundraising/teams";

describe("a team is always on the website (review)", () => {
  it("refuses a team kept off the website, plainly", () => {
    expect(TEAM_ALWAYS_PUBLIC).toBe("A team page is always on our website, so people can find it and join. Choose Just me to keep yours off it.");
    expect(checkTeamSignUp({ path: "raising", team: "team", public: false, sharesWithOther: false }).fields).toEqual({ public: TEAM_ALWAYS_PUBLIC });
    expect(checkTeamSignUp({ path: "raising", team: "team", public: true, sharesWithOther: false }).fields).toEqual({});
    expect(checkTeamSignUp({ path: "raising", team: "me", public: false }).fields).toEqual({});
  });
});
