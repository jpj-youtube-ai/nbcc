import { describe, expect, it } from "vitest";
import {
  chaseDay,
  isIncomplete,
  LIST_DAYS,
  missing,
  planList,
  planReminders,
  REMINDER_DAYS,
  type ChaseBooking,
} from "../../src/ball/chase";
import type { MenuCourse } from "../../src/ball/menu";

// All the people, addresses and numbers here are invented.

const MENU: MenuCourse[] = [
  { name: "Starter", options: ["Soup", "Melon"] },
  { name: "Main", options: ["Pie", "Salmon", "Nut roast"] },
  { name: "Coffee", options: [] },
];
const NO_CHOICE_MENU: MenuCourse[] = [{ name: "Coffee", options: [] }];

const BOTH = "Starter: Soup\nMain: Pie";
const ONLY_MAIN = "Main: Pie";

const LOCK = new Date("2026-11-04T10:00:00Z");
const BALL = "2026-11-07";

function booking(over: Partial<ChaseBooking> = {}): ChaseBooking {
  return {
    id: 1,
    reference: "BALL-0001",
    status: "paid",
    paymentMethod: "card",
    buyerName: "Ada Example",
    buyerFirstName: "Ada",
    buyerEmail: "ada@example.com",
    buyerPhone: "07000 000001",
    guestToken: "tok-1",
    seats: 2,
    choices: [BOTH, BOTH],
    reminderSentOn: null,
    ...over,
  };
}

describe("the day constants", () => {
  it("remind on days 7, 5, 3, 1 and list on those and the deadline day", () => {
    expect(REMINDER_DAYS).toEqual([7, 5, 3, 1]);
    expect(LIST_DAYS).toEqual([7, 5, 3, 1, 0]);
  });
});

describe("chaseDay", () => {
  const at = (iso: string) => chaseDay(new Date(iso), LOCK, BALL);

  it("goes on the round days before the deadline", () => {
    expect(at("2026-10-28T08:00:00Z")).toEqual({ daysToDeadline: 7, reminder: true, list: true });
    expect(at("2026-10-30T08:00:00Z")).toEqual({ daysToDeadline: 5, reminder: true, list: true });
    expect(at("2026-11-01T08:00:00Z")).toEqual({ daysToDeadline: 3, reminder: true, list: true });
    expect(at("2026-11-03T08:00:00Z")).toEqual({ daysToDeadline: 1, reminder: true, list: true });
  });

  it("sends only the list on the deadline day itself", () => {
    expect(at("2026-11-04T08:00:00Z")).toEqual({ daysToDeadline: 0, reminder: false, list: true });
  });

  it("is quiet on the days in between and after the deadline", () => {
    expect(at("2026-10-29T08:00:00Z")).toBeNull();
    expect(at("2026-10-31T08:00:00Z")).toBeNull();
    expect(at("2026-11-02T08:00:00Z")).toBeNull();
    expect(at("2026-11-05T08:00:00Z")).toBeNull();
  });

  it("is quiet when no deadline is set", () => {
    expect(chaseDay(new Date("2026-10-28T08:00:00Z"), null, BALL)).toBeNull();
  });

  it("counts by the day in London, not by hours", () => {
    // 23:30 in London on the 27th is 8 days out, although it is under 7 days 11 hours to the deadline.
    expect(at("2026-10-27T23:30:00Z")).toBeNull();
    // Just after midnight London time on the 28th is day 7.
    expect(at("2026-10-28T00:05:00Z")).toEqual({ daysToDeadline: 7, reminder: true, list: true });
  });

  it("counts the London day while summer time is still on", () => {
    // 23:30 UTC on 2026-09-29 is 00:30 on the 30th in London (BST).
    const lock = new Date("2026-10-07T09:00:00Z");
    expect(chaseDay(new Date("2026-09-29T23:30:00Z"), lock, "2026-10-10")).toEqual({
      daysToDeadline: 7,
      reminder: true,
      list: true,
    });
  });

  it("never goes on or after the Ball, even if the deadline is later", () => {
    const late = new Date("2026-11-08T10:00:00Z");
    expect(chaseDay(new Date("2026-11-06T08:00:00Z"), late, BALL)).toBeNull(); // 2 days out: not a round day
    expect(chaseDay(new Date("2026-11-07T08:00:00Z"), late, BALL)).toBeNull(); // 1 day out but it is the Ball
    expect(chaseDay(new Date("2026-11-08T08:00:00Z"), late, BALL)).toBeNull();
  });

  it("still goes before the Ball when the deadline is late", () => {
    const late = new Date("2026-11-08T10:00:00Z");
    expect(chaseDay(new Date("2026-11-05T08:00:00Z"), late, BALL)).toEqual({
      daysToDeadline: 3,
      reminder: true,
      list: true,
    });
  });
});

