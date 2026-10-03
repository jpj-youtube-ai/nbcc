import { describe, it, expect } from "vitest";
import {
  approveProblem,
  EVENT_SHORT_NAME_NEEDED,
  hasPage,
  meter,
  pagePath,
  publicCard,
  type FundraiserRecord,
} from "../../src/fundraising/model";
import { RESERVED_PREFIXES } from "../../src/site/pages";

// Events get their own page at /event/<short name>, like a fundraiser's at /fundraise/<slug>. The
// short name is the same stored slug (one column, unique across both kinds), so an event and a
// fundraiser can never share one. Staff must set it before an event is approved. Every name here is
// invented.

function record(over: Partial<FundraiserRecord> = {}): FundraiserRecord {
  return {
    id: 21, slug: "eqn", path: "event", kind: "quiz", title: "Exampleton Quiz Night", description: "A quiz in the hall.",
    eventDate: "2026-12-05", startTime: "19:00", venue: "The Hall", town: "Exampleton", targetPence: null, public: true,
    status: "approved", name: "Alex Example", email: "alex@example.com", phone: "07700 900222", socialLink: null,
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z", approvedAt: "2026-10-02T10:00:00.000Z", approvedBy: null,
    updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null,
    venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null,
    creditName: null, slugSetAt: "2026-10-02T09:00:00.000Z",
    ...over,
  };
}

describe("an event's page address", () => {
  it("is /event/<short name> for an event, and /fundraise/<slug> for raising money", () => {
    expect(pagePath(record())).toBe("/event/eqn");
    expect(pagePath(record({ path: "raising", slug: "rsd" }))).toBe("/fundraise/rsd");
  });

  it("is on the card, so Get involved links to it", () => {
    const m = meter({ onlinePence: 0, cashPence: 0, targetPence: null });
    expect(publicCard(record(), m).url).toBe("/event/eqn");
    expect(publicCard(record({ path: "raising", slug: "rsd" }), m).url).toBe("/fundraise/rsd");
  });

  it("is reserved for the site, so no spare address can shadow it", () => {
    expect(RESERVED_PREFIXES).toContain("/event");
  });
});

describe("which events have a page", () => {
  it("an approved or finished public event has one, as a fundraiser does", () => {
    expect(hasPage(record())).toBe(true);
    expect(hasPage(record({ status: "finished" }))).toBe(true);
  });

  it("one that is not public, new or declined has none", () => {
    expect(hasPage(record({ public: false }))).toBe(false);
    expect(hasPage(record({ status: "new" }))).toBe(false);
    expect(hasPage(record({ status: "declined" }))).toBe(false);
  });
});

describe("approving an event", () => {
  it("is refused until staff have set its short name", () => {
    expect(approveProblem(record({ status: "new", slugSetAt: null }))).toBe(EVENT_SHORT_NAME_NEEDED);
    expect(approveProblem(record({ status: "new", slugSetAt: undefined }))).toBe(EVENT_SHORT_NAME_NEEDED);
  });

  it("goes ahead once it is set", () => {
    expect(approveProblem(record({ status: "new" }))).toBeNull();
  });

  it("never stops a fundraiser raising money, which keeps its suggested address as before", () => {
    expect(approveProblem(record({ path: "raising", status: "new", slugSetAt: null }))).toBeNull();
  });

  it("says plainly what to do", () => {
    expect(EVENT_SHORT_NAME_NEEDED).toBe("Give this event a short name first, for its web address.");
  });
});
