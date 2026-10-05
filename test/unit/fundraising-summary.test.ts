import { describe, it, expect } from "vitest";
import {
  SUMMARY_MAX_RECIPIENTS,
  lastWeek,
  summaryCounts,
  summaryDue,
  summaryLines,
  summaryRecipientsSchema,
  isSummaryAddress,
  summaryOutsiderAdded,
  SUMMARY_DOMAIN_REFUSAL,
  type SummaryFundraiser,
  type SummaryInputs,
} from "../../src/fundraising/summary";
import { meter } from "../../src/fundraising/model";

// TASK-503: the Monday summary to the people chosen in Admin > Fundraising. Every count is worked
// out by the pure summaryCounts from rows the runner reads, so each is tested here against a fixed
// clock: Monday 7 December 2026 at 8am. "Last week" is Monday 30 November to Sunday 6 December, as
// UK days. Every name, place and amount is invented.

const NOW = new Date("2026-12-07T08:00:00Z");

function rec(id: number, over: Partial<SummaryFundraiser> = {}): SummaryFundraiser {
  return {
    id,
    slug: `test-${id}`,
    path: "raising",
    kind: "other",
    title: `Test ${id}`,
    description: "",
    eventDate: null,
    startTime: null,
    venue: "",
    town: "",
    targetPence: null,
    public: true,
    status: "approved",
    name: "Robin Example",
    email: "robin@example.com",
    phone: "07700 900123",
    socialLink: null,
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null,
    postLine1: null,
    postLine2: null,
    postTown: null,
    postPostcode: null,
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    updatedBy: null,
    cardLine: null,
    endTime: null,
    timeTbc: false,
    venueAddress: null,
    venuePostcode: null,
    access: [],
    price: null,
    booking: null,
    ticketUrl: null,
    ageLimit: null,
    dressCode: null,
    included: null,
    creditName: null,
    finishedRequestedAt: null,
    offListAt: null,
    meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }),
    editWaiting: false,
    ...over,
  };
}

const wants = (w: Partial<SummaryFundraiser["wants"]>): SummaryFundraiser["wants"] => ({
  posterCount: 0,
  leafletCount: 0,
  bucketCount: 0,
  tinCount: 0,
  leaflets: 0,
  buckets: 0,
  shoutOut: false,
  attend: false,
  ...w,
});

const fundraisers: SummaryFundraiser[] = [
  rec(1, {
    title: "Sam's Santa Dash",
    town: "Perth",
    eventDate: "2026-12-12",
    // TASK-505: a shout out counts only with their permission to post.
    socialOk: true,
    wants: wants({ posterCount: 10, leafletCount: 50, shoutOut: true }),
    meter: meter({ onlinePence: 5000, cashPence: 1000, targetPence: 50000 }),
  }),
  rec(2, {
    status: "new",
    path: "event",
    title: "Coffee morning at St Example's",
    town: "Ayr",
    eventDate: "2026-12-20",
    createdAt: "2026-12-02T10:00:00.000Z",
    wants: wants({ bucketCount: 2, attend: true }),
  }),
  rec(3, {
    title: "Quiz night",
    town: "Ayr",
    eventDate: "2026-11-01",
    editWaiting: true,
    wants: wants({ leaflets: 5, buckets: 1 }),
  }),
  rec(4, { title: "Fern's Fun Run", finishedRequestedAt: "2026-12-05T10:00:00.000Z", wants: wants({ tinCount: 1 }) }),
  rec(5, { status: "declined", path: "event", title: "Carol singing", createdAt: "2026-12-06T23:30:00.000Z" }),
  rec(6, { status: "new", title: "Late one", createdAt: "2026-12-07T00:10:00.000Z" }),
  rec(7, { path: "event", title: "Christmas fair", town: "Troon", eventDate: "2027-01-03", wants: wants({ leaflets: 3 }) }),
  rec(8, { title: "New year walk", eventDate: "2027-01-04", wants: wants({ buckets: 1 }) }),
  rec(9, { title: "Taken off", eventDate: "2026-10-01", offListAt: "2026-11-02T10:00:00.000Z" }),
  rec(10, { status: "finished", title: "All done", meter: meter({ onlinePence: 0, cashPence: 2000, targetPence: null }) }),
];

