import { describe, it, expect } from "vitest";
import {
  parseScheduleAt,
  isDue,
  scheduleSummary,
  SCHEDULE_MAX_DAYS,
} from "../../src/newsletter/schedule";

// TASK-280 (letter J): send it later. Volunteers write in the evening; newsletters land best on a
// weekday morning. The rules below exist because a bare date field is a foot-gun: a past time would
// send instantly (the opposite of what "schedule" means), and a mistyped year would silently park a
// newsletter for twelve months with no other symptom.

const now = new Date("2026-08-20T09:00:00Z");
const at = (iso: string) => parseScheduleAt(iso, now);

describe("parseScheduleAt", () => {
  it("treats nothing as send-now, so the common case never opts out of anything", () => {
    expect(parseScheduleAt(undefined, now)).toEqual({ ok: true, at: null });
    expect(parseScheduleAt(null, now)).toEqual({ ok: true, at: null });
    expect(parseScheduleAt("   ", now)).toEqual({ ok: true, at: null });
  });

  it("accepts a real future time", () => {
    const out = at("2026-08-25T09:00:00Z");
    expect(out.ok).toBe(true);
    expect(out.ok && out.at?.toISOString()).toBe("2026-08-25T09:00:00.000Z");
  });

  it("rejects a time that has passed rather than sending instantly", () => {
    const out = at("2026-08-19T09:00:00Z");
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/already passed/i);
  });

  // Someone picking "09:00" at 08:59:58 means the next 09:00; browser and server clocks never match.
  it("allows a minute of slack around now, so a clock skew is not a rejection", () => {
    expect(at("2026-08-20T08:59:30Z").ok).toBe(true);
    expect(at("2026-08-20T08:58:00Z").ok).toBe(false);
  });

  // The reason this bound exists: "2027" typed for "2026" is invisible otherwise.
  it("rejects a date so far out it is probably a mistyped year", () => {
    const out = at("2027-08-20T09:00:00Z");
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/check the year/i);
  });

  it("accepts the edge of the allowed window", () => {
    const edge = new Date(now.getTime() + (SCHEDULE_MAX_DAYS - 1) * 86400000);
    expect(parseScheduleAt(edge.toISOString(), now).ok).toBe(true);
  });

  it("rejects nonsense rather than throwing", () => {
    const out = at("next tuesday-ish");
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/not a valid date/i);
  });
});

describe("isDue — what the worker asks on every tick", () => {
  it("an unscheduled job is always due, exactly as before scheduling existed", () => {
    expect(isDue(null, now)).toBe(true);
  });
  it("holds a job until its time, then releases it", () => {
    expect(isDue(new Date("2026-08-20T09:00:01Z"), now)).toBe(false);
    expect(isDue(new Date("2026-08-20T09:00:00Z"), now)).toBe(true);
    expect(isDue(new Date("2026-08-20T08:00:00Z"), now)).toBe(true);
  });
});

describe("scheduleSummary — what the admin sees while waiting", () => {
  it("says nothing for an unscheduled send", () => {
    expect(scheduleSummary(null, now)).toBe("");
  });

  // "Pending" invites someone to assume it is stuck and press send again.
  it("names the time and says it can still be cancelled", () => {
    const text = scheduleSummary(new Date("2026-08-25T09:00:00Z"), now);
    expect(text).toMatch(/Scheduled for/);
    expect(text).toMatch(/25 August/);
    expect(text).toMatch(/cancel/i);
  });

  it("switches to 'starting now' once the time arrives", () => {
    expect(scheduleSummary(new Date("2026-08-20T08:59:00Z"), now)).toBe("Starting now.");
  });
});