describe("missing and isIncomplete", () => {
  it("counts unnamed seats and named guests who have not chosen", () => {
    const b = booking({ seats: 10, choices: [BOTH, ONLY_MAIN, null] });
    expect(missing(b, MENU)).toEqual({ unnamed: 7, unchosen: 2 });
    expect(isIncomplete(b, MENU)).toBe(true);
  });

  it("counts only names when the menu has nothing to choose", () => {
    const b = booking({ seats: 10, choices: [null, ONLY_MAIN, null] });
    expect(missing(b, NO_CHOICE_MENU)).toEqual({ unnamed: 7, unchosen: 0 });
    expect(missing(b, [])).toEqual({ unnamed: 7, unchosen: 0 });
  });

  it("is complete when every seat is named and every guest has chosen", () => {
    const b = booking({ seats: 2, choices: [BOTH, BOTH] });
    expect(missing(b, MENU)).toEqual({ unnamed: 0, unchosen: 0 });
    expect(isIncomplete(b, MENU)).toBe(false);
  });

  it("is incomplete for a single unchosen guest with every seat named", () => {
    const b = booking({ seats: 2, choices: [BOTH, null] });
    expect(missing(b, MENU)).toEqual({ unnamed: 0, unchosen: 1 });
    expect(isIncomplete(b, MENU)).toBe(true);
  });

  it("is complete with no choosable course once every seat is named", () => {
    const b = booking({ seats: 2, choices: [null, null] });
    expect(isIncomplete(b, NO_CHOICE_MENU)).toBe(false);
  });

  it("never reports a negative unnamed count", () => {
    const b = booking({ seats: 1, choices: [BOTH, BOTH] });
    expect(missing(b, MENU).unnamed).toBe(0);
  });
});

describe("planReminders", () => {
  const TODAY = "2026-10-30";
  const incomplete = (over: Partial<ChaseBooking> = {}) => booking({ choices: [BOTH, null], ...over });

  it("groups bookings by lower-cased trimmed email and leaves out the complete ones", () => {
    const groups = planReminders(
      [
        incomplete({ id: 1, reference: "BALL-0001", buyerEmail: "A@Example.com" }),
        booking({ id: 2, reference: "BALL-0002", buyerEmail: "a@example.com" }),
        incomplete({ id: 3, reference: "BALL-0003", buyerEmail: " a@example.com ", seats: 4, choices: [BOTH] }),
      ],
      MENU,
      TODAY,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].email).toBe("a@example.com");
    expect(groups[0].bookings.map((b) => b.reference)).toEqual(["BALL-0001", "BALL-0003"]);
    expect(groups[0].bookings[0]).toMatchObject({ unnamed: 0, unchosen: 1 });
    expect(groups[0].bookings[1]).toMatchObject({ unnamed: 3, unchosen: 0 });
  });

  it("makes one group per address", () => {
    const groups = planReminders(
      [
        incomplete({ id: 1, buyerEmail: "ada@example.com" }),
        incomplete({ id: 2, reference: "BALL-0002", buyerEmail: "ben@example.com", buyerFirstName: "Ben" }),
      ],
      MENU,
      TODAY,
    );
    expect(groups.map((g) => g.email)).toEqual(["ada@example.com", "ben@example.com"]);
  });

  it("leaves out a booker whose week-to-go email went today, and keeps one whose went earlier", () => {
    const groups = planReminders(
      [
        incomplete({ id: 1, buyerEmail: "ada@example.com", reminderSentOn: TODAY }),
        incomplete({ id: 2, reference: "BALL-0002", buyerEmail: "ben@example.com", reminderSentOn: "2026-10-28" }),
      ],
      MENU,
      TODAY,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].bookings.map((b) => b.id)).toEqual([2]);
  });

  // The rule is per ADDRESS, not per booking: one booker must never get two Ball emails in a morning.
  it("leaves out the whole address when any of its bookings had the week-to-go email today", () => {
    const groups = planReminders(
      [
        // Booking A: still incomplete, its week-to-go email went earlier.
        incomplete({ id: 1, buyerEmail: "ada@example.com", reminderSentOn: "2026-10-28" }),
        // Booking B: complete, its week-to-go email went this morning, with a different spelling of the address.
        booking({ id: 2, reference: "BALL-0002", buyerEmail: " ADA@example.com ", reminderSentOn: TODAY }),
        // Someone else at another address is unaffected.
        incomplete({ id: 3, reference: "BALL-0003", buyerEmail: "ben@example.com" }),
      ],
      MENU,
      TODAY,
    );
    expect(groups.map((g) => g.email)).toEqual(["ben@example.com"]);
  });

  it("still leaves out the address when the booking stamped today is incomplete itself, and the other is not stamped", () => {
    const groups = planReminders(
      [incomplete({ id: 1, reminderSentOn: TODAY }), incomplete({ id: 2, reference: "BALL-0002" })],
      MENU,
      TODAY,
    );
    expect(groups).toEqual([]);
  });

  it("never includes pending, no-email or no-token bookings", () => {
    const groups = planReminders(
      [
        incomplete({ id: 1, status: "pending", paymentMethod: "transfer" }),
        incomplete({ id: 2, buyerEmail: "" }),
        incomplete({ id: 3, buyerEmail: "   " }),
        incomplete({ id: 4, guestToken: null }),
      ],
      MENU,
      TODAY,
    );
    expect(groups).toEqual([]);
  });

  it("uses the first booking's first name, else the first word of the buyer name, else there", () => {
    const [byFirst] = planReminders(
      [
        incomplete({ id: 1, buyerFirstName: "Ada" }),
        incomplete({ id: 2, reference: "BALL-0002", buyerFirstName: "Other" }),
      ],
      MENU,
      TODAY,
    );
    expect(byFirst.firstName).toBe("Ada");

    const [byName] = planReminders([incomplete({ buyerFirstName: null, buyerName: "Cara  Example Jones" })], MENU, TODAY);
    expect(byName.firstName).toBe("Cara");

    const [blank] = planReminders([incomplete({ buyerFirstName: null, buyerName: "   " })], MENU, TODAY);
    expect(blank.firstName).toBe("there");
  });
});