const inputs: SummaryInputs = {
  now: NOW,
  fundraisers,
  gifts: [
    { fundraiserId: 1, amountPence: 2000, refundedPence: 0, giftAid: true, paidIn: false, paidAt: "2026-12-01T10:00:00.000Z" },
    { fundraiserId: 1, amountPence: 1000, refundedPence: 500, giftAid: false, paidIn: false, paidAt: "2026-12-06T23:59:00.000Z" },
    { fundraiserId: 1, amountPence: 3000, refundedPence: 0, giftAid: false, paidIn: true, paidAt: "2026-12-03T10:00:00.000Z" },
    // The Sunday before last week, and this Monday: neither counts.
    { fundraiserId: 1, amountPence: 4000, refundedPence: 0, giftAid: true, paidIn: false, paidAt: "2026-11-29T23:30:00.000Z" },
    { fundraiserId: 1, amountPence: 1000, refundedPence: 0, giftAid: true, paidIn: false, paidAt: "2026-12-07T00:30:00.000Z" },
    { fundraiserId: 3, amountPence: 800, refundedPence: 0, giftAid: true, paidIn: false, paidAt: "2026-11-30T00:00:00.000Z" },
  ],
  cash: [
    { fundraiserId: 1, amountPence: 1000, recordedAt: "2026-12-02T15:00:00.000Z" },
    { fundraiserId: 10, amountPence: 2000, recordedAt: "2026-11-29T15:00:00.000Z" },
    { fundraiserId: 3, amountPence: 250, recordedAt: "2026-12-06T15:00:00.000Z" },
  ],
  calls: [{ fundraiserId: 9, which: "after", calledAt: "2026-10-09T10:00:00.000Z", calledBy: "fern@example.com", note: null }],
  invites: [
    { name: "Alex Example", signedBy: "Fern", createdAt: "2026-11-29T10:00:00.000Z", resentAt: null },
    { name: "Robin Test", signedBy: "Rowan", createdAt: "2026-12-01T10:00:00.000Z", resentAt: null },
    { name: "Sky Sample", signedBy: "Fern", createdAt: "2026-11-01T10:00:00.000Z", resentAt: "2026-12-03T10:00:00.000Z" },
    // Sent more than 60 days ago and never resent: its link no longer works, so it is not counted.
    { name: "Jo Oldfriend", signedBy: "Rowan", createdAt: "2026-10-01T10:00:00.000Z", resentAt: null },
  ],
};

describe("last week", () => {
  it("is the Monday to Sunday before this one, as UK days", () => {
    expect(lastWeek(NOW)).toEqual({ from: "2026-11-30", to: "2026-12-06" });
    // A test sent on a Wednesday covers the same full week.
    expect(lastWeek(new Date("2026-12-09T15:00:00Z"))).toEqual({ from: "2026-11-30", to: "2026-12-06" });
    // Just after midnight on a summer Monday in the UK, still Sunday in UTC.
    expect(lastWeek(new Date("2026-06-07T23:30:00Z"))).toEqual({ from: "2026-06-01", to: "2026-06-07" });
  });
});

