import { describe, it, expect } from "vitest";
import {
  gentleDailyCap,
  sendDayNumber,
  dailyCapFor,
  tickAllowance,
  pacingSummary,
  GENTLE_FIRST_DAY,
  GENTLE_MAX_PER_DAY,
  type JobPacing,
} from "../../src/newsletter/send-pacing";

// TASK-274: the rules that decide how fast a send goes. Pure, so they are pinned here rather than
// discovered in production. Two brakes: the provider's rate limit, and a daily cap that a GENTLE
// rollout ramps — a young domain emitting two thousand messages in ten minutes looks like a
// compromised account, and gets treated like one.

const job = (over: Partial<JobPacing> = {}): JobPacing => ({
  rollout: "immediate",
  perMinute: 60,
  dailyCap: 0,
  startedAt: new Date("2026-08-01T09:00:00Z"),
  ...over,
});

describe("gentleDailyCap — the warm-up ramp", () => {
  it("starts modestly and doubles each day", () => {
    expect(gentleDailyCap(1)).toBe(GENTLE_FIRST_DAY);
    expect(gentleDailyCap(2)).toBe(400);
    expect(gentleDailyCap(3)).toBe(800);
    expect(gentleDailyCap(4)).toBe(1600);
  });

  it("stops climbing at the ceiling, and never goes backwards", () => {
    expect(gentleDailyCap(50)).toBe(GENTLE_MAX_PER_DAY);
    expect(gentleDailyCap(500)).toBe(GENTLE_MAX_PER_DAY); // no overflow into nonsense
  });

  it("gives nothing for a day number before the send started", () => {
    expect(gentleDailyCap(0)).toBe(0);
    expect(gentleDailyCap(-3)).toBe(0);
  });

  it("clears a 2,000-person list in about four days", () => {
    let sent = 0;
    let day = 0;
    while (sent < 2000 && day < 30) sent += gentleDailyCap(++day);
    expect(day).toBe(4);
  });
});

describe("sendDayNumber — which day of the rollout we are on (UTC)", () => {
  const start = new Date("2026-08-01T22:00:00Z");
  it("counts the starting day as day 1", () => {
    expect(sendDayNumber(start, new Date("2026-08-01T22:30:00Z"))).toBe(1);
  });
  it("rolls over on the calendar date, not on 24 elapsed hours", () => {
    // only three hours later, but it is the next day — the allowance renews
    expect(sendDayNumber(start, new Date("2026-08-02T01:00:00Z"))).toBe(2);
  });
  it("keeps counting across several days", () => {
    expect(sendDayNumber(start, new Date("2026-08-05T09:00:00Z"))).toBe(5);
  });
  it("never returns less than 1, even if the clock disagrees", () => {
    expect(sendDayNumber(start, new Date("2026-07-30T09:00:00Z"))).toBe(1);
  });
});

describe("dailyCapFor", () => {
  it("uses the ramp for a gentle rollout, ignoring any stored cap", () => {
    const now = new Date("2026-08-03T09:00:00Z"); // day 3
    expect(dailyCapFor(job({ rollout: "gentle", dailyCap: 99 }), now)).toBe(800);
  });

  it("uses the stored cap for an immediate send, and 0 means uncapped", () => {
    const now = new Date("2026-08-03T09:00:00Z");
    expect(dailyCapFor(job({ dailyCap: 500 }), now)).toBe(500);
    expect(dailyCapFor(job({ dailyCap: 0 }), now)).toBe(0);
  });

  it("treats a gentle job that has not started yet as being on day 1", () => {
    const now = new Date("2026-08-03T09:00:00Z");
    expect(dailyCapFor(job({ rollout: "gentle", startedAt: null }), now)).toBe(GENTLE_FIRST_DAY);
  });
});

describe("tickAllowance — how many may go out right now", () => {
  const now = new Date("2026-08-01T09:00:00Z");

  it("is the throttle share of the tick when nothing is capped", () => {
    expect(tickAllowance(job({ perMinute: 60 }), 0, now, 20)).toBe(20); // 60/min over a 20s tick
    expect(tickAllowance(job({ perMinute: 120 }), 0, now, 20)).toBe(40);
  });

  it("never exceeds what is left of today's cap", () => {
    const gentle = job({ rollout: "gentle", perMinute: 6000 }); // throttle far above the cap
    expect(tickAllowance(gentle, 0, now, 20)).toBe(GENTLE_FIRST_DAY); // day 1 cap wins
    expect(tickAllowance(gentle, 195, now, 20)).toBe(5); // only 5 of today's allowance left
  });

  it("returns 0 once today's allowance is used up — the worker just sleeps", () => {
    const gentle = job({ rollout: "gentle" });
    expect(tickAllowance(gentle, GENTLE_FIRST_DAY, now, 20)).toBe(0);
    expect(tickAllowance(gentle, 999, now, 20)).toBe(0); // never negative
  });

  it("lets the ramp raise the allowance on later days without anything being rescheduled", () => {
    const gentle = job({ rollout: "gentle", perMinute: 6000 });
    expect(tickAllowance(gentle, 0, new Date("2026-08-02T09:00:00Z"), 20)).toBe(400);
    expect(tickAllowance(gentle, 0, new Date("2026-08-04T09:00:00Z"), 20)).toBe(1600);
  });

  it("cannot be tricked into a burst by a nonsense throttle", () => {
    expect(tickAllowance(job({ perMinute: -5 }), 0, now, 20)).toBe(0);
  });
});

describe("pacingSummary — what the admin screen says", () => {
  const now = new Date("2026-08-01T09:00:00Z");

  it("says when it is done", () => {
    expect(pacingSummary(job(), 0, 0, now)).toBe("All sent.");
  });

  it("explains a pause for the day rather than looking broken, and says tomorrow's allowance", () => {
    const text = pacingSummary(job({ rollout: "gentle" }), GENTLE_FIRST_DAY, 1800, now);
    expect(text).toContain("Today's 200 sent");
    expect(text).toContain("1800 still to go");
    expect(text).toContain("up to 400"); // tomorrow's ramp
  });

  it("gives a rough finish time while it is running", () => {
    expect(pacingSummary(job({ perMinute: 60 }), 0, 30, now)).toMatch(/30 still to send.*min/);
    expect(pacingSummary(job({ perMinute: 60 }), 0, 7200, now)).toMatch(/hrs/);
  });
});
