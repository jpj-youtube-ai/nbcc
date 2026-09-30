import { describe, it, expect } from "vitest";
import {
  londonDate,
  londonWeekday,
  nextUpdateAfter,
  nextSendDay,
  daysToGo,
  reportDue,
  recipientsSchema,
  renderReport,
  countSales,
  MAX_RECIPIENTS,
  type BookingRow,
  type SalesInputs,
} from "../../src/ball/sales-report";
import { BALL_TEXT_FOOTER } from "../../src/ball/email-shell";

// TASK-464: the Festive Ball ticket report, twice a week to the organiser and the sponsor. Counts
// only: no names, no emails, no booking details, no money. Every address here is invented.

const EVENT = "2026-11-07"; // Saturday 7 November 2026

const INPUTS: SalesInputs = {
  totalSeats: 400,
  seatsSold: 212,
  tablesSold: 14,
  singleSeatsSold: 72,
  seatsRemaining: 168,
  tablesRemaining: 12,
  heldSeats: 20,
  soldSinceLast: 18,
  soldLast7Days: 30,
  soldPrevious7Days: 22,
  waitingList: 0,
  waitingSeats: 0,
};
const TUESDAY = { today: "2026-10-06", eventDate: EVENT, test: false };

// The words a reader sees, without the shell's own footer: the house style applies to what we wrote.
const ourText = (text: string) => text.split(BALL_TEXT_FOOTER)[0];

describe("the day, where the charity is", () => {
  it("reads the date and weekday in the UK, not in UTC", () => {
    // 23:30 UTC on Monday 5 October is 00:30 on Tuesday 6 October in British Summer Time.
    expect(londonDate(new Date("2026-10-05T23:30:00Z"))).toBe("2026-10-06");
    expect(londonWeekday(new Date("2026-10-05T23:30:00Z"))).toBe(2);
    expect(londonWeekday(new Date("2026-10-08T07:00:00Z"))).toBe(4);
  });
});

describe("the next update", () => {
  it("is the next Monday or Thursday", () => {
    expect(nextUpdateAfter("2026-10-05", EVENT)).toBe("2026-10-08"); // Monday to Thursday
    expect(nextUpdateAfter("2026-10-08", EVENT)).toBe("2026-10-12"); // Thursday to Monday
    expect(nextUpdateAfter("2026-10-06", EVENT)).toBe("2026-10-08"); // a Tuesday test send
    expect(nextUpdateAfter("2026-10-10", EVENT)).toBe("2026-10-12"); // a Saturday test send
    expect(nextUpdateAfter("2026-11-02", EVENT)).toBe("2026-11-05");
  });

  it("does not exist after the Thursday before the Ball", () => {
    expect(nextUpdateAfter("2026-11-05", EVENT)).toBeNull(); // Monday 9 November is after the Ball
  });

  it("counts the days to go", () => {
    expect(daysToGo("2026-10-06", EVENT)).toBe(32);
    expect(daysToGo("2026-11-07", EVENT)).toBe(0);
  });
});

describe("when the next report goes, as the admin shows it", () => {
  const at = (iso: string, sentToday = false) => nextSendDay({ now: new Date(iso), eventDate: EVENT, sentToday });

  it("is this morning on a report day before 8am, if it has not gone yet", () => {
    expect(at("2026-10-05T06:30:00Z")).toBe("2026-10-05"); // 7.30am BST on a Monday
  });

  it("is the next report day once this morning's has gone, or 8am has passed", () => {
    expect(at("2026-10-05T06:30:00Z", true)).toBe("2026-10-08");
    expect(at("2026-10-05T09:00:00Z")).toBe("2026-10-08"); // 10am BST: the 8am job has run
    expect(at("2026-10-06T06:30:00Z")).toBe("2026-10-08"); // a Tuesday
    expect(at("2026-10-08T09:00:00Z")).toBe("2026-10-12"); // Thursday after 8am: next Monday
  });

  it("is nothing once the last report before the Ball is past", () => {
    expect(at("2026-11-05T09:00:00Z")).toBeNull();
  });
});