describe("the money", () => {
  const c = summaryCounts(inputs);

  it("counts online gifts made last week, less refunds", () => {
    expect(c.onlinePence).toBe(2000 + 500 + 800);
  });

  it("counts what organisers paid in last week", () => {
    expect(c.paidInPence).toBe(3000);
  });

  it("counts the cash staff recorded last week, by when they recorded it", () => {
    expect(c.cashPence).toBe(1250);
  });

  it("works out the Gift Aid to claim on last week's gifts, never on money paid in", () => {
    expect(c.giftAidPence).toBe(Math.floor(2000 / 4) + Math.floor(800 / 4));
  });

  it("rounds the Gift Aid down on each gift, as the meter does, not on the week's total", () => {
    const odd = summaryCounts({
      ...inputs,
      gifts: [
        { fundraiserId: 1, amountPence: 2001, refundedPence: 0, giftAid: true, paidIn: false, paidAt: "2026-12-01T10:00:00.000Z" },
        { fundraiserId: 1, amountPence: 2104, refundedPence: 101, giftAid: true, paidIn: false, paidAt: "2026-12-02T10:00:00.000Z" },
      ],
    });
    // 500 + 500, where a quarter of the total (4004) would be 1001.
    expect(odd.giftAidPence).toBe(1000);
  });

  it("counts a Direct Debit gift in the week it was paid, not the week it was made", () => {
    // Made on a Friday, paid the next Tuesday, across the Monday the summary goes.
    const dd = { fundraiserId: 1, amountPence: 1500, refundedPence: 0, giftAid: true, paidIn: false, paidAt: "2026-12-08T09:00:00.000Z" };
    const thisMonday = summaryCounts({ ...inputs, gifts: [dd] });
    const nextMonday = summaryCounts({ ...inputs, now: new Date("2026-12-14T08:00:00Z"), gifts: [dd] });
    expect(thisMonday.onlinePence).toBe(0);
    expect(nextMonday.onlinePence).toBe(1500);
    expect(nextMonday.giftAidPence).toBe(375);
  });

  it("counts cash staff entered after Monday's summary went in the next one, whatever day it was paid in", () => {
    // Paid in on the Saturday, but only typed in at 10am on Monday, after the 8am summary.
    const late = { fundraiserId: 1, amountPence: 900, recordedAt: "2026-12-07T10:00:00.000Z" };
    expect(summaryCounts({ ...inputs, cash: [late] }).cashPence).toBe(0);
    expect(summaryCounts({ ...inputs, now: new Date("2026-12-14T08:00:00Z"), cash: [late] }).cashPence).toBe(900);
  });

  it("counts every pound in exactly one Monday's summary", () => {
    const gifts = [
      { fundraiserId: 1, amountPence: 1000, refundedPence: 0, giftAid: false, paidIn: false, paidAt: "2026-12-06T23:59:59.000Z" },
      { fundraiserId: 1, amountPence: 2000, refundedPence: 0, giftAid: false, paidIn: false, paidAt: "2026-12-07T00:00:01.000Z" },
      { fundraiserId: 1, amountPence: 4000, refundedPence: 0, giftAid: false, paidIn: false, paidAt: "2026-12-07T07:59:00.000Z" },
    ];
    const cash = [{ fundraiserId: 1, amountPence: 300, recordedAt: "2026-12-07T08:30:00.000Z" }];
    const mondays = ["2026-12-07T08:00:00Z", "2026-12-14T08:00:00Z", "2026-12-21T08:00:00Z"];
    const total = mondays
      .map((m) => summaryCounts({ ...inputs, now: new Date(m), gifts, cash }))
      .reduce((s, c) => s + c.onlinePence + c.cashPence, 0);
    expect(total).toBe(1000 + 2000 + 4000 + 300);
  });

  it("adds them up, without the Gift Aid", () => {
    expect(c.raisedPence).toBe(3300 + 3000 + 1250);
  });

  it("says how many are live, and what every fundraiser has raised", () => {
    expect(c.liveCount).toBe(6);
    expect(c.totalRaisedPence).toBe(8000);
  });
});

describe("new sign ups", () => {
  it("lists those that arrived last week, oldest first", () => {
    expect(summaryCounts(inputs).newSignUps.map((s) => s.title)).toEqual(["Coffee morning at St Example's", "Carol singing"]);
  });
});

