import { describe, it, expect } from "vitest";
import {
  canTouch,
  dueTouches,
  isNewWording,
  isQuietFundraiser,
  nextTouch,
  TOUCH_KINDS,
  TOUCH_LABELS,
  NEW_WORDING_KINDS,
  type TouchFacts,
} from "../../src/fundraising/touch-rules";
import { londonToday } from "../../src/events/model";
import { BUILT_IN_CATEGORIES, rememberCategories } from "../../src/fundraising/categories";
import { meter, type FundraiserRecord, type Meter } from "../../src/fundraising/model";

// TASK-515: when each automatic email to an organiser is due. Pure, against fixed UK days (and two
// clocks either side of the clocks changing). Every name and amount here is invented.

type F = FundraiserRecord & { meter: Meter };
const WANTS = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };

function fr(over: Partial<FundraiserRecord> = {}, raised = 0): F {
  const base = {
    id: 7, slug: "sams-santa-dash", path: "raising", kind: "santa_dash", title: "Sam's Santa Dash", description: "A dash.",
    eventDate: "2026-12-06", startTime: null, venue: "", town: "Exampleton", targetPence: 50000, public: true, status: "approved",
    name: "Sam Example", email: "sam@example.com", phone: "07700 900123", socialLink: null, socialOk: true, wants: { ...WANTS },
    postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-10-01T09:00:00.000Z", approvedAt: "2026-10-06T09:00:00.000Z", approvedBy: "admin:fern@example.com",
    updatedAt: "2026-10-06T09:00:00.000Z", updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null,
    venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null,
    creditName: null, ...over,
  } as FundraiserRecord;
  return { ...base, meter: meter({ onlinePence: raised, cashPence: 0, targetPence: base.targetPence }) };
}

const facts = (over: Partial<TouchFacts> = {}): TouchFacts => ({
  firstOnlineGiftAt: null,
  lastOnlineGiftAt: null,
  finishedAt: null,
  sent: [],
  ...over,
});
const next = (f: F, today: string, x: Partial<TouchFacts> = {}) => nextTouch(f, facts(x), today);
const sentOn = (kind: string, sentAt: string) => ({ kind, sentAt }) as TouchFacts["sent"][number];

describe("the automatic emails", () => {
  it("are the nine, each with a name, and the three new wordings marked", () => {
    expect([...TOUCH_KINDS]).toEqual([
      "first_gift", "halfway", "target", "week_before", "week_after", "finished", "year_on", "need_a_hand", "on_track",
    ]);
    for (const k of TOUCH_KINDS) expect(TOUCH_LABELS[k].length).toBeGreaterThan(0);
    // Finished too: its line about who NBCC supports changed.
    expect([...NEW_WORDING_KINDS]).toEqual(["target", "finished", "need_a_hand", "on_track"]);
  });

  it("marks the nothing raised versions of 16, 17 and 18 as new wording too", () => {
    for (const k of ["week_after", "finished", "year_on"] as const) expect(isNewWording(k, 0)).toBe(true);
    expect(isNewWording("week_after", 54000)).toBe(false);
    expect(isNewWording("year_on", 61200)).toBe(false);
    expect(isNewWording("halfway", 0)).toBe(false);
    expect(isNewWording("target", 50000)).toBe(true);
  });
});

describe("who may get one", () => {
  it("is an approved, public page raising money, with an organiser email", () => {
    expect(canTouch(fr())).toBe(true);
    expect(canTouch(fr({ public: false }))).toBe(false);
    expect(canTouch(fr({ path: "event" }))).toBe(false);
    expect(canTouch(fr({ email: "  " }))).toBe(false);
    for (const status of ["new", "declined"] as const) expect(canTouch(fr({ status }))).toBe(false);
  });

  it("treats a category about memory as in memory, until real in memory pages exist", () => {
    rememberCategories([...BUILT_IN_CATEGORIES, { key: "remembering", label: "In Memory of a loved one", active: true }]);
    expect(isQuietFundraiser(fr({ kind: "remembering" } as never))).toBe(true);
    expect(isQuietFundraiser(fr({ kind: "in_memory" } as never))).toBe(true);
    expect(isQuietFundraiser(fr({ kind: "santa_dash" }))).toBe(false);
    expect(canTouch(fr({ kind: "remembering" } as never))).toBe(false);
    expect(nextTouch(fr({ kind: "in_memory" } as never, 30000), facts(), "2026-11-29")).toBeNull();
    rememberCategories(BUILT_IN_CATEGORIES);
  });

  it("never sends upbeat emails to an in memory page", () => {
    // Nothing is in memory yet, so the guard says no to everyone today.
    expect(isQuietFundraiser(fr())).toBe(false);
    // When it says yes, nothing at all is due.
    const quiet = () => true;
    expect(canTouch(fr(), quiet)).toBe(false);
    expect(nextTouch(fr({}, 30000), facts(), "2026-11-29", { isQuiet: quiet })).toBeNull();
    expect(nextTouch(fr({ status: "finished" }), facts({ finishedAt: "2026-01-01T10:00:00Z" }), "2027-12-06", { isQuiet: quiet })).toBeNull();
  });
});

