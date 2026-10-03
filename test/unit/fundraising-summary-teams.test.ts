import { describe, it, expect } from "vitest";
import { summaryCounts, summaryLines, type SummaryFundraiser } from "../../src/fundraising/summary";
import { meter } from "../../src/fundraising/model";

// Team pages (Jaimie, 2026-10-03): the Monday summary says how many team member sign ups are waiting
// for staff, and which teams have had nobody join 10 days after going live. Monday 7 December 2026
// at 8am, as in fundraising-summary.test.ts. Every name here is invented.

const NOW = new Date("2026-12-07T08:00:00Z");

const rec = (id: number, over: Partial<SummaryFundraiser> = {}): SummaryFundraiser =>
  ({
    id, slug: `t${id}`, path: "raising", kind: "other", title: `Test ${id}`, description: "", eventDate: null, startTime: null,
    venue: "", town: "", targetPence: null, public: true, status: "approved", name: "Robin Example", email: "robin@example.com",
    phone: "", socialLink: null, socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z", approvedAt: "2026-10-02T10:00:00.000Z", approvedBy: null,
    updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null,
    venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null,
    creditName: null, finishedRequestedAt: null, offListAt: null, meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }),
    editWaiting: false, ...over,
  }) as SummaryFundraiser;

const inputs = (fundraisers: SummaryFundraiser[]) => ({ now: NOW, fundraisers, gifts: [], cash: [], calls: [], invites: [] });

describe("teams in the Monday summary", () => {
  const list = [
    rec(1, { title: "Exampleton Juniors", isTeam: true, approvedAt: "2026-11-20T10:00:00.000Z" }),
    rec(2, { status: "new", teamId: 1, title: "Ava's page for Exampleton Juniors" }),
    rec(3, { status: "new", teamId: 1, title: "Ben's page for Exampleton Juniors" }),
    rec(4, { title: "Quiet Team", isTeam: true, approvedAt: "2026-11-20T10:00:00.000Z" }),
    rec(5, { title: "Too New Team", isTeam: true, approvedAt: "2026-12-01T10:00:00.000Z" }),
    rec(6, { title: "Gone Team", isTeam: true, approvedAt: "2026-11-10T10:00:00.000Z" }),
    rec(7, { status: "approved", teamId: 6, teamLeftAt: "2026-11-10T10:00:00.000Z" }),
    rec(8, { status: "new", title: "Solo Walk" }),
  ];

  it("counts member sign ups waiting apart from the other sign ups", () => {
    const c = summaryCounts(inputs(list));
    expect(c.teamMembersToApprove).toBe(2);
    expect(c.toApprove).toBe(1);
  });

  it("lists teams 10 days live with nobody joined (someone taken off does not count)", () => {
    const c = summaryCounts(inputs(list));
    expect(c.teamsNobodyJoined).toEqual(["Gone Team", "Quiet Team"]);
  });

  it("says both, and counts them as waiting", () => {
    const c = summaryCounts(inputs(list));
    const lines = summaryLines(c);
    expect(lines.waiting).toContain("2 team member sign ups to approve");
    expect(lines.waiting).toContain("2 teams with nobody joined after 10 days: Gone Team and Quiet Team");
    expect(c.waiting).toBeGreaterThanOrEqual(1 + 2 + 2);
    const one = summaryLines(summaryCounts(inputs([rec(1, { status: "new", teamId: 9 }), rec(9, { isTeam: true, approvedAt: "2026-11-20T10:00:00.000Z" })])));
    expect(one.waiting).toContain("1 team member sign up to approve");
    expect(one.waiting.some((l) => l.startsWith("1 team with nobody joined"))).toBe(false);
  });

  it("says nothing about teams when there are none", () => {
    const lines = summaryLines(summaryCounts(inputs([rec(8, { status: "new" })])));
    expect(lines.waiting.join(" ")).not.toMatch(/team/i);
  });
});

describe("teams with nobody joined, only while it can still help (review)", () => {
  it("is listed from day 10 to day 30 after going live, and never after the event", () => {
    const c = summaryCounts(
      inputs([
        rec(1, { title: "Day 17", isTeam: true, approvedAt: "2026-11-20T10:00:00.000Z" }),
        rec(2, { title: "Day 31", isTeam: true, approvedAt: "2026-11-06T10:00:00.000Z" }),
        rec(3, { title: "Day 30", isTeam: true, approvedAt: "2026-11-07T10:00:00.000Z" }),
        rec(4, { title: "Event over", isTeam: true, approvedAt: "2026-11-20T10:00:00.000Z", eventDate: "2026-12-06" }),
        rec(5, { title: "Event today", isTeam: true, approvedAt: "2026-11-20T10:00:00.000Z", eventDate: "2026-12-07" }),
      ]),
    );
    expect(c.teamsNobodyJoined).toEqual(["Day 17", "Day 30", "Event today"]);
  });
});