describe("waiting on us", () => {
  const c = summaryCounts(inputs);

  it("counts sign ups to approve and changes to check", () => {
    expect(c.toApprove).toBe(2);
    expect(c.changesToCheck).toBe(1);
  });

  it("adds up what is to be sent, from the split requests and the old combined ones, leaving out anything past its date", () => {
    expect(c.materials).toEqual({ posters: 10, leaflets: 50, buckets: 2, tins: 1, leafletsOrPosters: 3, bucketsOrTins: 1, qrCodes: 0 });
    expect(c.materialsFundraisers).toBe(5);
  });

  it("counts shout outs and requests for someone to come along, with their dates", () => {
    expect(c.shoutOuts).toBe(1);
    expect(c.attend).toEqual(["2026-12-20"]);
  });

  it("leaves out a shout out they gave no permission for: there is nothing staff can do", () => {
    const without = summaryCounts({ ...inputs, fundraisers: fundraisers.map((f) => (f.id === 1 ? { ...f, socialOk: false } : f)) });
    expect(without.shoutOuts).toBe(0);
  });

  it("counts the calls due today", () => {
    expect(c.callsDue).toBe(2);
  });

  it("lists invites not taken up a week after they were sent, with who invited them", () => {
    expect(c.invitesNotTaken).toEqual([{ name: "Alex", signedBy: "Fern" }]);
  });

  // Jaimie 2026-10-03: the first name staff typed in its own box, whole; the first word of the one
  // name only for an invite sent before the two boxes.
  it("names an invite not taken up by the first name staff typed", () => {
    const old = { signedBy: "Fern", createdAt: "2026-11-29T10:00:00.000Z", resentAt: null };
    const c = summaryCounts({
      ...inputs,
      invites: [
        { ...old, name: "Mary Jane Smith", firstName: "Mary Jane" },
        { ...old, name: "Alex Example", firstName: null, createdAt: "2026-11-29T11:00:00.000Z" },
      ],
    });
    expect(c.invitesNotTaken).toEqual([
      { name: "Mary Jane", signedBy: "Fern" },
      { name: "Alex", signedBy: "Fern" },
    ]);
  });

  // Invite types (Jaimie, B1 + I1): the summary says what each was invited to do.
  it("says what each invite not taken up was for, and nothing for one from before", () => {
    const old = { signedBy: "Fern", createdAt: "2026-11-29T10:00:00.000Z", resentAt: null };
    const typed = summaryCounts({
      ...inputs,
      invites: [
        { ...old, name: "Mary Sample", firstName: "Mary", type: "memory" },
        { ...old, name: "Sky Sample", firstName: "Sky", type: "team", createdAt: "2026-11-29T11:00:00.000Z" },
        { ...old, name: "Jo Sample", firstName: "Jo", type: "event", createdAt: "2026-11-29T12:00:00.000Z" },
        { ...old, name: "Robin Sample", firstName: "Robin", type: "raising", createdAt: "2026-11-29T13:00:00.000Z" },
        { ...old, name: "Alex Example", firstName: "Alex", type: null, createdAt: "2026-11-29T14:00:00.000Z" },
      ],
    });
    expect(typed.invitesNotTaken).toEqual([
      { name: "Mary", signedBy: "Fern", type: "memory" },
      { name: "Sky", signedBy: "Fern", type: "team" },
      { name: "Jo", signedBy: "Fern", type: "event" },
      { name: "Robin", signedBy: "Fern", type: "raising" },
      { name: "Alex", signedBy: "Fern" },
    ]);
    expect(summaryLines(typed).waiting).toContain(
      "5 invites not taken up after a week: Mary (in memory); Sky (a team), invited by Fern; Jo (hosting an event), invited by Fern; Robin (raising money), invited by Fern; Alex, invited by Fern",
    );
  });

  it("leaves out an invite whose link has expired, 60 days after it was last sent", () => {
    const only = (resentAt: string | null, createdAt: string) =>
      summaryCounts({ ...inputs, invites: [{ name: "Jo Oldfriend", signedBy: "Rowan", createdAt, resentAt }] }).invitesNotTaken;
    expect(only(null, "2026-10-01T10:00:00.000Z")).toEqual([]);
    // 59 days: still works, still waiting.
    expect(only(null, "2026-10-09T10:00:00.000Z")).toEqual([{ name: "Jo", signedBy: "Rowan" }]);
    // Resent since: a new link, counted again.
    expect(only("2026-11-20T10:00:00.000Z", "2026-09-01T10:00:00.000Z")).toEqual([{ name: "Jo", signedBy: "Rowan" }]);
  });

  it("counts fundraisers four weeks past their date still on Get involved, and those who say they've finished", () => {
    expect(c.pastDate).toBe(1);
    expect(c.saysFinished).toBe(1);
  });

  it("adds up the things waiting", () => {
    expect(c.waiting).toBe(2 + 1 + 5 + 1 + 1 + 2 + 1 + 1 + 1);
  });
});

