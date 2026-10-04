import { describe, it, expect, vi, beforeEach } from "vitest";

// Team pages (Jaimie, 2026-10-03): approving a team sends the team's own "your team page is live"
// (with the join link) and the held invites, never the ordinary "your page is live". Every other
// approval is unchanged. Invented names only.

const mail = vi.hoisted(() => ({ sendFundraiseApproved: vi.fn(), sendFundraiseThanks: vi.fn(), sendFundraiseStaff: vi.fn() }));
const team = vi.hoisted(() => ({ sendTeamApproved: vi.fn(), sendTeamMemberJoined: vi.fn() }));
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/fundraising/team-send", () => team);
vi.mock("../../src/db/fundraisers", () => ({ claimNextWaitingLiveEmail: vi.fn(), markLiveEmailWaiting: vi.fn(), fundraisingIsOn: vi.fn() }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" } }));

import { sendApprovedEmail, sendSignUpEmails } from "../../src/fundraising/send";
import type { FundraiserRecord } from "../../src/fundraising/model";

const record = (over: Partial<FundraiserRecord> = {}) =>
  ({ id: 40, slug: "ej", path: "raising", kind: "walk", title: "Exampleton Juniors", public: true, status: "approved", name: "Robin Organiser", email: "robin@example.com", ...over }) as FundraiserRecord;

beforeEach(() => {
  for (const fn of Object.values(mail)) fn.mockReset().mockResolvedValue(undefined);
  team.sendTeamApproved.mockReset().mockResolvedValue({ invited: 2, failed: 0, skipped: 0, liveSent: true });
  team.sendTeamMemberJoined.mockReset().mockResolvedValue("sent");
});

// Jaimie, 2026-10-04: when staff approve a new team member's page, the team organiser is told
// ("[First name] has joined [team name]"). Its guards (the wording's sign off, the switches, never
// about themselves, never in memory) are the sender's: test/unit/fundraising-team-member-joined.test.ts.
describe("approving a team member's page", () => {
  it("sends the member their own email, then tells the team organiser", async () => {
    const member = record({ id: 41, slug: "ava", title: "Ava's page", name: "Ava Example", email: "ava@example.com", teamId: 40 });
    expect(await sendApprovedEmail(member)).toBe(true);
    expect(mail.sendFundraiseApproved).toHaveBeenCalledTimes(1);
    expect(mail.sendFundraiseApproved.mock.calls[0][1].email).toBe("ava@example.com");
    expect(team.sendTeamMemberJoined).toHaveBeenCalledTimes(1);
    expect(team.sendTeamMemberJoined).toHaveBeenCalledWith(expect.objectContaining({ id: 41, teamId: 40 }));
    expect(team.sendTeamApproved).not.toHaveBeenCalled();
  });

  // A member whose own email failed is tried again at the next switch on: the team organiser is told
  // once, when it goes.
  it("does not tell the team organiser when the member's own email did not go", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mail.sendFundraiseApproved.mockRejectedValue(new Error("mail down"));
    expect(await sendApprovedEmail(record({ id: 41, teamId: 40 }))).toBe(false);
    expect(team.sendTeamMemberJoined).not.toHaveBeenCalled();
  });

  it("still says the member's email went when telling the team organiser throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    team.sendTeamMemberJoined.mockRejectedValue(new Error("boom"));
    expect(await sendApprovedEmail(record({ id: 41, teamId: 40 }))).toBe(true);
  });

  // Approved, declined, approved again: the member still hears their page is live, but the team
  // organiser was told the first time and is not told again.
  it("does not tell the team organiser again when the page is approved a second time", async () => {
    const member = record({ id: 41, slug: "ava", title: "Ava's page", name: "Ava Example", email: "ava@example.com", teamId: 40 });
    expect(await sendApprovedEmail(member, { reapproved: false })).toBe(true);
    expect(team.sendTeamMemberJoined).toHaveBeenCalledTimes(1);
    expect(await sendApprovedEmail(member, { reapproved: true })).toBe(true);
    expect(mail.sendFundraiseApproved).toHaveBeenCalledTimes(2);
    expect(team.sendTeamMemberJoined).toHaveBeenCalledTimes(1);
  });

  it("tells nobody for a page that is on no team", async () => {
    await sendApprovedEmail(record());
    expect(team.sendTeamMemberJoined).not.toHaveBeenCalled();
  });
});

describe("approving a team", () => {
  it("goes the team's way: its invites and its own live email", async () => {
    expect(await sendApprovedEmail(record({ isTeam: true }))).toBe(true);
    expect(team.sendTeamApproved).toHaveBeenCalledWith(expect.objectContaining({ id: 40, isTeam: true }));
    expect(mail.sendFundraiseApproved).not.toHaveBeenCalled();
  });

  it("is false when the team live email did not go", async () => {
    team.sendTeamApproved.mockResolvedValue({ invited: 0, failed: 0, skipped: 0, liveSent: false });
    expect(await sendApprovedEmail(record({ isTeam: true }))).toBe(false);
  });

  it("leaves every other approval as it was", async () => {
    await sendApprovedEmail(record());
    expect(team.sendTeamApproved).not.toHaveBeenCalled();
    expect(mail.sendFundraiseApproved).toHaveBeenCalled();
  });
});

describe("a team's sign up, to the events inbox", () => {
  const full = record({
    status: "new",
    description: "Dashing.",
    eventDate: "2026-12-05",
    startTime: null,
    venue: "",
    town: "Exampleton",
    targetPence: 200000,
    phone: "07700 900111",
    socialLink: null,
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    newsletterOk: false,
    over18: true,
    sharesWithOther: true,
    nbccSharePercent: 50,
    otherCauseName: "Exampleton Food Larder",
    isTeam: true,
    teamShareMode: "team",
  });

  it("says it is a team, whose split it is, and who is held to be invited once approved", async () => {
    await sendSignUpEmails(full, {
      isTeam: true,
      shareMode: "team",
      members: [
        { firstName: "Ava", lastName: "Example", email: "ava@example.com" },
        { firstName: "Jack", lastName: "Sample", email: "parent@example.com" },
      ],
    });
    const staff = mail.sendFundraiseStaff.mock.calls[0][1];
    expect(staff.text).toContain("A team: Yes. Robin Organiser is the team organiser");
    expect(staff.text).toContain("Whose split: The whole team's: every member page shares the same way");
    // Review: only how many, never their names or emails (they are in the admin, and deleted on time).
    expect(staff.text).toContain("People to invite: 2 people to invite once you approve it: see Admin > Get involved > Sign ups");
    expect(staff.text + staff.html).not.toMatch(/ava@example\.com|parent@example\.com|Ava Example|Jack Sample/);
    expect(staff.text).not.toMatch(/captain/i);
  });

  it("says nobody was added, when nobody was", async () => {
    await sendSignUpEmails(full, { isTeam: true, shareMode: "organiser", members: [] });
    const staff = mail.sendFundraiseStaff.mock.calls[0][1];
    expect(staff.text).toContain("Whose split: Just the team organiser's: each member is asked when they join");
    expect(staff.text).toContain("People to invite: Nobody added. They can share the join link.");
  });
});
