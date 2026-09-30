import { describe, it, expect } from "vitest";
import {
  londonDate,
  londonWeekday,
  nextUpdateAfter,
  daysToGo,
  reportDue,
  recipientsSchema,
  renderReport,
  MAX_RECIPIENTS,
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
  it("is the next Tuesday or Thursday", () => {
    expect(nextUpdateAfter("2026-10-06", EVENT)).toBe("2026-10-08"); // Tuesday to Thursday
    expect(nextUpdateAfter("2026-10-08", EVENT)).toBe("2026-10-13"); // Thursday to Tuesday
    expect(nextUpdateAfter("2026-10-07", EVENT)).toBe("2026-10-08"); // a Wednesday test send
    expect(nextUpdateAfter("2026-11-03", EVENT)).toBe("2026-11-05");
  });

  it("does not exist after the Thursday before the Ball", () => {
    expect(nextUpdateAfter("2026-11-05", EVENT)).toBeNull(); // Tuesday 10 November is after the Ball
  });

  it("counts the days to go", () => {
    expect(daysToGo("2026-10-06", EVENT)).toBe(32);
    expect(daysToGo("2026-11-07", EVENT)).toBe(0);
  });
});

describe("whether a report is due", () => {
  const due = (at: string, over: Partial<Parameters<typeof reportDue>[0]> = {}) =>
    reportDue({ now: new Date(at), reportOn: true, recipients: 2, eventDate: EVENT, sentToday: false, ...over });

  it("is due on Tuesday and Thursday mornings, and on no other day", () => {
    expect(due("2026-10-06T07:00:00Z")).toBe(true); // Tuesday 8am BST
    expect(due("2026-10-08T07:00:00Z")).toBe(true); // Thursday
    for (const other of ["2026-10-04", "2026-10-05", "2026-10-07", "2026-10-09", "2026-10-10"]) {
      expect(due(`${other}T07:00:00Z`), other).toBe(false);
    }
  });

  it("waits for the switch, a recipient, and a day not already sent", () => {
    expect(due("2026-10-06T07:00:00Z", { reportOn: false })).toBe(false);
    expect(due("2026-10-06T07:00:00Z", { recipients: 0 })).toBe(false);
    expect(due("2026-10-06T07:00:00Z", { sentToday: true })).toBe(false);
  });

  it("stops once the Ball is past", () => {
    expect(due("2026-11-05T08:00:00Z")).toBe(true); // the Thursday before, in GMT again
    expect(due("2026-11-10T08:00:00Z")).toBe(false); // the Tuesday after
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
      expect(body).toContain("Nobody on the waiting list yet");
      expect(body).toContain("32 days to go");
    }
  });

  it("gets singular and plural right, and says so when it is the first update", () => {
    const { text } = renderReport(
      { ...INPUTS, seatsSold: 11, tablesSold: 1, singleSeatsSold: 1, soldSinceLast: null, waitingList: 1, heldSeats: 0 },
      { ...TUESDAY, today: "2026-11-05" },
    );
    expect(text).toContain("1 whole table and 1 single seat");
    expect(text).toContain("This is the first update");
    expect(text).toContain("1 person on the waiting list");
    expect(text).not.toContain("kept back");
    expect(text).toContain("2 days to go");
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