// TASK-505: requests tracked to done. Waiting on us counts only what is still to send or do, and
// every bucket or tin not back yet, with how many are due back (two weeks after the date, or four
// weeks after they went out when there is none).
describe("requests tracked to done", () => {
  const req = (fundraiserId: number, kind: string, status: string, over: Record<string, unknown> = {}) => ({
    fundraiserId,
    kind,
    status,
    quantity: null,
    quantityBack: null,
    how: null,
    sentOn: null,
    backOn: null,
    doneOn: null,
    handledBy: null,
    going: null,
    note: null,
    backNote: null,
    link: null,
    updatedAt: null,
    updatedBy: null,
    ...over,
  }) as NonNullable<SummaryInputs["requests"]>[number];
  const tracked: SummaryInputs = {
    ...inputs,
    requests: [
      req(1, "posters", "sent", { quantity: 10, how: "post", sentOn: "2026-12-03" }),
      req(1, "shout_out", "done", { doneOn: "2026-12-02" }),
      // Not due back until two weeks after 20 December.
      req(2, "buckets", "with_them", { quantity: 2, sentOn: "2026-12-05" }),
      req(2, "attend", "arranged", { going: "Rowan" }),
      // Its date was 1 November: due back on 15 November.
      req(3, "buckets_or_tins", "with_them", { quantity: 1, sentOn: "2026-10-25" }),
    ],
  };
  const c = summaryCounts(tracked);

  it("counts only what is still to send", () => {
    expect(c.materials).toEqual({ posters: 0, leaflets: 50, buckets: 0, tins: 1, leafletsOrPosters: 3, bucketsOrTins: 1, qrCodes: 0 });
    expect(c.materialsFundraisers).toBe(4);
  });

  it("counts only shout outs still to do and someone to come along still to arrange", () => {
    expect(c.shoutOuts).toBe(0);
    expect(c.attend).toEqual([]);
  });

  it("counts every bucket or tin not back yet, and those due back", () => {
    expect(c.notBack).toBe(3);
    expect(c.notBackDue).toBe(1);
  });

  it("adds each one due back to the things waiting", () => {
    expect(c.waiting).toBe(2 + 1 + 4 + 0 + 0 + 2 + 1 + 1 + 1 + 1);
  });

  it("says so in the summary's words", () => {
    expect(summaryLines(c).waiting).toEqual([
      "2 sign ups to approve",
      "1 change to check",
      "Leaflets (50) and leaflets or posters (3) to post",
      "1 collection tin and 1 bucket or tin to send",
      "3 buckets or tins still out (1 due back)",
      "2 calls due",
      "1 invite not taken up after a week: Alex, invited by Fern",
      "1 fundraiser 4 weeks past its date: take it off Get involved?",
      "1 fundraiser says they've finished",
    ]);
  });

  it("says how many are not back without a due count when none is due yet", () => {
    const later = summaryCounts({ ...tracked, requests: tracked.requests!.filter((r) => r.kind !== "buckets_or_tins") });
    expect(later.notBackDue).toBe(0);
    expect(summaryLines(later).waiting).toContain("2 buckets or tins still out, none due back yet");
  });

  it("says one bucket or tin still out in the singular", () => {
    const one = summaryCounts({ ...tracked, requests: tracked.requests!.filter((r) => r.kind === "buckets_or_tins") });
    expect(summaryLines(one).waiting).toContain("1 bucket or tin still out (1 due back)");
  });

  it("leaves the count as it was for sign ups nobody has acted on yet", () => {
    expect(summaryCounts({ ...inputs, requests: [] })).toEqual(summaryCounts(inputs));
  });
});

