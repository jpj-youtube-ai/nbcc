import { describe, it, expect } from "vitest";
import { dailyCapFor, gentleDailyCap, type JobPacing } from "../../src/newsletter/send-pacing";
import { dispositionFor } from "../../src/newsletter/send-failure";

// TASK-302: everyone gets the newsletter exactly once.
//
// Two faults conspired against that:
//
//   1. The gentle rollout ramps 200 -> 400 -> 800 and IGNORES any configured cap, so it climbs
//      straight past the mail provider daily allowance. Worse, that allowance is shared with
//      donation receipts, Gift Aid confirmations and admin login codes - so a newsletter that eats
//      the whole day silently costs a donor their receipt.
//   2. When the provider refuses for capacity, the send used to burn one of the recipient THREE
//      attempts. Being told "not now" three times marked that person permanently failed, and they
//      would never be written to again. Silent, and the exact opposite of "everyone gets it once".
//
// A capacity refusal is not a failure of the address. It is the provider asking us to come back
// later, and the only correct response is to come back later.

const job = (over: Partial<JobPacing> = {}): JobPacing => ({
  rollout: "gentle",
  perMinute: 60,
  dailyCap: 0,
  ceiling: 0,
  startedAt: new Date("2026-08-27T09:00:00Z"),
  ...over,
});

const SAME_DAY = new Date("2026-08-27T15:00:00Z");

describe("the standing daily ceiling (TASK-302)", () => {
  it("leaves the old behaviour exactly as it was when no ceiling is set", () => {
    expect(dailyCapFor(job({ ceiling: 0 }), SAME_DAY)).toBe(gentleDailyCap(1));
    expect(dailyCapFor(job({ rollout: "immediate", dailyCap: 500 }), SAME_DAY)).toBe(500);
  });

  it("holds the gentle ramp down to the ceiling", () => {
    // Day one of the ramp wants 200. The provider allows far less, and receipts need room.
    expect(dailyCapFor(job({ ceiling: 70 }), SAME_DAY)).toBe(70);
  });

  it("keeps holding it down as the ramp doubles on later days", () => {
    const later = new Date("2026-08-30T09:00:00Z"); // day four: the ramp wants 1600
    expect(gentleDailyCap(4)).toBeGreaterThan(70);
    expect(dailyCapFor(job({ ceiling: 70 }), later)).toBe(70);
  });

  it("caps an immediate send that asked for no limit at all", () => {
    // dailyCap 0 has always meant "uncapped". A ceiling has to beat that, or the protection is
    // trivially bypassed by the default send option.
    expect(dailyCapFor(job({ rollout: "immediate", dailyCap: 0, ceiling: 70 }), SAME_DAY)).toBe(70);
  });

  it("never raises a lower limit that was asked for deliberately", () => {
    expect(dailyCapFor(job({ rollout: "immediate", dailyCap: 25, ceiling: 70 }), SAME_DAY)).toBe(25);
  });
});

describe("telling a refusal from a rejection (TASK-302)", () => {
  it("treats a rate limit as come-back-later, not as a bad address", () => {
    expect(dispositionFor("Newsletter email send responded 502: Resend error 429: Too many requests")).toBe("defer");
  });

  it("recognises a daily quota being spent", () => {
    expect(dispositionFor("Resend error 429: You have reached your daily sending quota")).toBe("defer");
    expect(dispositionFor("Resend error 403: Daily limit reached")).toBe("defer");
  });

  it("treats the provider being briefly unavailable as come-back-later", () => {
    expect(dispositionFor("Newsletter email send responded 503")).toBe("defer");
    expect(dispositionFor("fetch failed")).toBe("defer");
  });

  it("counts a genuinely bad address against its attempts", () => {
    expect(dispositionFor("Resend error 422: Invalid `to` field")).toBe("count");
    expect(dispositionFor("Resend error 400: Bad request")).toBe("count");
  });

  it("counts anything it does not recognise, so an unknown fault cannot loop forever", () => {
    // Deferring is the generous branch: it costs a recipient nothing but retries indefinitely. An
    // unrecognised error must therefore fall on the SAFE side, which is the one that gives up.
    expect(dispositionFor("something we have never seen")).toBe("count");
    expect(dispositionFor("")).toBe("count");
  });
});
