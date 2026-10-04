import { describe, it, expect } from "vitest";
import { planRunUp, runRunUpPass, stagesFor, type RunUpBooking, type RunUpStage, type RunUpWindow } from "../../src/ball/run-up";

// Review of the wording pass (2026-10-04). The reminder used to go 3 days before the Ball and now
// goes a week before, so it is due on far more mornings. The pass sent ONE email per booking per
// morning with the reminder first, and the last call for guest details is only due for the day after
// the guest list closes: a booking due both on the same morning got the reminder and NEVER the last
// call. Now a booking gets everything that is due that morning: the guest list email first (the last
// call, or the nudge), then the reminder, each with its own stamp, so neither goes twice and a
// failure of one never stops or stamps the other. Every name here is invented.

const EVENT = new Date("2026-11-07T19:00:00Z");
const DAY = 86_400_000;

type Stamps = "guestChaseSentAt" | "guestFinalCallSentAt" | "reminderSentAt";
const STAMP: Record<RunUpStage, Stamps> = { chase: "guestChaseSentAt", "final-call": "guestFinalCallSentAt", practical: "reminderSentAt" };

const booking = (over: Partial<RunUpBooking> = {}): RunUpBooking => ({
  id: 1, reference: "BALL-EXAMPL", buyerEmail: "alex@example.com", buyerName: "Alex Example", buyerFirstName: "Alex", tableName: null,
  guestToken: "tok", seats: 10, guestsNamed: 0, guestChaseSentAt: null, guestFinalCallSentAt: null, reminderSentAt: null, ...over,
});
const at = (now: string, lockAt: Date | null): RunUpWindow => ({ now: new Date(now), eventDate: EVENT, lockAt });

// --- the rule on origin/main (commit c5a11ca), copied here to compare against ----------------------
function mainStageFor(b: RunUpBooking, w: RunUpWindow): RunUpStage | null {
  if (!b.buyerEmail) return null;
  const now = w.now.getTime();
  if (b.reminderSentAt === null && now >= w.eventDate.getTime() - 3 * DAY) return "practical";
  if (!b.guestToken) return null;
  if (b.guestsNamed >= b.seats || w.lockAt === null) return null;
  const lock = w.lockAt.getTime();
  if (now > lock + DAY) return null;
  if (now >= lock) return b.guestFinalCallSentAt === null ? "final-call" : null;
  if (now >= lock - 14 * DAY && b.guestChaseSentAt === null) return "chase";
  return null;
}

/** Every 08:00 run from 20 October to 8 November: what one booking is sent, and on which day. */
function simulate(
  rule: (b: RunUpBooking, w: RunUpWindow) => RunUpStage[],
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
    for (const stage of rule(b, { now: d, eventDate: EVENT, lockAt })) {
      if (fails(day, stage)) continue;
      got.push([day, stage]);
      b[STAMP[stage]] = d.toISOString();
    }
  }
  return got;
}
const mainRule = (b: RunUpBooking, w: RunUpWindow): RunUpStage[] => {
  const s = mainStageFor(b, w);
  return s ? [s] : [];
};
const stagesOf = (got: Array<[string, RunUpStage]>) => got.map(([, s]) => s);

describe("everything due that morning goes, the guest list email first", () => {
  it("the last call and the reminder both go on the morning both are due", () => {
    const lock = new Date("2026-10-30T17:00:00Z");
    expect(stagesFor(booking(), at("2026-10-31T08:00:00Z", lock))).toEqual(["final-call", "practical"]);
    expect(planRunUp([booking()], at("2026-10-31T08:00:00Z", lock)).map((p) => p.stage)).toEqual(["final-call", "practical"]);
  });

  it("a nudge that is due is no longer held back a day by the reminder (when it could miss its window)", () => {
    const lock = new Date("2026-11-02T12:00:00Z");
    expect(stagesFor(booking(), at("2026-11-01T08:00:00Z", lock))).toEqual(["chase", "practical"]);
  });

  it("is exactly as before on a morning when only one is due", () => {
    const lock = new Date("2026-10-24T23:59:59Z");
    expect(stagesFor(booking(), at("2026-10-11T08:00:00Z", lock))).toEqual(["chase"]);
    expect(stagesFor(booking(), at("2026-10-25T08:00:00Z", lock))).toEqual(["final-call"]);
    expect(stagesFor(booking(), at("2026-10-31T08:00:00Z", lock))).toEqual(["practical"]);
    expect(stagesFor(booking({ guestsNamed: 10 }), at("2026-10-31T08:00:00Z", new Date("2026-10-30T17:00:00Z")))).toEqual(["practical"]);
    expect(stagesFor(booking(), at("2026-10-05T08:00:00Z", lock))).toEqual([]);
    expect(stagesFor(booking({ buyerEmail: "" }), at("2026-10-31T08:00:00Z", lock))).toEqual([]);
    // No link for the guest list: no guest list email, but the reminder still goes.
    expect(stagesFor(booking({ guestToken: null }), at("2026-10-31T08:00:00Z", new Date("2026-10-30T17:00:00Z")))).toEqual(["practical"]);
  });

  it("never lists one already sent", () => {
    const lock = new Date("2026-10-30T17:00:00Z");
    expect(stagesFor(booking({ guestFinalCallSentAt: "2026-10-31T08:00:01Z" }), at("2026-10-31T08:05:00Z", lock))).toEqual(["practical"]);
    expect(stagesFor(booking({ reminderSentAt: "2026-10-31T08:00:02Z" }), at("2026-10-31T08:05:00Z", lock))).toEqual(["final-call"]);
    expect(stagesFor(booking({ guestFinalCallSentAt: "x", reminderSentAt: "y" }), at("2026-10-31T08:05:00Z", lock))).toEqual([]);
  });
});