describe("whether a report is due", () => {
  const due = (at: string, over: Partial<Parameters<typeof reportDue>[0]> = {}) =>
    reportDue({ now: new Date(at), reportOn: true, recipients: 2, eventDate: EVENT, sentToday: false, ...over });

  it("is due on Monday and Thursday mornings, and on no other day", () => {
    expect(due("2026-10-05T07:00:00Z")).toBe(true); // Monday 8am BST
    expect(due("2026-10-08T07:00:00Z")).toBe(true); // Thursday
    for (const other of ["2026-10-04", "2026-10-06", "2026-10-07", "2026-10-09", "2026-10-10"]) {
      expect(due(`${other}T07:00:00Z`), other).toBe(false);
    }
  });

  it("waits for the switch, a recipient, and a day not already sent", () => {
    expect(due("2026-10-05T07:00:00Z", { reportOn: false })).toBe(false);
    expect(due("2026-10-05T07:00:00Z", { recipients: 0 })).toBe(false);
    expect(due("2026-10-05T07:00:00Z", { sentToday: true })).toBe(false);
  });

  it("stops once the Ball is past", () => {
    expect(due("2026-11-05T08:00:00Z")).toBe(true); // the Thursday before, in GMT again
    expect(due("2026-11-09T08:00:00Z")).toBe(false); // the Monday after
  });
});

describe("the recipients", () => {
  it("tidies each address, keeps each name, and lists them alphabetically by name", () => {
    expect(
      recipientsSchema.parse([
        { email: " Cal@Sponsor.EXAMPLE ", name: " Cal " },
        { email: "alex@example.com", name: "Alex" },
        { email: "dana@example.com", name: "dana" },
        { email: "bea@example.com", name: "Bea" },
      ]),
    ).toEqual([
      { email: "alex@example.com", name: "Alex" },
      { email: "bea@example.com", name: "Bea" },
      { email: "cal@sponsor.example", name: "Cal" },
      { email: "dana@example.com", name: "dana" },
    ]);
  });

  it("refuses a bad address, a repeat, a missing or long name, and more than the limit", () => {
    const one = (email: string, name: string) => recipientsSchema.safeParse([{ email, name }]).success;
    expect(one("not an address", "Pat")).toBe(false);
    expect(one("pat@example.com", "  ")).toBe(false);
    expect(one("pat@example.com", "x".repeat(61))).toBe(false);
    expect(
      recipientsSchema.safeParse([
        { email: "pat@example.com", name: "Pat" },
        { email: "PAT@example.com", name: "Patricia" },
      ]).success,
    ).toBe(false);
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => ({ email: `p${i}@example.com`, name: `Person ${i}` }));
    expect(recipientsSchema.safeParse(many).success).toBe(false);
  });
});

