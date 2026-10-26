import { describe, it, expect } from "vitest";
import {
  stageFor,
  PRACTICAL_DAYS_BEFORE_EVENT,
  planRunUp,
  runRunUpPass,
  outstanding,
  type RunUpBooking,
  type RunUpWindow,
} from "../../src/ball/run-up";

// TASK-338: the run-up schedule. Every date is passed in, so these run without a clock.

const EVENT = new Date("2026-11-07T19:00:00Z");
const LOCK = new Date("2026-10-24T23:59:59Z");

const booking = (over: Partial<RunUpBooking> = {}): RunUpBooking => ({
  id: 1,
  reference: "NBCC-BALL-0001",
  buyerEmail: "jo@example.com",
  buyerName: "Jo Baxter",
  buyerFirstName: "Jo",
  tableName: null,
  guestToken: "tok123",
  seats: 10,
  guestsNamed: 0,
  guestChaseSentAt: null,
  guestFinalCallSentAt: null,
  reminderSentAt: null,
  ...over,
});

const at = (iso: string, lockAt: Date | null = LOCK): RunUpWindow => ({
  now: new Date(iso),
  eventDate: EVENT,
  lockAt,
});

describe("who still owes us guest details", () => {
  it("is outstanding while fewer guests are named than seats", () => {
    expect(outstanding(booking({ seats: 10, guestsNamed: 9 }))).toBe(true);
    expect(outstanding(booking({ seats: 10, guestsNamed: 10 }))).toBe(false);
  });
});

