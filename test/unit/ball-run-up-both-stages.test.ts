import { describe, it, expect } from "vitest";
import { planRunUp, runRunUpPass, stagesFor, type RunUpBooking, type RunUpStage, type RunUpWindow } from "../../src/ball/run-up";

// Review of the wording pass (2026-10-04), then TASK-575. The reminder goes a week before the Ball, so
// it is due on many mornings, and the pass used to send the guest list nudge and the last call as well:
// a booking got everything due that morning, each with its own stamp. TASK-575 retired the nudge and
// the last call (the every-other-day reminders and the volunteers' list in src/ball/chase.ts replaced
// them), so the only stage left is the practical reminder. These tests keep what still matters: it goes
// exactly once, a failed send is not stamped so a later morning tries again, and the deadline setting
// no longer changes anything about it. Every name here is invented.

const EVENT = new Date("2026-11-07T19:00:00Z");
const DAY = 86_400_000;

type Stamps = "guestChaseSentAt" | "guestFinalCallSentAt" | "reminderSentAt";
const STAMP: Record<RunUpStage, Stamps> = { chase: "guestChaseSentAt", "final-call": "guestFinalCallSentAt", practical: "reminderSentAt" };

const booking = (over: Partial<RunUpBooking> = {}): RunUpBooking => ({
  id: 1, reference: "BALL-EXAMPL", buyerEmail: "alex@example.com", buyerName: "Alex Example", buyerFirstName: "Alex", tableName: null,
  guestToken: "tok", seats: 10, guestsNamed: 0, guestChaseSentAt: null, guestFinalCallSentAt: null, reminderSentAt: null, ...over,
});
const at = (now: string, lockAt: Date | null): RunUpWindow => ({ now: new Date(now), eventDate: EVENT, lockAt });

/** Every 08:00 run from 20 October to 8 November: what one booking is sent, and on which day. */
function simulate(
  lockAt: Date | null,
  start: Partial<RunUpBooking>,
  paidOn: string | null,
  fails: (day: string, stage: RunUpStage) => boolean = () => false,
): Array<[string, RunUpStage]> {
  const b = booking(start);
  const got: Array<[string, RunUpStage]> = [];
  for (let d = new Date("2026-10-20T08:00:00Z"); d <= new Date("2026-11-08T08:00:00Z"); d = new Date(d.getTime() + DAY)) {
    const day = d.toISOString().slice(0, 10);
    // Not paid for yet: the pass does not see it.
    if (paidOn !== null && d.getTime() < new Date(paidOn).getTime()) continue;
    for (const stage of stagesFor(b, { now: d, eventDate: EVENT, lockAt })) {
      if (fails(day, stage)) continue;
      got.push([day, stage]);
      b[STAMP[stage]] = d.toISOString();
    }
  }
  return got;
}

describe("only the practical reminder is left", () => {
  it("goes to a booking that is still outstanding, with the deadline passed or not, and nothing else with it", () => {
    for (const lock of ["2026-10-30T17:00:00Z", "2026-11-02T12:00:00Z", "2026-10-24T23:59:59Z"]) {
      expect(stagesFor(booking(), at("2026-10-31T08:00:00Z", new Date(lock))), lock).toEqual(["practical"]);
      expect(planRunUp([booking()], at("2026-10-31T08:00:00Z", new Date(lock))).map((p) => p.stage), lock).toEqual(["practical"]);
    }
  });

  it("is the same with no deadline set", () => {
    expect(stagesFor(booking(), at("2026-10-31T08:00:00Z", null))).toEqual(["practical"]);
  });

  it("never lists the nudge or the last call, on the mornings they used to be due", () => {
    const lock = new Date("2026-10-24T23:59:59Z");
    for (const day of ["2026-10-11", "2026-10-25", "2026-11-01", "2026-11-03"]) {
      const stages = stagesFor(booking(), at(`${day}T08:00:00Z`, lock));
      expect(stages, day).not.toContain("chase");
      expect(stages, day).not.toContain("final-call");
    }
    expect(stagesFor(booking(), at("2026-10-11T08:00:00Z", lock))).toEqual([]);
    expect(stagesFor(booking(), at("2026-10-25T08:00:00Z", lock))).toEqual([]);
  });

  it("is not affected by old nudge or last call stamps, and never lists one already sent", () => {
    const lock = new Date("2026-10-30T17:00:00Z");
    expect(stagesFor(booking({ guestChaseSentAt: "x", guestFinalCallSentAt: "y" }), at("2026-10-31T08:05:00Z", lock))).toEqual(["practical"]);
    expect(stagesFor(booking({ reminderSentAt: "2026-10-31T08:00:02Z" }), at("2026-10-31T08:05:00Z", lock))).toEqual([]);
  });

  it("skips a booking with no address, and still goes without a guest link", () => {
    expect(stagesFor(booking({ buyerEmail: "" }), at("2026-10-31T08:00:00Z", null))).toEqual([]);
    expect(stagesFor(booking({ guestToken: null }), at("2026-10-31T08:00:00Z", null))).toEqual(["practical"]);
  });
});

describe("the reminder goes exactly once, whatever the closing date", () => {
  it.each([
    null,
    "2026-10-24T23:59:59Z",
    "2026-10-30T17:00:00Z",
    "2026-11-02T12:00:00Z",
  ])("closing %s", (lock) => {
    const got = simulate(lock ? new Date(lock) : null, {}, null);
    expect(got).toEqual([["2026-10-31", "practical"]]);
  });

  it("a late payer is reminded the next morning, once", () => {
    expect(simulate(null, {}, "2026-11-02T15:00:00Z")).toEqual([["2026-11-03", "practical"]]);
  });

  it("a booking first seen on the morning of the Ball gets no reminder", () => {
    expect(simulate(null, {}, "2026-11-06T20:00:00Z")).toEqual([]);
  });
});

describe("a failed send is not stamped", () => {
  it("is tried again the next morning", () => {
    const got = simulate(null, {}, null, (day) => day === "2026-10-31");
    expect(got).toEqual([["2026-11-01", "practical"]]);
  });

  it("the pass sends and stamps it, and counts it under practical alone", async () => {
    const b = booking();
    const sent: string[] = [];
    const marked: string[] = [];
    const result = await runRunUpPass({
      listBookings: async () => [b],
      send: async (_b, stage) => {
        sent.push(stage);
      },
      markSent: async (_id, stage) => {
        marked.push(stage);
      },
      window: at("2026-10-31T08:00:00Z", new Date("2026-10-30T17:00:00Z")),
    });
    expect(sent).toEqual(["practical"]);
    expect(marked).toEqual(["practical"]);
    expect(result).toEqual({ considered: 1, sent: 1, failed: 0, byStage: { chase: 0, "final-call": 0, practical: 1 } });
  });

  it("the pass counts a failed send and stamps nothing", async () => {
    const marked: string[] = [];
    const result = await runRunUpPass({
      listBookings: async () => [booking()],
      send: async () => {
        throw new Error("mail down");
      },
      markSent: async (_id, stage) => {
        marked.push(stage);
      },
      window: at("2026-10-31T08:00:00Z", null),
    });
    expect(marked).toEqual([]);
    expect(result).toEqual({ considered: 1, sent: 0, failed: 1, byStage: { chase: 0, "final-call": 0, practical: 0 } });
  });
});