// The numbers themselves: what counts as sold, and which sales fall in which window. Pure, so the
// rules the sponsor reads are tested here rather than only in SQL.
describe("the numbers, counted from the bookings", () => {
  const NOW = new Date("2026-10-06T07:00:00Z"); // 8am in the UK, Tuesday 6 October
  const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
  const BOOKINGS: BookingRow[] = [
    { kind: "table", status: "paid", quantity: 2, seats: 20, paidAt: ago(20) },
    { kind: "seat", status: "paid", quantity: 3, seats: 3, paidAt: ago(10) },
    { kind: "table", status: "paid", quantity: 1, seats: 10, paidAt: ago(3) },
    { kind: "seat", status: "paid", quantity: 2, seats: 2, paidAt: ago(1) },
  ];

  it("counts every paid seat, the whole tables, and the single seats", () => {
    expect(countSales(BOOKINGS, { now: NOW, since: null })).toEqual({
      seatsSold: 35,
      tablesSold: 3,
      singleSeatsSold: 5,
      soldSinceLast: null,
      soldLast7Days: 12,
      soldPrevious7Days: 3,
    });
  });

  it("does not count a booking that is waiting for payment, refunded or cancelled", () => {
    const others: BookingRow[] = [
      { kind: "table", status: "pending", quantity: 1, seats: 10, paidAt: null },
      { kind: "seat", status: "refunded", quantity: 4, seats: 4, paidAt: ago(2) },
      { kind: "table", status: "cancelled", quantity: 1, seats: 10, paidAt: ago(2) },
    ];
    expect(countSales([...BOOKINGS, ...others], { now: NOW, since: ago(5) })).toEqual(
      countSales(BOOKINGS, { now: NOW, since: ago(5) }),
    );
  });

  it("counts what sold since the last update", () => {
    expect(countSales(BOOKINGS, { now: NOW, since: ago(2) }).soldSinceLast).toBe(2);
    expect(countSales(BOOKINGS, { now: NOW, since: ago(4) }).soldSinceLast).toBe(12);
    expect(countSales(BOOKINGS, { now: NOW, since: ago(0) }).soldSinceLast).toBe(0);
  });

  it("puts a sale exactly 7 days back in the week before, never in both", () => {
    const edge: BookingRow[] = [{ kind: "seat", status: "paid", quantity: 1, seats: 1, paidAt: ago(7) }];
    expect(countSales(edge, { now: NOW, since: null })).toMatchObject({ soldLast7Days: 0, soldPrevious7Days: 1 });
  });

  it("counts up to its own moment, so a sale a second later is in the next update, once", () => {
    const late: BookingRow = { kind: "seat", status: "paid", quantity: 1, seats: 1, paidAt: new Date(NOW.getTime() + 1000) };
    const tuesday = countSales([...BOOKINGS, late], { now: NOW, since: ago(4) });
    expect(tuesday.seatsSold).toBe(35);
    expect(tuesday.soldSinceLast).toBe(12);
    const thursday = countSales([...BOOKINGS, late], { now: new Date(NOW.getTime() + 2 * 86_400_000), since: NOW });
    expect(thursday.seatsSold).toBe(36);
    expect(thursday.soldSinceLast).toBe(1);
  });

  it("counts a paid booking with no payment time in the totals, and in no window", () => {
    const manual: BookingRow = { kind: "table", status: "paid", quantity: 1, seats: 10, paidAt: null };
    const out = countSales([...BOOKINGS, manual], { now: NOW, since: ago(30) });
    expect(out).toMatchObject({ seatsSold: 45, tablesSold: 4, soldSinceLast: 35, soldLast7Days: 12, soldPrevious7Days: 3 });
  });
});