// TASK-575: the fortnight-out chase and the final call are retired. The every-other-day reminders and
// the volunteers' list (src/ball/chase.ts, run by src/ball/chase-runner.ts) replaced them, so this
// pass never sends either, on any morning, whatever is outstanding or has been stamped. The stamps
// stay on the booking so old rows still read.
describe("the retired chase and final call", () => {
  it("never fire, on any morning from a month out to a week after the deadline", () => {
    const days = ["2026-10-05", "2026-10-11", "2026-10-18", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
    for (const day of days) {
      expect(stageFor(booking(), at(`${day}T09:00:00Z`)), day).toBeNull();
      expect(planRunUp([booking()], at(`${day}T09:00:00Z`)), day).toEqual([]);
    }
  });

  it("do not come back for a booking that never had them stamped", () => {
    expect(stageFor(booking({ guestChaseSentAt: null }), at("2026-10-11T09:00:00Z"))).toBeNull();
    expect(stageFor(booking({ guestFinalCallSentAt: null }), at("2026-10-25T09:00:00Z"))).toBeNull();
  });

  it("stay quiet with a deadline set, or with none", () => {
    expect(stageFor(booking(), at("2026-10-11T09:00:00Z", LOCK))).toBeNull();
    expect(stageFor(booking(), at("2026-10-11T09:00:00Z", null))).toBeNull();
  });
});

// Jaimie, 2026-10-04: the email says "A week to go", so it goes a week before the Ball (it went 3
// days before). The Ball is on Saturday 7 November 2026, so that is Saturday 31 October.
describe("the practical email, a week before", () => {
  it("waits until seven days before", () => {
    expect(PRACTICAL_DAYS_BEFORE_EVENT).toBe(7);
    expect(stageFor(booking({ guestsNamed: 10 }), at("2026-10-30T09:00:00Z"))).toBeNull();
    expect(stageFor(booking({ guestsNamed: 10 }), at("2026-10-31T08:00:00Z"))).toBe("practical");
  });

  // The morning run is hours before the Ball's 7pm start, a week on. Counting hours would hold it
  // until the next morning, a day late for "a week on Saturday".
  it("goes by the day in the UK, not by counting hours back from the start", () => {
    expect(stageFor(booking(), at("2026-10-31T00:30:00Z"))).toBe("practical");
    // 23:30 UTC on Friday 30 October is still the 30th in the UK (the clocks went back on the 25th).
    expect(stageFor(booking(), at("2026-10-30T23:30:00Z"))).toBeNull();
  });

  // The charity's decision: someone who books inside the last week still gets it, on the next
  // morning's run, as they always did. The email then says the true time to go ("4 days to go",
  // "Tomorrow": test/unit/ball-reminder-days-to-go.test.ts), never "A week to go".
  it("goes, the next morning, to a booking made in the last week", () => {
    for (const now of ["2026-11-01T08:00:00Z", "2026-11-03T08:00:00Z", "2026-11-06T08:00:00Z"]) {
      expect(stageFor(booking({ guestsNamed: 10 }), at(now)), now).toBe("practical");
    }
  });

  // A send that failed is not stamped, so the next morning tries again, up to the day before.
  it("is tried again on a later morning if it did not go, but never on the day of the Ball or after", () => {
    expect(stageFor(booking({ guestsNamed: 10 }), at("2026-11-02T08:00:00Z"))).toBe("practical");
    expect(stageFor(booking({ guestsNamed: 10 }), at("2026-11-06T08:00:00Z"))).toBe("practical");
    expect(stageFor(booking({ guestsNamed: 10 }), at("2026-11-07T08:00:00Z"))).toBeNull();
    expect(stageFor(booking({ guestsNamed: 10 }), at("2026-11-09T08:00:00Z"))).toBeNull();
  });

  // It says where to go and when. Someone who never sent their guest list still has to be able
  // to find the hotel.
  it("goes to everyone, including the people who never replied", () => {
    expect(stageFor(booking({ guestsNamed: 0 }), at("2026-11-05T09:00:00Z"))).toBe("practical");
  });

  it("takes priority over any outstanding chase", () => {
    expect(stageFor(booking(), at("2026-11-05T09:00:00Z"))).toBe("practical");
  });

  it("is sent once", () => {
    const done = booking({ reminderSentAt: "2026-11-05T09:00:00Z" });
    expect(stageFor(done, at("2026-11-06T09:00:00Z"))).toBeNull();
  });
});

describe("bookings with no email", () => {
  // Invoiced bookings and anything taken over the phone can legitimately have none.
  it("are skipped rather than attempted", () => {
    expect(stageFor(booking({ buyerEmail: "" }), at("2026-11-05T09:00:00Z"))).toBeNull();
  });
});

describe("a whole pass", () => {
  const bookings = [
    booking({ id: 1, guestsNamed: 0 }),
    booking({ id: 2, guestsNamed: 10, reminderSentAt: "2026-10-31T08:00:00Z" }),
    booking({ id: 3, guestsNamed: 4 }),
  ];
  const DAY = "2026-11-02T09:00:00Z";

  it("plans only what is due", () => {
    const planned = planRunUp(bookings, at(DAY));
    expect(planned.map((p) => p.booking.id)).toEqual([1, 3]);
    expect(planned.every((p) => p.stage === "practical")).toBe(true);
  });

  it("plans nothing in the weeks before the practical email, whoever is outstanding", () => {
    expect(planRunUp(bookings, at("2026-10-11T09:00:00Z"))).toEqual([]);
  });

  it("sends, then records, and counts by stage", async () => {
    const sent: Array<[number, string]> = [];
    const marked: Array<[number, string]> = [];
    const result = await runRunUpPass({
      listBookings: async () => bookings,
      send: async (b, s) => {
        sent.push([b.id, s]);
      },
      markSent: async (id, s) => {
        marked.push([id, s]);
      },
      window: at(DAY),
    });
    expect(result).toEqual({
      considered: 3,
      sent: 2,
      failed: 0,
      byStage: { chase: 0, "final-call": 0, practical: 2 },
    });
    expect(sent).toEqual(marked);
  });

  // The stamp is what stops a re-run double-sending. Writing it when the send threw would mark a
  // booking as emailed that never was, and nobody would ever find out.
  it("does not record a send that failed", async () => {
    const marked: number[] = [];
    const result = await runRunUpPass({
      listBookings: async () => [booking({ id: 7 })],
      send: async () => {
        throw new Error("provider down");
      },
      markSent: async (id) => {
        marked.push(id);
      },
      window: at(DAY),
    });
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(marked).toEqual([]);
  });

  // This runs unattended once a day. One bad address must not stop every email behind it.
  it("carries on past a failure", async () => {
    let calls = 0;
    const result = await runRunUpPass({
      listBookings: async () => [booking({ id: 1 }), booking({ id: 2 }), booking({ id: 3 })],
      send: async () => {
        calls += 1;
        if (calls === 1) throw new Error("bad address");
      },
      markSent: async () => undefined,
      window: at(DAY),
    });
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
  });
});