describe("coming up", () => {
  it("lists approved fundraisers in the next four weeks, by date", () => {
    expect(summaryCounts(inputs).comingUp).toEqual([
      { date: "2026-12-12", title: "Sam's Santa Dash", town: "Perth" },
      { date: "2027-01-03", title: "Christmas fair", town: "Troon" },
    ]);
  });
});

describe("the words", () => {
  const l = summaryLines(summaryCounts(inputs));

  it("has a subject with the money and the number of things waiting", () => {
    expect(l.subject).toBe("Fundraising this week: £75.50 raised, 15 things waiting");
  });

  it("says the money in a sentence", () => {
    expect(l.headline).toBe("£75.50 raised");
    expect(l.money).toBe("£33 online and £42.50 paid in, plus £7 Gift Aid to claim. 6 fundraisers live, £80 raised in total.");
  });

  it("lists the new sign ups", () => {
    expect(l.newSignUps).toEqual(["Coffee morning at St Example's, holding an event, Ayr", "Carol singing, holding an event"]);
  });

  it("lists what is waiting", () => {
    expect(l.waiting).toEqual([
      "2 sign ups to approve",
      "1 change to check",
      "Posters (10), leaflets (50) and leaflets or posters (3) to post",
      "2 collection buckets, 1 collection tin and 1 bucket or tin to send",
      "1 social media shout out",
      "1 request for someone to come along, on 20th December",
      "2 calls due",
      "1 invite not taken up after a week: Alex, invited by Fern",
      "1 fundraiser 4 weeks past its date: take it off Get involved?",
      "1 fundraiser says they've finished",
    ]);
  });

  it("lists what is coming up", () => {
    expect(l.comingUp).toEqual(["Saturday 12th December: Sam's Santa Dash, Perth", "Sunday 3rd January: Christmas fair, Troon"]);
  });

  it("reads well on a quiet week", () => {
    const quiet = summaryLines(summaryCounts({ now: NOW, fundraisers: [], gifts: [], cash: [], calls: [], invites: [] }));
    expect(quiet.subject).toBe("Fundraising this week: £0 raised, nothing waiting");
    expect(quiet.money).toBe("£0 online and £0 paid in. 0 fundraisers live, £0 raised in total.");
    expect(quiet.newSignUps).toEqual([]);
    expect(quiet.waiting).toEqual([]);
    expect(quiet.comingUp).toEqual([]);
  });

  it("matches the approved example's words for the same numbers", () => {
    const one = summaryLines({
      ...summaryCounts({ now: NOW, fundraisers: [], gifts: [], cash: [], calls: [], invites: [] }),
      onlinePence: 105000,
      paidInPence: 19000,
      giftAidPence: 21000,
      raisedPence: 124000,
      liveCount: 14,
      totalRaisedPence: 893000,
      materials: { posters: 10, leaflets: 50, buckets: 0, tins: 0, leafletsOrPosters: 0, bucketsOrTins: 0 },
      attend: ["2026-12-06"],
      waiting: 1,
    });
    expect(one.subject).toBe("Fundraising this week: £1,240 raised, 1 thing waiting");
    expect(one.money).toBe("£1,050 online and £190 paid in, plus £210 Gift Aid to claim. 14 fundraisers live, £8,930 raised in total.");
    expect(one.waiting).toContain("Posters (10) and leaflets (50) to post");
    expect(one.waiting).toContain("1 request for someone to come along, on 6th December");
  });
});

