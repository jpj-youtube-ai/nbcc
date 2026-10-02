import { describe, it, expect } from "vitest";
import {
  CALL_DAYS,
  OFF_LIST_AFTER_DAYS,
  addDays,
  callStates,
  followUpToday,
  offListPrompt,
  type CallRecord,
} from "../../src/fundraising/follow-up";
import { isListed } from "../../src/fundraising/model";

// TASK-503: the two calls to every fundraiser with a date (a week before and a week after), and the
// prompt to take it off Get involved (four weeks after its date, or straight away when the organiser
// says they've finished). Every date is a UK calendar day, so the clocks changing never moves one.

const call = (which: "before" | "after", calledAt = "2026-11-30T10:00:00.000Z"): CallRecord => ({
  which,
  calledAt,
  calledBy: "fern@example.com",
  note: null,
});

const approved = { status: "approved" as const, eventDate: "2026-12-06" };

describe("the days", () => {
  it("adds calendar days, across the clocks changing and the end of a month", () => {
    expect(addDays("2026-03-25", 7)).toBe("2026-04-01");
    expect(addDays("2026-10-22", 7)).toBe("2026-10-29");
    expect(addDays("2026-12-06", -7)).toBe("2026-11-29");
    expect(addDays("2027-02-26", 3)).toBe("2027-03-01");
  });

  it("takes today in the UK, not in UTC", () => {
    // British Summer Time: half past eleven at night UTC is already tomorrow in the UK.
    expect(followUpToday(new Date("2026-06-10T23:30:00Z"))).toBe("2026-06-11");
    // The night the clocks go back (25 October 2026): 00:30 UTC is 01:30 BST, still the 25th.
    expect(followUpToday(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
    // Winter: UTC and the UK agree.
    expect(followUpToday(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });
});

describe("the call a week before", () => {
  it("is due from 7 days before the date", () => {
    expect(CALL_DAYS).toBe(7);
    expect(callStates(approved, [], "2026-11-28").before).toMatchObject({ dueOn: "2026-11-29", due: false });
    expect(callStates(approved, [], "2026-11-29").before).toMatchObject({ dueOn: "2026-11-29", due: true });
    expect(callStates(approved, [], "2026-12-06").due).toBe(true);
    expect(callStates(approved, [], "2026-12-06").dueWhich).toBe("before");
  });

  it("stops being due once it is made", () => {
    const s = callStates(approved, [call("before")], "2026-12-01");
    expect(s.before).toMatchObject({ due: false, called: { which: "before", calledBy: "fern@example.com" } });
    expect(s.due).toBe(false);
    expect(s.dueWhich).toBeNull();
  });

  it("gives way to the call a week after once that one is due, so there is only ever one to make", () => {
    const s = callStates(approved, [], "2026-12-13");
    expect(s.before).toMatchObject({ due: false, called: null });
    expect(s.after).toMatchObject({ due: true });
    expect(s.dueWhich).toBe("after");
  });
});

describe("the call a week after", () => {
  it("is due from 7 days after the date until it is made", () => {
    expect(callStates(approved, [call("before")], "2026-12-12").after).toMatchObject({ dueOn: "2026-12-13", due: false });
    expect(callStates(approved, [call("before")], "2026-12-13").after).toMatchObject({ due: true });
    expect(callStates(approved, [call("before")], "2027-02-01").after).toMatchObject({ due: true });
    expect(callStates(approved, [call("before"), call("after", "2026-12-14T09:00:00Z")], "2027-02-01").due).toBe(false);
  });

  it("is a separate call from the one before", () => {
    const s = callStates(approved, [call("after", "2026-12-14T09:00:00Z")], "2026-12-01");
    expect(s.before).toMatchObject({ due: true });
    expect(s.after).toMatchObject({ due: false, called: { which: "after" } });
  });
});

describe("no calls", () => {
  it("without a date", () => {
    const s = callStates({ status: "approved", eventDate: null }, [], "2026-12-01");
    expect(s).toEqual({ before: null, after: null, due: false, dueWhich: null });
  });

  it("until it is approved, or once it is declined or finished", () => {
    for (const status of ["new", "declined", "finished"] as const) {
      expect(callStates({ status, eventDate: "2026-12-06" }, [], "2026-12-01").due).toBe(false);
    }
  });
});

const listed = {
  status: "approved" as const,
  public: true,
  path: "raising" as const,
  eventDate: "2026-12-06" as string | null,
  finishedRequestedAt: null as string | null,
  offListAt: null as string | null,
};

describe("the prompt to take it off Get involved", () => {
  it("shows four weeks after its date", () => {
    expect(OFF_LIST_AFTER_DAYS).toBe(28);
    expect(offListPrompt(listed, "2027-01-02")).toBeNull();
    expect(offListPrompt(listed, "2027-01-03")).toBe("date");
    expect(offListPrompt(listed, "2027-03-01")).toBe("date");
  });

  it("shows straight away when the organiser says they've finished", () => {
    expect(offListPrompt({ ...listed, finishedRequestedAt: "2026-11-20T10:00:00Z" }, "2026-11-21")).toBe("finished");
    expect(offListPrompt({ ...listed, eventDate: null, finishedRequestedAt: "2026-11-20T10:00:00Z" }, "2026-11-21")).toBe("finished");
  });

  it("never shows once it is off, or when it was never on Get involved", () => {
    expect(offListPrompt({ ...listed, offListAt: "2027-01-04T10:00:00Z" }, "2027-02-01")).toBeNull();
    expect(offListPrompt({ ...listed, public: false }, "2027-02-01")).toBeNull();
    expect(offListPrompt({ ...listed, status: "finished" }, "2027-02-01")).toBeNull();
    expect(offListPrompt({ ...listed, status: "new" }, "2027-02-01")).toBeNull();
    // An event drops off Get involved by itself the day after it.
    expect(offListPrompt({ ...listed, path: "event" }, "2027-02-01")).toBeNull();
  });

  it("never shows without a date unless they've finished", () => {
    expect(offListPrompt({ ...listed, eventDate: null }, "2027-02-01")).toBeNull();
  });
});

describe("taken off Get involved", () => {
  it("is no longer listed", () => {
    expect(isListed(listed, "2026-12-01")).toBe(true);
    expect(isListed({ ...listed, offListAt: "2027-01-04T10:00:00Z" }, "2026-12-01")).toBe(false);
  });
});
