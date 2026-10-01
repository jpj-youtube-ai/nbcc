import { describe, it, expect } from "vitest";
import { addCalendarMonths, callDue, CALLS_START, normalisePhone } from "../../src/business/call-due";

// TASK-491: when a business that gives monthly is due a thank you call. Pure: dates in, answer out.
// Every date is a UK calendar day as YYYY-MM-DD.

describe("addCalendarMonths", () => {
  it("lands on the same day of the month three months on", () => {
    expect(addCalendarMonths("2026-06-15", 3)).toBe("2026-09-15");
  });

  it("keeps 31 May as 31 August", () => {
    expect(addCalendarMonths("2026-05-31", 3)).toBe("2026-08-31");
  });

  it("holds 30 November to the last day of February", () => {
    expect(addCalendarMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addCalendarMonths("2027-11-30", 3)).toBe("2028-02-29");
  });

  it("holds 31 August to 30 November", () => {
    expect(addCalendarMonths("2026-08-31", 3)).toBe("2026-11-30");
  });

  it("crosses a year", () => {
    expect(addCalendarMonths("2026-12-01", 3)).toBe("2027-03-01");
  });
});

describe("callDue", () => {
  const supporting = true;

  it("starts no earlier than 1 September 2026", () => {
    expect(CALLS_START).toBe("2026-09-01");
    expect(callDue({ today: "2026-08-31", supportingSince: "2026-01-10", lastCalledAt: null, supporting })).toEqual({
      due: false,
      dueOn: "2026-09-01",
    });
    expect(callDue({ today: "2026-09-01", supportingSince: "2026-01-10", lastCalledAt: null, supporting })).toEqual({
      due: true,
      dueOn: "2026-09-01",
    });
  });

  it("before any call, is due three months after they started giving", () => {
    expect(callDue({ today: "2026-10-02", supportingSince: "2026-08-20", lastCalledAt: null, supporting })).toEqual({
      due: false,
      dueOn: "2026-11-20",
    });
    expect(callDue({ today: "2026-11-20", supportingSince: "2026-08-20", lastCalledAt: null, supporting }).due).toBe(true);
  });

  it("makes everyone giving since June 2026 or earlier due now", () => {
    expect(callDue({ today: "2026-10-02", supportingSince: "2026-06-30", lastCalledAt: null, supporting }).due).toBe(true);
    expect(callDue({ today: "2026-10-02", supportingSince: "2026-07-03", lastCalledAt: null, supporting }).due).toBe(false);
  });

  it("after a call, is due three months after the last call", () => {
    expect(
      callDue({ today: "2026-10-02", supportingSince: "2026-01-01", lastCalledAt: "2026-09-15", supporting }),
    ).toEqual({ due: false, dueOn: "2026-12-15" });
    expect(
      callDue({ today: "2026-12-15", supportingSince: "2026-01-01", lastCalledAt: "2026-09-15", supporting }).due,
    ).toBe(true);
  });

  it("a call is not held back by the 1 September start", () => {
    // A call recorded before the start still counts from the day it was made.
    expect(
      callDue({ today: "2026-10-02", supportingSince: "2026-01-01", lastCalledAt: "2026-06-01", supporting }),
    ).toEqual({ due: true, dueOn: "2026-09-01" });
  });

  it("is due on the day itself, not only after it", () => {
    expect(
      callDue({ today: "2026-11-30", supportingSince: "2026-01-01", lastCalledAt: "2026-08-31", supporting }),
    ).toEqual({ due: true, dueOn: "2026-11-30" });
  });

  it("is never due once they stop supporting (cancelled or lapsed), whatever the dates", () => {
    expect(
      callDue({ today: "2027-06-01", supportingSince: "2026-01-01", lastCalledAt: null, supporting: false }),
    ).toEqual({ due: false, dueOn: null });
    expect(
      callDue({ today: "2027-06-01", supportingSince: "2026-01-01", lastCalledAt: "2026-09-01", supporting: false }),
    ).toEqual({ due: false, dueOn: null });
  });

  it("is never due without a first paid monthly gift", () => {
    expect(callDue({ today: "2027-06-01", supportingSince: null, lastCalledAt: null, supporting: true })).toEqual({
      due: false,
      dueOn: null,
    });
  });
});

describe("normalisePhone", () => {
  it("accepts a UK number with spaces, brackets, plus and dashes, trimmed", () => {
    expect(normalisePhone("  0131 496 0000 ")).toEqual({ ok: true, phone: "0131 496 0000" });
    expect(normalisePhone("+44 (0)131 496-0000")).toEqual({ ok: true, phone: "+44 (0)131 496-0000" });
  });

  it("treats an empty box as taking the number away", () => {
    expect(normalisePhone("")).toEqual({ ok: true, phone: null });
    expect(normalisePhone("   ")).toEqual({ ok: true, phone: null });
  });

  it("refuses letters and other characters", () => {
    expect(normalisePhone("call reception").ok).toBe(false);
    expect(normalisePhone("0131 496 0000 ext 2").ok).toBe(false);
    expect(normalisePhone("0131/496/0000").ok).toBe(false);
  });

  it("refuses something too short to be a number", () => {
    expect(normalisePhone("12345").ok).toBe(false);
  });

  it("refuses more than 40 characters", () => {
    expect(normalisePhone("0".repeat(41)).ok).toBe(false);
    expect(normalisePhone("0".repeat(40)).ok).toBe(true);
  });
});