describe("the email", () => {
  it("is headed with the day and date", () => {
    expect(renderReport(INPUTS, TUESDAY).subject).toBe("Festive Ball tickets: Tuesday 6 October update");
    expect(renderReport(INPUTS, { ...TUESDAY, test: true }).subject).toBe(
      "[Test] Festive Ball tickets: Tuesday 6 October update",
    );
  });

  it("opens by saying when the next one comes and how to reach us", () => {
    const { html, text } = renderReport(INPUTS, TUESDAY);
    for (const body of [html, text]) {
      expect(body).toContain("Hello,");
      expect(body).toContain("Your next update will be on Thursday 8 October.");
      expect(body).toContain("Any questions in the meantime, call us on 01292 811 015 or email events@nbcc.scot.");
    }
    expect(text.indexOf("Your next update")).toBeLessThan(text.indexOf("212 of 400"));
  });

  it("says it is the last one on the Thursday before the Ball", () => {
    const { text } = renderReport(INPUTS, { ...TUESDAY, today: "2026-11-05" });
    expect(text).toContain("This is the last update before the Ball on Saturday 7 November.");
    expect(text).not.toContain("Your next update");
  });

  it("gives every number", () => {
    const { html, text } = renderReport(INPUTS, TUESDAY);
    for (const body of [html, text]) {
      expect(body).toContain("212 of 400 seats (53%)");
      expect(body).toContain("14 whole tables and 72 single seats");
      expect(body).toContain("18 seats since the last update");
      expect(body).toContain("30 seats in the last 7 days (the 7 days before: 22)");
      expect(body).toContain("168 seats, including 12 whole tables");
      expect(body).toContain("20 seats are kept back for guests");
      expect(body).toContain("Nobody on the waiting list");
      expect(body).toContain("32 days to go");
    }
  });

  it("gets singular and plural right, and says so when it is the first update", () => {
    const { text } = renderReport(
      {
        ...INPUTS,
        seatsSold: 11,
        tablesSold: 1,
        singleSeatsSold: 1,
        soldSinceLast: null,
        waitingList: 1,
        waitingSeats: 1,
        heldSeats: 0,
      },
      { ...TUESDAY, today: "2026-11-05" },
    );
    expect(text).toContain("1 whole table and 1 single seat");
    expect(text).toContain("This is the first update");
    expect(text).toContain("1 person on the waiting list, wanting 1 seat");
    expect(text).not.toContain("kept back");
    expect(text).toContain("2 days to go");
  });

  it("never rounds up to 100% before the last seat is sold", () => {
    const nearly = renderReport({ ...INPUTS, seatsSold: 399, seatsRemaining: 1, tablesRemaining: 0 }, TUESDAY).text;
    expect(nearly).toContain("399 of 400 seats (99%)");
    const all = renderReport({ ...INPUTS, seatsSold: 400, seatsRemaining: 0, tablesRemaining: 0 }, TUESDAY).text;
    expect(all).toContain("400 of 400 seats (100%)");
  });

  it("says so when there are no whole tables left, and when the Ball is sold out", () => {
    const noTables = renderReport({ ...INPUTS, seatsRemaining: 3, tablesRemaining: 0 }, TUESDAY).text;
    expect(noTables).toContain("3 seats, but no whole tables");
    expect(noTables).not.toContain("0 whole tables");
    const soldOut = renderReport({ ...INPUTS, seatsRemaining: 0, tablesRemaining: 0 }, TUESDAY).text;
    expect(soldOut).toContain("Sold out");
    expect(soldOut).not.toMatch(/\b0 seats/);
  });

  it("gives the waiting list as people and the seats they want", () => {
    const { html, text } = renderReport({ ...INPUTS, waitingList: 3, waitingSeats: 14 }, TUESDAY);
    for (const body of [html, text]) expect(body).toContain("3 people on the waiting list, wanting 14 seats");
  });

  it("makes sense on the day of the Ball and after it, where only a preview or a test can go", () => {
    const onTheDay = renderReport(INPUTS, { ...TUESDAY, today: EVENT }).text;
    expect(onTheDay).toContain("The Ball is tonight");
    expect(onTheDay).not.toContain("0 days");
    expect(onTheDay).toContain("There are no more updates planned.");
    const after = renderReport(INPUTS, { ...TUESDAY, today: "2026-11-10" }).text;
    expect(after).toContain("The Ball was on Saturday 7 November");
    expect(after).not.toMatch(/-\d+ days/);
    expect(after).not.toContain("last update before the Ball");
  });

  it("carries no money and no one's details, only our own inbox", () => {
    const { html, text } = renderReport(INPUTS, TUESDAY);
    for (const body of [html, text]) {
      expect(body).not.toMatch(/£/);
      const addresses = body.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
      expect(new Set(addresses)).toEqual(new Set(["events@nbcc.scot"]));
    }
  });

  it("says a test is a test, to the person who sent it", () => {
    expect(renderReport(INPUTS, { ...TUESDAY, test: true }).text).toContain("This is a test, sent only to you.");
    expect(renderReport(INPUTS, TUESDAY).text).not.toContain("This is a test");
  });

  it("keeps the house style: no hyphens between words, no dashes", () => {
    const words = ourText(renderReport(INPUTS, TUESDAY).text);
    expect(words).not.toMatch(/[A-Za-z]-[A-Za-z]/);
    expect(words).not.toMatch(/[–—]/);
  });

  it("wears the Ball's own frame", () => {
    const { html, text } = renderReport(INPUTS, TUESDAY);
    expect(html).toContain("The Designer Rooms");
    expect(text).toContain(BALL_TEXT_FOOTER);
  });
});