describe("the first gift", () => {
  it("goes once the first online gift is in, within a week of it", () => {
    expect(next(fr({}, 2000), "2026-10-20", { firstOnlineGiftAt: "2026-10-19T21:00:00.000Z" })).toBe("first_gift");
    expect(next(fr({}, 2000), "2026-10-26", { firstOnlineGiftAt: "2026-10-19T21:00:00.000Z" })).toBe("first_gift");
    expect(next(fr({}, 2000), "2026-10-27", { firstOnlineGiftAt: "2026-10-19T21:00:00.000Z" })).toBeNull();
  });

  it("needs an online gift: money paid in does not count", () => {
    expect(next(fr({}, 2000), "2026-10-20", { firstOnlineGiftAt: null })).toBeNull();
  });

  it("is never sent twice", () => {
    expect(next(fr({}, 2000), "2026-10-21", { firstOnlineGiftAt: "2026-10-19T21:00:00.000Z", sent: [sentOn("first_gift", "2026-10-20T07:00:00Z")] })).toBeNull();
  });
});

describe("halfway and the target", () => {
  it("is halfway from half the target up to just under it", () => {
    expect(next(fr({}, 25000), "2026-10-12")).toBe("halfway");
    expect(next(fr({}, 49999), "2026-10-12")).toBe("halfway");
    expect(next(fr({}, 24999), "2026-10-12")).toBeNull();
  });

  it("is the target once the meter reaches it", () => {
    expect(next(fr({}, 50000), "2026-10-12")).toBe("target");
    expect(next(fr({}, 61200), "2026-10-12")).toBe("target");
  });

  it("only ever sends the highest step: a big first gift that passes halfway is halfway", () => {
    expect(next(fr({}, 30000), "2026-10-20", { firstOnlineGiftAt: "2026-10-19T10:00:00Z" })).toBe("halfway");
    expect(next(fr({}, 50000), "2026-10-20", { firstOnlineGiftAt: "2026-10-19T10:00:00Z" })).toBe("target");
  });

  it("never goes back down the steps once a higher one has gone", () => {
    expect(next(fr({}, 30000), "2026-10-12", { sent: [sentOn("target", "2026-10-10T07:00:00Z")] })).toBeNull();
  });

  it("never after the date: no keep sharing or raise your target once it has happened", () => {
    // Date 6 December. On the day itself it still goes; the day after, never.
    expect(next(fr({}, 30000), "2026-12-06")).toBe("halfway");
    expect(next(fr({}, 50000), "2026-12-06")).toBe("target");
    expect(dueTouches(fr({}, 30000), facts(), "2026-12-07")).not.toContain("halfway");
    expect(dueTouches(fr({}, 50000), facts(), "2026-12-07")).not.toContain("target");
    // And never falls back to the first gift instead.
    expect(dueTouches(fr({}, 50000), facts({ firstOnlineGiftAt: "2026-12-06T10:00:00Z" }), "2026-12-07")).not.toContain("first_gift");
  });

  it("goes with no date at all", () => {
    expect(next(fr({ eventDate: null }, 50000), "2027-03-01")).toBe("target");
  });

  it("never for a finished fundraiser", () => {
    expect(dueTouches(fr({ status: "finished", eventDate: null }, 50000), facts(), "2026-11-01")).toEqual([]);
  });

  it("needs a target", () => {
    expect(next(fr({ targetPence: null }, 30000), "2026-10-12")).toBeNull();
  });
});

