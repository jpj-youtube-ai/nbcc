import { describe, it, expect } from "vitest";
import {
  whatIsNeeded,
  sortTodos,
  NUDGE_AFTER_DAYS,
  FIND_ADDRESS_AFTER_DAYS,
  type TodoBusiness,
} from "../../src/outreach/todo";

// TASK-405: the one list a busy volunteer opens. Every row on it is somebody about to be
// forgotten, so the rules that put them there are the whole feature - three separate chase lists
// would be three places to forget instead of one.
//
// These tests are written around the businesses that must NOT be dropped, and the ones that must
// NOT appear.

const TODAY = new Date("2026-09-03T09:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000).toISOString();

const base: TodoBusiness = {
  id: 1,
  businessName: "Ayr Joinery Ltd",
  contactEmail: "jane@ayrjoinery.co.uk",
  contactPhone: null,
  owner: null,
  ownerEmail: null,
  sentAt: null,
  nudgeSentAt: null,
  outcome: null,
  outcomeAt: null,
  askAgainOn: null,
  createdAt: daysAgo(30),
};
const need = (over: Partial<TodoBusiness>) => whatIsNeeded({ ...base, ...over }, TODAY);

describe("businesses that must never appear", () => {
  // A decline is an instruction. Putting one on a to-do list is how it gets ignored.
  it("leaves a business that said no alone, for ever", () => {
    expect(need({ outcome: "declined", outcomeAt: daysAgo(400), sentAt: daysAgo(400) })).toBeNull();
  });

  it("leaves one that has signed up alone", () => {
    expect(need({ outcome: "signed_up", outcomeAt: daysAgo(90), sentAt: daysAgo(120) })).toBeNull();
  });

  // A decline outranks a date somebody set before they said no.
  it("keeps a decline off the list even with an ask-again date in the past", () => {
    expect(need({ outcome: "declined", askAgainOn: "2026-01-01", sentAt: daysAgo(300) })).toBeNull();
  });

  it("says nothing about a business emailed only yesterday", () => {
    expect(need({ sentAt: daysAgo(1) })).toBeNull();
  });

  it("says nothing about an ask-again date still in the future", () => {
    expect(need({ outcome: "not_this_year", outcomeAt: daysAgo(40), askAgainOn: "2027-08-01" })).toBeNull();
  });
});

describe("a promise we made", () => {
  // "Not this year" is worth more than a no ONLY if something remembers. This is that something.
  it("brings back a business on the day we said we would", () => {
    const todo = need({ outcome: "not_this_year", outcomeAt: daysAgo(300), askAgainOn: "2026-09-03" })!;
    expect(todo.kind).toBe("ask-again");
    expect(todo.daysOverdue).toBe(0);
  });

  it("counts how late we are", () => {
    expect(need({ outcome: "not_this_year", askAgainOn: "2026-08-24" })!.daysOverdue).toBe(10);
  });

  it("says what to do, in words", () => {
    const todo = need({ outcome: "not_this_year", askAgainOn: "2026-08-24" })!;
    expect(todo.reason).toMatch(/asked us to come back/i);
    expect(todo.action).toMatch(/ask again/i);
  });
});

describe("someone who was interested", () => {
  // The most expensive thing on this screen to lose. A warm business that nobody follows up is
  // worse than one never contacted, because the work is already spent.
  it("puts a warm business in front of someone", () => {
    const todo = need({ outcome: "interested", outcomeAt: daysAgo(9), sentAt: daysAgo(20) })!;
    expect(todo.kind).toBe("call");
  });

  it.each(["interested", "asked_for_info", "passed_on"])("treats %s as warm", (outcome) => {
    expect(need({ outcome, outcomeAt: daysAgo(9), sentAt: daysAgo(20) })!.kind).toBe("call");
  });

  // Silence is not warmth. It does not become a call, and it does not become anything else
  // either: recording "no reply" is a decision, and a decision takes the business OFF the list
  // rather than moving it to another pile. A list full of people who never answered stops
  // being read.
  it("takes a business off the list entirely once no reply is recorded", () => {
    expect(need({ outcome: "no_reply", outcomeAt: daysAgo(9), sentAt: daysAgo(30) })).toBeNull();
  });

  it("offers the phone number where there is one", () => {
    const withPhone = need({ outcome: "interested", outcomeAt: daysAgo(9), contactPhone: "01292 811015" })!;
    expect(withPhone.action).toContain("01292 811015");
    const without = need({ outcome: "interested", outcomeAt: daysAgo(9), contactPhone: null })!;
    expect(without.action).not.toMatch(/call/i);
  });

  // Straight after they replied is too soon to chase; a week later is about right.
  it("waits a few days before nagging about a warm reply", () => {
    expect(need({ outcome: "interested", outcomeAt: daysAgo(2) })).toBeNull();
  });
});

describe("silence after an email", () => {
  it("says nothing until the wait is up", () => {
    expect(need({ sentAt: daysAgo(NUDGE_AFTER_DAYS - 1) })).toBeNull();
  });

  it("asks for a nudge once it is", () => {
    const todo = need({ sentAt: daysAgo(NUDGE_AFTER_DAYS) })!;
    expect(todo.kind).toBe("nudge");
    expect(todo.reason).toMatch(/no reply/i);
  });

  // Recording "no reply" is a decision, not a dead end: it should stop the nagging.
  it("stops once somebody has recorded that there was no reply", () => {
    expect(need({ sentAt: daysAgo(60), outcome: "no_reply", outcomeAt: daysAgo(30) })).toBeNull();
  });

  // One follow-up, ever. The email itself promises to be the last, so the list must stop asking
  // for another however long the silence goes on (TASK-414).
  it("stops chasing once the one follow-up has gone", () => {
    expect(need({ sentAt: daysAgo(60), nudgeSentAt: daysAgo(20) })).toBeNull();
  });

  it("stops even when the silence since the follow-up is longer than the wait", () => {
    expect(need({ sentAt: daysAgo(300), nudgeSentAt: daysAgo(200) })).toBeNull();
  });
});

describe("businesses that never got as far as an email", () => {
  it("flags one that is ready to send", () => {
    const todo = need({ sentAt: null, contactEmail: "jane@ayrjoinery.co.uk", createdAt: daysAgo(3) })!;
    expect(todo.kind).toBe("send");
    expect(todo.action).toMatch(/send/i);
  });

  // Added from a phone call with no address is normal. Added and forgotten is not.
  it("says nothing about one added today with no address", () => {
    expect(need({ sentAt: null, contactEmail: null, createdAt: daysAgo(1) })).toBeNull();
  });

  it("asks somebody to find an address once it has sat there", () => {
    const todo = need({ sentAt: null, contactEmail: null, createdAt: daysAgo(FIND_ADDRESS_AFTER_DAYS) })!;
    expect(todo.kind).toBe("find-address");
    expect(todo.reason).toMatch(/no email address/i);
  });
});

describe("what comes first", () => {
  const todos = [
    need({ sentAt: daysAgo(20) })!,                                                   // nudge
    need({ outcome: "not_this_year", askAgainOn: "2026-08-01" })!,                    // ask-again
    need({ sentAt: null, contactEmail: "a@b.co", createdAt: daysAgo(3) })!,           // send
    need({ outcome: "interested", outcomeAt: daysAgo(9) })!,                          // call
  ];

  // A promise we made outranks a chase; a warm business outranks a cold one. Sorting by date
  // alone would bury the two that actually matter under whatever happened to be oldest.
  it("puts promises first, then warm businesses, then the rest", () => {
    expect(sortTodos(todos).map((t) => t.kind)).toEqual(["ask-again", "call", "nudge", "send"]);
  });

  it("puts the most overdue first within a kind", () => {
    const a = need({ sentAt: daysAgo(40) })!;
    const b = need({ sentAt: daysAgo(20) })!;
    expect(sortTodos([b, a])[0].daysOverdue).toBeGreaterThan(sortTodos([b, a])[1].daysOverdue);
  });
});

describe("the numbers behind it", () => {
  // Two weeks: long enough that a business on holiday has had a fair chance, short enough that
  // the trail is still warm when somebody follows up.
  it("waits two weeks before calling an email unanswered", () => {
    expect(NUDGE_AFTER_DAYS).toBe(14);
  });

  it("waits a week before chasing a missing address", () => {
    expect(FIND_ADDRESS_AFTER_DAYS).toBe(7);
  });
});