describe("when it goes", () => {
  it("goes on a Monday in the UK, once that week", () => {
    expect(summaryDue(NOW, null)).toEqual({ due: true, week: "2026-12-07" });
    expect(summaryDue(NOW, "2026-11-30")).toEqual({ due: true, week: "2026-12-07" });
    expect(summaryDue(NOW, "2026-12-07")).toEqual({ due: false, week: "2026-12-07" });
  });

  it("never goes on any other day", () => {
    for (const day of ["2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"]) {
      expect(summaryDue(new Date(`${day}T08:00:00Z`), null).due).toBe(false);
    }
  });

  it("goes on a Monday in British Summer Time, when 8am is 7am UTC", () => {
    expect(summaryDue(new Date("2026-03-30T07:00:00Z"), "2026-03-23")).toEqual({ due: true, week: "2026-03-30" });
    // Sunday evening in UTC, already Monday in the UK.
    expect(summaryDue(new Date("2026-06-07T23:30:00Z"), null)).toEqual({ due: true, week: "2026-06-08" });
  });
});

describe("who it goes to", () => {
  it("is a tidy list of addresses, each once, in order", () => {
    const parsed = summaryRecipientsSchema.safeParse([" Rowan@Example.com", "fern@example.com"]);
    expect(parsed.success && parsed.data).toEqual(["fern@example.com", "rowan@example.com"]);
  });

  it("refuses an address twice, one that is not whole, or more than ten", () => {
    expect(SUMMARY_MAX_RECIPIENTS).toBe(10);
    expect(summaryRecipientsSchema.safeParse(["fern@example.com", "FERN@example.com"]).success).toBe(false);
    expect(summaryRecipientsSchema.safeParse(["fern@"]).success).toBe(false);
    expect(summaryRecipientsSchema.safeParse(Array.from({ length: 11 }, (_, i) => `p${i}@example.com`)).success).toBe(false);
    expect(summaryRecipientsSchema.safeParse([]).success).toBe(true);
  });
});

// The summary is one email to the whole team, so only the charity's own addresses may be on it.
describe("only nbcc.scot addresses get it", () => {
  it("knows an nbcc.scot address, whatever its capitals", () => {
    expect(isSummaryAddress("fern@nbcc.scot")).toBe(true);
    expect(isSummaryAddress(" Fern@NBCC.Scot ")).toBe(true);
  });

  it("refuses every other domain, a subdomain included", () => {
    for (const e of ["fern@example.com", "fern@news.nbcc.scot", "fern@nbcc.scot.example.com", "fern@notnbcc.scot", "fern@nbcc.scot@example.com", "nbcc.scot", "@nbcc.scot", ""]) {
      expect(isSummaryAddress(e), e).toBe(false);
    }
  });

  it("says so in plain words", () => {
    expect(SUMMARY_DOMAIN_REFUSAL).toBe("Only nbcc.scot addresses can get the weekly summary.");
  });

  it("finds the first address from elsewhere that is being added", () => {
    expect(summaryOutsiderAdded(["fern@nbcc.scot", "rowan@nbcc.scot"], [])).toBe(-1);
    expect(summaryOutsiderAdded(["fern@nbcc.scot", "rowan@example.com"], [])).toBe(1);
  });

  it("lets an old address from elsewhere stay until it is removed, so the rest of the list can still be changed", () => {
    expect(summaryOutsiderAdded(["fern@nbcc.scot", "old@example.com"], ["old@example.com", "older@example.com"])).toBe(-1);
    expect(summaryOutsiderAdded(["new@example.com", "old@example.com"], ["old@example.com"])).toBe(0);
  });
});