describe("a week before and a week after the date", () => {
  it("goes 7 days before, or up to two days later if a run was missed", () => {
    expect(next(fr({}, 20000), "2026-11-28")).toBeNull(); // 8 days
    expect(next(fr({}, 20000), "2026-11-29")).toBe("week_before");
    expect(next(fr({}, 20000), "2026-12-01")).toBe("week_before"); // 5 days
    expect(next(fr({}, 20000), "2026-12-02")).toBeNull(); // 4 days
  });

  it("goes 7 to 9 days after", () => {
    expect(next(fr(), "2026-12-12")).toBeNull();
    expect(next(fr(), "2026-12-13")).toBe("week_after");
    expect(next(fr(), "2026-12-15")).toBe("week_after");
    expect(next(fr(), "2026-12-16")).toBeNull();
  });

  it("counts UK days, across the clocks going back", () => {
    // 23:30 UTC on Saturday 24 October is 00:30 on Sunday 25 October in the UK (still BST then).
    const today = londonToday(new Date("2026-10-24T23:30:00.000Z"));
    expect(today).toBe("2026-10-25");
    expect(next(fr({ eventDate: "2026-11-01" }), today)).toBe("week_before");
  });

  it("counts UK days, across the clocks going forward", () => {
    // 23:30 UTC on Saturday 27 March 2027 is still Saturday in the UK (GMT until 01:00 UTC).
    const today = londonToday(new Date("2027-03-27T23:30:00.000Z"));
    expect(today).toBe("2027-03-27");
    expect(next(fr({ eventDate: "2027-04-03" }), today)).toBe("week_before");
    // An hour later, still Saturday in UTC, but already Sunday 28 March in the UK.
    expect(londonToday(new Date("2027-03-28T00:30:00.000Z"))).toBe("2027-03-28");
  });
});

describe("a year on", () => {
  it("goes 365 days after the date, for an approved or finished fundraiser", () => {
    expect(next(fr({ status: "finished" }), "2027-12-05")).toBeNull();
    expect(next(fr({ status: "finished" }), "2027-12-06")).toBe("year_on");
    expect(next(fr({ status: "approved" }), "2027-12-13")).toBe("year_on");
    expect(next(fr({ status: "finished" }), "2027-12-14")).toBeNull();
  });

  it("counts from when it finished when there was no date", () => {
    const f = fr({ status: "finished", eventDate: null });
    expect(next(f, "2027-03-01", { finishedAt: "2026-03-01T15:00:00Z" })).toBe("year_on");
    expect(next(f, "2027-03-01")).toBeNull();
  });
});

describe("need a hand and you're doing great", () => {
  it("offers a hand once when behind", () => {
    // 10 days away, £100 of £500: behind.
    expect(next(fr({}, 10000), "2026-11-26")).toBe("need_a_hand");
    expect(next(fr({}, 10000), "2026-11-27", { sent: [sentOn("need_a_hand", "2026-11-26T07:00:00Z")] })).toBeNull();
  });

  it("says you're doing great once when on track", () => {
    // Approved 6 Oct, date 6 Dec. On 5 Nov the line is at £245.90 of £500; £200 is within a quarter.
    expect(next(fr({}, 20000), "2026-11-05")).toBe("on_track");
  });

  it("waits a week after any other automatic email", () => {
    expect(next(fr({}, 21000), "2026-11-05", { sent: [sentOn("first_gift", "2026-11-01T07:00:00Z")] })).toBeNull();
    expect(next(fr({}, 21000), "2026-11-08", { sent: [sentOn("first_gift", "2026-11-01T07:00:00Z")] })).toBe("on_track");
  });
});

describe("one at a time", () => {
  it("sends nothing on a day another automatic email has already gone", () => {
    expect(next(fr(), "2026-11-29", { sent: [sentOn("halfway", "2026-11-29T08:00:00Z")] })).toBeNull();
  });

  it("lists everything due in order, and picks the first", () => {
    const due = dueTouches(fr({}, 30000), facts(), "2026-11-29");
    expect(due).toEqual(["week_before", "halfway"]);
    expect(next(fr({}, 30000), "2026-11-29")).toBe("week_before");
  });

  it("never sends the finished email from the daily run: that goes when staff mark it finished", () => {
    for (const day of ["2026-12-07", "2026-12-20", "2027-01-10"]) {
      expect(dueTouches(fr({ status: "finished" }, 50000), facts({ finishedAt: "2026-12-07T10:00:00Z" }), day)).not.toContain("finished");
    }
  });
});