describe("the reviewer's three closing dates: last call AND reminder, each exactly once", () => {
  it.each([
    ["2026-10-24T23:59:59Z", [["2026-10-20", "chase"], ["2026-10-25", "final-call"], ["2026-10-31", "practical"]]],
    ["2026-10-30T17:00:00Z", [["2026-10-20", "chase"], ["2026-10-31", "final-call"], ["2026-10-31", "practical"]]],
    ["2026-11-02T12:00:00Z", [["2026-10-20", "chase"], ["2026-10-31", "practical"], ["2026-11-03", "final-call"]]],
  ])("closing %s", (lock, expected) => {
    const got = simulate(stagesFor, new Date(lock as string), {}, null);
    expect(got).toEqual(expected);
    expect(stagesOf(got).filter((s) => s === "final-call")).toHaveLength(1);
    expect(stagesOf(got).filter((s) => s === "practical")).toHaveLength(1);
  });

  it("a late payer on the last call morning gets both", () => {
    // Paid on 2 November; the guest list closed at noon that day; the run on the 3rd is the last call's only morning.
    expect(simulate(stagesFor, new Date("2026-11-02T12:00:00Z"), {}, "2026-11-02T15:00:00Z")).toEqual([
      ["2026-11-03", "final-call"],
      ["2026-11-03", "practical"],
    ]);
  });
});

describe("one failing never stops or stamps the other", () => {
  const lock = new Date("2026-10-30T17:00:00Z");

  it("the reminder fails: the last call is sent and stamped, and the reminder goes the next morning", () => {
    const got = simulate(stagesFor, lock, { guestChaseSentAt: "x" }, null, (day, stage) => day === "2026-10-31" && stage === "practical");
    expect(got).toEqual([["2026-10-31", "final-call"], ["2026-11-01", "practical"]]);
  });

  it("the last call fails: the reminder is sent and stamped; the last call's one morning has gone, as it always could", () => {
    const got = simulate(stagesFor, lock, { guestChaseSentAt: "x" }, null, (day, stage) => day === "2026-10-31" && stage === "final-call");
    expect(got).toEqual([["2026-10-31", "practical"]]);
  });

  it("the pass itself sends and stamps each on its own", async () => {
    const b = booking({ guestChaseSentAt: "x" });
    const sent: string[] = [];
    const marked: string[] = [];
    const result = await runRunUpPass({
      listBookings: async () => [b],
      send: async (_b, stage) => {
        if (stage === "final-call") throw new Error("mail down");
        sent.push(stage);
      },
      markSent: async (_id, stage) => {
        marked.push(stage);
      },
      window: at("2026-10-31T08:00:00Z", lock),
    });
    expect(sent).toEqual(["practical"]);
    expect(marked).toEqual(["practical"]);
    expect(result).toEqual({ considered: 1, sent: 1, failed: 1, byStage: { chase: 0, "final-call": 0, practical: 1 } });
  });
});

describe("against origin/main's rule, 20 October to 8 November", () => {
  const LOCKS: Array<string | null> = [null, "2026-10-24T23:59:59Z", "2026-10-28T12:00:00Z", "2026-10-30T17:00:00Z", "2026-10-31T12:00:00Z", "2026-11-02T12:00:00Z", "2026-11-04T07:00:00Z", "2026-11-05T12:00:00Z", "2026-11-06T20:00:00Z"];
  const BOOKINGS: Array<[string, Partial<RunUpBooking>, string | null]> = [
    ["booked early, no names yet", {}, null],
    ["booked early, every name given", { guestsNamed: 10 }, null],
    ["booked early, no guest link", { guestToken: null }, null],
    ["paid 26 October", {}, "2026-10-26T15:00:00Z"],
    ["paid 30 October", {}, "2026-10-30T15:00:00Z"],
    ["paid 31 October, after the run", {}, "2026-10-31T15:00:00Z"],
    ["paid 2 November", {}, "2026-11-02T15:00:00Z"],
    ["paid 4 November", {}, "2026-11-04T15:00:00Z"],
    ["paid 5 November", {}, "2026-11-05T15:00:00Z"],
  ];
  const table: string[] = [];

  for (const lock of LOCKS) {
    for (const [label, start, paidOn] of BOOKINGS) {
      it(`closing ${lock ?? "not set"}, ${label}: at least everything main sent, and nothing twice`, () => {
        const lockAt = lock ? new Date(lock) : null;
        const now = stagesOf(simulate(stagesFor, lockAt, start, paidOn));
        const main = stagesOf(simulate(mainRule, lockAt, start, paidOn));
        table.push(`${lock ?? "not set"} | ${label} | main: ${main.join(", ") || "nothing"} | now: ${now.join(", ") || "nothing"}`);
        for (const stage of main) expect(now, `main sent ${stage}`).toContain(stage);
        expect(new Set(now).size).toBe(now.length);
      });
    }
  }

  // The one place it is deliberately fewer (the charity's decision): the reminder is never sent on
  // the day of the Ball or after. Main sent "A week to go" that morning to a booking paid the evening before.
  it("a booking first seen on the morning of the Ball gets no reminder, where main sent one that day", () => {
    const paid = "2026-11-06T20:00:00Z";
    expect(simulate(mainRule, null, {}, paid)).toEqual([["2026-11-07", "practical"]]);
    expect(simulate(stagesFor, null, {}, paid)).toEqual([]);
  });

  it("covers every pairing", () => {
    expect(table).toHaveLength(LOCKS.length * BOOKINGS.length);
    // SHOW_RUN_UP_TABLE=1 prints the whole comparison, one line per closing date and booking.
    if (process.env.SHOW_RUN_UP_TABLE) for (const line of table) console.log(line);
  });
});
