import { describe, it, expect } from "vitest";
import {
  bookingProgress,
  summariseGuestProgress,
  outstandingBookings,
  guestLinkFor,
  type GuestProgressRow,
} from "../../src/ball/guest-progress";

// TASK-336: the numbers behind "who still owes us their guest details".

const row = (over: Partial<GuestProgressRow> = {}): GuestProgressRow => ({
  reference: "NBCC-BALL-0001",
  buyerName: "Jo Baxter",
  buyerEmail: "jo@example.com",
  seats: 10,
  guestsNamed: 0,
  needsGiven: 0,
  guestToken: "tok-1",
  ...over,
});

describe("one booking's progress", () => {
  it("counts what is still missing", () => {
    expect(bookingProgress(row({ seats: 10, guestsNamed: 4 })).missing).toBe(6);
  });

  it("is complete when everyone is named", () => {
    const b = bookingProgress(row({ seats: 2, guestsNamed: 2 }));
    expect(b.missing).toBe(0);
    expect(b.complete).toBe(true);
  });

  // The guest form does not cap how many names a buyer adds, and a table host adding a spare is
  // an ordinary way to get there. Left unclamped this returns -2, which then SUBTRACTS from the
  // totals and reports the catering list as more complete than it is.
  it("never reports a negative gap when more guests are named than seats", () => {
    const b = bookingProgress(row({ seats: 10, guestsNamed: 12 }));
    expect(b.missing).toBe(0);
    expect(b.complete).toBe(true);
  });
});

describe("the summary staff read at a glance", () => {
  const rows = [
    row({ reference: "A", seats: 10, guestsNamed: 10, needsGiven: 3 }),
    row({ reference: "B", seats: 10, guestsNamed: 4, needsGiven: 1 }),
    row({ reference: "C", seats: 2, guestsNamed: 0, needsGiven: 0 }),
  ];

  it("adds up seats, names and the gap", () => {
    const s = summariseGuestProgress(rows);
    expect(s.seatsBooked).toBe(22);
    expect(s.guestsNamed).toBe(14);
    expect(s.guestsMissing).toBe(8);
  });

  it("splits bookings into done and still to chase", () => {
    const s = summariseGuestProgress(rows);
    expect(s.bookingsComplete).toBe(1);
    expect(s.bookingsOutstanding).toBe(2);
  });

  it("counts the guests who declared a dietary or access need", () => {
    expect(summariseGuestProgress(rows).needsGiven).toBe(4);
  });

  it("says nothing rather than dividing by zero before any bookings", () => {
    const s = summariseGuestProgress([]);
    expect(s.seatsBooked).toBe(0);
    expect(s.percentComplete).toBe(0);
  });

  // The number exists to tell someone whether they can hand the venue a catering list. A list
  // that is 99.6% done rounding to "100%" says finished when four people are still missing.
  it("never rounds up to 100 while anyone is missing", () => {
    const nearly = [row({ seats: 1000, guestsNamed: 998 })];
    expect(summariseGuestProgress(nearly).percentComplete).toBe(99);
  });

  it("reaches 100 only when nothing is outstanding", () => {
    expect(summariseGuestProgress([row({ seats: 10, guestsNamed: 10 })]).percentComplete).toBe(100);
  });

  // Over-naming must not inflate the headline either.
  it("does not let an over-filled booking cover another booking's gap", () => {
    const s = summariseGuestProgress([
      row({ reference: "A", seats: 10, guestsNamed: 14 }),
      row({ reference: "B", seats: 10, guestsNamed: 0 }),
    ]);
    expect(s.guestsNamed).toBe(10);
    expect(s.guestsMissing).toBe(10);
    expect(s.percentComplete).toBe(50);
  });
});

describe("the chase list", () => {
  const rows = [
    row({ reference: "DONE", seats: 4, guestsNamed: 4 }),
    row({ reference: "ONE-SHORT", seats: 4, guestsNamed: 3 }),
    row({ reference: "WHOLE-TABLE", seats: 10, guestsNamed: 0 }),
  ];

  it("leaves out anyone who has already replied", () => {
    expect(outstandingBookings(rows).map((b) => b.reference)).not.toContain("DONE");
  });

  // Biggest gap first: a table of ten with nobody named is both the most work and the most
  // damaging to leave, while a booking missing one name is a single reply away.
  it("puts the biggest gap at the top", () => {
    expect(outstandingBookings(rows).map((b) => b.reference)).toEqual(["WHOLE-TABLE", "ONE-SHORT"]);
  });

  it("orders equal gaps predictably, so the list does not shuffle between refreshes", () => {
    const same = [
      row({ reference: "NBCC-BALL-0009", seats: 2, guestsNamed: 0 }),
      row({ reference: "NBCC-BALL-0002", seats: 2, guestsNamed: 0 }),
    ];
    expect(outstandingBookings(same).map((b) => b.reference)).toEqual([
      "NBCC-BALL-0002",
      "NBCC-BALL-0009",
    ]);
  });
});

describe("resending someone their own link", () => {
  it("builds the guest link from the booking's token", () => {
    expect(guestLinkFor(row({ guestToken: "abc" }), "https://nbcc.scot")).toBe(
      "https://nbcc.scot/ball/guests/abc",
    );
  });

  it("does not double the slash when the base URL has a trailing one", () => {
    expect(guestLinkFor(row({ guestToken: "abc" }), "https://nbcc.scot/")).toBe(
      "https://nbcc.scot/ball/guests/abc",
    );
  });

  // Minted with the confirmation email, so a booking paid seconds ago can legitimately have
  // none. Returning a link to /ball/guests/null would be worse than showing nothing.
  it("returns nothing when the booking has no token yet", () => {
    expect(guestLinkFor(row({ guestToken: null }), "https://nbcc.scot")).toBeNull();
  });
});
