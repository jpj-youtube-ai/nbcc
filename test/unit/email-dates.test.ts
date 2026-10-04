import { describe, it, expect } from "vitest";
import { emailDate, ordinal, raiseOrdinals } from "../../src/email/dates";

// The one date style every fundraising, team, pledge, ticket, Ball and staff email uses:
// "Saturday 7th November", with the year where one is shown. The st, nd, rd or th is plain in a
// subject, a plain text part and anything else that cannot carry markup, and raised in an HTML body.

describe("ordinal", () => {
  it("ends 1, 2 and 3 with st, nd and rd", () => {
    expect([1, 2, 3].map(ordinal)).toEqual(["1st", "2nd", "3rd"]);
  });

  it("ends the teens with th", () => {
    expect([11, 12, 13].map(ordinal)).toEqual(["11th", "12th", "13th"]);
  });

  it("ends 21, 22, 23 and 31 with st, nd, rd and st", () => {
    expect([21, 22, 23, 31].map(ordinal)).toEqual(["21st", "22nd", "23rd", "31st"]);
  });

  it("ends everything else with th", () => {
    expect([4, 7, 10, 20, 24, 30].map(ordinal)).toEqual(["4th", "7th", "10th", "20th", "24th", "30th"]);
  });
});

describe("emailDate", () => {
  it("writes a stored day as the weekday, the day with its ending, and the month", () => {
    expect(emailDate("2026-11-07")).toBe("Saturday 7th November");
  });

  it("adds the year when asked", () => {
    expect(emailDate("2026-11-07", { year: true })).toBe("Saturday 7th November 2026");
  });

  it("leaves the weekday out when asked", () => {
    expect(emailDate("2026-11-01", { weekday: false, year: true })).toBe("1st November 2026");
  });

  it("reads a moment in time as the day it is in the UK", () => {
    // 23:30 UTC on 24 October 2026 is 00:30 on the 25th in the UK (still summer time).
    expect(emailDate(new Date("2026-10-24T23:30:00Z"))).toBe("Sunday 25th October");
    expect(emailDate(new Date("2026-11-01T10:00:00Z"), { weekday: false, year: true })).toBe("1st November 2026");
  });

  it("gets every awkward ending right", () => {
    expect(emailDate("2026-12-11")).toBe("Friday 11th December");
    expect(emailDate("2026-12-12")).toBe("Saturday 12th December");
    expect(emailDate("2026-12-13")).toBe("Sunday 13th December");
    expect(emailDate("2026-12-21")).toBe("Monday 21st December");
    expect(emailDate("2026-12-22")).toBe("Tuesday 22nd December");
    expect(emailDate("2026-12-23")).toBe("Wednesday 23rd December");
    expect(emailDate("2026-12-31")).toBe("Thursday 31st December");
  });
});

describe("raiseOrdinals", () => {
  it("raises the ending of a day that is followed by its month", () => {
    expect(raiseOrdinals("<p>on Saturday 7th November 2026</p>")).toBe("<p>on Saturday 7<sup>th</sup> November 2026</p>");
    expect(raiseOrdinals("the 1st December and the 22nd January")).toBe("the 1<sup>st</sup> December and the 22<sup>nd</sup> January");
  });

  it("leaves an ending alone when no month follows it", () => {
    expect(raiseOrdinals("<b>The 5th Annual Quiz</b>")).toBe("<b>The 5th Annual Quiz</b>");
  });

  it("never touches what is inside a tag", () => {
    const html = '<img alt="Saturday 7th November" src="x"><a href="https://example.com/7th November">7th November</a>';
    expect(raiseOrdinals(html)).toBe('<img alt="Saturday 7th November" src="x"><a href="https://example.com/7th November">7<sup>th</sup> November</a>');
  });
});