describe("planList", () => {
  const sample = () => [
    // Emailable, incomplete: 1 + 1 = 2 missing.
    booking({ id: 1, reference: "BALL-0003", seats: 2, choices: [BOTH, null] }),
    // Emailable, incomplete: 3 missing, so it comes first.
    booking({ id: 2, reference: "BALL-0009", seats: 4, choices: [BOTH] }),
    // Emailable, incomplete, 2 missing, ties with BALL-0003 and sorts after it by reference.
    booking({ id: 3, reference: "BALL-0004", seats: 2, choices: [null, BOTH] }),
    // Complete.
    booking({ id: 4, reference: "BALL-0005", seats: 2, choices: [BOTH, BOTH] }),
    // Paid but cannot be emailed.
    booking({ id: 5, reference: "BALL-0006", buyerEmail: "", seats: 3, choices: [] }),
    booking({ id: 6, reference: "BALL-0007", guestToken: null, seats: 2, choices: [BOTH] }),
    // Awaiting payment by transfer: everything counts as unnamed.
    booking({ id: 7, reference: "BALL-0008", status: "pending", paymentMethod: "transfer", seats: 5, choices: [BOTH] }),
    booking({ id: 8, reference: "BALL-0002", status: "pending", paymentMethod: "transfer", seats: 6, choices: [] }),
    // Pending by card: not on the list at all.
    booking({ id: 9, reference: "BALL-0010", status: "pending", paymentMethod: "card", seats: 2, choices: [] }),
  ];

  it("splits into the three sections, most missing first then by reference", () => {
    const list = planList(sample(), MENU);
    expect(list.toChase.map((r) => r.reference)).toEqual(["BALL-0009", "BALL-0003", "BALL-0004"]);
    expect(list.cannotEmail.map((r) => r.reference)).toEqual(["BALL-0006", "BALL-0007"]);
    expect(list.awaitingPayment.map((r) => r.reference)).toEqual(["BALL-0002", "BALL-0008"]);
  });

  it("counts every seat as unnamed for a booking awaiting payment", () => {
    const list = planList(sample(), MENU);
    expect(list.awaitingPayment[0]).toMatchObject({ reference: "BALL-0002", unnamed: 6, unchosen: 0 });
    expect(list.awaitingPayment[1]).toMatchObject({ reference: "BALL-0008", unnamed: 5, unchosen: 0 });
  });

  it("carries the missing counts on each row", () => {
    const list = planList(sample(), MENU);
    expect(list.toChase[0]).toMatchObject({ unnamed: 3, unchosen: 0 });
    expect(list.toChase[1]).toMatchObject({ unnamed: 0, unchosen: 1 });
  });

  it("counts the paid bookings that are complete", () => {
    expect(planList(sample(), MENU).complete).toBe(1);
  });

  it("totals the seats still unnamed and guests still to choose over paid bookings", () => {
    const list = planList(sample(), MENU);
    // toChase: unnamed 3 + 0 + 1; cannotEmail: 3 + 1. Awaiting payment is not counted.
    expect(list.unnamed).toBe(3 + 0 + 0 + 3 + 1);
    // toChase: 0 + 1 + 1; cannotEmail: 0 + 0.
    expect(list.unchosen).toBe(2);
  });

  it("includes a booking that has not had a reminder yet, whatever its reminderSentOn", () => {
    const list = planList([booking({ seats: 2, choices: [BOTH], reminderSentOn: "2026-10-30" })], MENU);
    expect(list.toChase).toHaveLength(1);
  });

  it("is empty for no bookings", () => {
    expect(planList([], MENU)).toEqual({
      toChase: [],
      cannotEmail: [],
      awaitingPayment: [],
      complete: 0,
      unnamed: 0,
      unchosen: 0,
    });
  });

  it("leaves out a pending booking that is not a bank transfer", () => {
    const list = planList([booking({ status: "pending", paymentMethod: "card", choices: [] })], MENU);
    expect(list.awaitingPayment).toEqual([]);
    expect(list.toChase).toEqual([]);
  });
});
