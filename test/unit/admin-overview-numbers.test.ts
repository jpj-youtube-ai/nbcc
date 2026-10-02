import { describe, it, expect } from "vitest";
import { giversFrom, monthSoFar, numbersLines } from "../../src/admin/overview-numbers";

// The Overview's numbers (stage 2). These are the pure rules: which days count as "this month so
// far" and which as "the same days last month". Invented moments only.

describe("this month so far, against the same days last month", () => {
  it("runs from the 1st to now, and from last month's 1st to the same day and UK time", () => {
    // 14 October 2026, 10:30 in the UK (BST, an hour ahead of UTC).
    const p = monthSoFar(new Date("2026-10-14T09:30:00Z"));
    expect(p.current).toEqual({ from: "2026-10-01", until: "2026-10-14T09:30:00.000Z" });
    expect(p.previous).toEqual({ from: "2026-09-01", until: "2026-09-14T09:30:00.000Z" });
  });

  it("keeps the UK clock time when the clocks have changed in between", () => {
    // 10 November 2026, 10:30 in the UK (GMT); 10 October was BST, so 10:30 there is 09:30 UTC.
    const p = monthSoFar(new Date("2026-11-10T10:30:00Z"));
    expect(p.previous).toEqual({ from: "2026-10-01", until: "2026-10-10T09:30:00.000Z" });
  });

  it("stops at the end of a shorter last month", () => {
    // 31 March 2027 at noon: February had 28 days, so all of February counts.
    const p = monthSoFar(new Date("2027-03-31T12:00:00Z"));
    expect(p.previous).toEqual({ from: "2027-02-01", until: "2027-03-01T00:00:00.000Z" });
  });

  it("counts the UK day, so just after midnight in the UK is already the new month", () => {
    // 00:15 on 1 October in the UK is 23:15 UTC on 30 September.
    const p = monthSoFar(new Date("2026-09-30T23:15:00Z"));
    expect(p.current.from).toBe("2026-10-01");
    // 00:15 on 1 September in the UK (BST) is 23:15 UTC on 31 August.
    expect(p.previous).toEqual({ from: "2026-09-01", until: "2026-08-31T23:15:00.000Z" });
  });

  it("crosses the year", () => {
    const p = monthSoFar(new Date("2027-01-05T12:00:00Z"));
    expect(p.current.from).toBe("2027-01-01");
    expect(p.previous).toEqual({ from: "2026-12-01", until: "2026-12-05T12:00:00.000Z" });
  });
});

describe("monthly givers, counted as the Monthly givers screen counts them", () => {
  const giver = (over: Record<string, unknown>) => ({
    monthlyPence: 1_000, state: "active", firstPaidAt: "2025-01-10T10:00:00Z", cancelledAt: null, lapsedAt: null, ...over,
  });
  // 14 October 2026, 10:30 in the UK.
  const now = new Date("2026-10-14T09:30:00Z");

  it("counts those giving (active, or older ones with no record either way) and what they give a month", () => {
    const got = giversFrom([giver({}), giver({ state: "unknown", monthlyPence: 500 }), giver({ state: "past_due" }), giver({ state: "cancelled" })], now);
    expect(got).toMatchObject({ giving: 2, monthlyPence: 1_500 });
  });

  it("counts who joined and who stopped this month, by the UK day", () => {
    const got = giversFrom(
      [
        giver({ firstPaidAt: "2026-10-02T08:00:00Z" }),
        // 00:30 on 1 October in the UK.
        giver({ firstPaidAt: "2026-09-30T23:30:00Z" }),
        giver({ firstPaidAt: "2026-09-30T22:30:00Z" }),
        giver({ state: "cancelled", cancelledAt: "2026-10-05T12:00:00Z" }),
        giver({ state: "lapsed", lapsedAt: "2026-10-09T12:00:00Z" }),
        giver({ state: "cancelled", cancelledAt: "2026-09-20T12:00:00Z" }),
      ],
      now,
    );
    expect(got).toMatchObject({ joined: 2, stopped: 2 });
  });
});

describe("the words for each number", () => {
  it("says money in this month against last month, in whole pounds, split by where it came from", () => {
    const [line] = numbersLines({
      money: {
        donations: { now: 210_049, before: 190_000 },
        ball: { now: 180_000, before: 200_000 },
        fundraising: { now: 31_000, before: 0 },
      },
    });
    expect(line).toMatchObject({ key: "money", title: "Money in", view: "donations", button: "Donations" });
    expect(line.headline).toBe("£4,210 this month so far");
    expect(line.detail).toBe("£3,900 by this time last month. Donations £2,100, Festive Ball £1,800, fundraising pages £310.");
  });

  it("names only the parts of the money a person may see", () => {
    const [line] = numbersLines({ money: { donations: { now: 5_000, before: 2_000 } } });
    expect(line.headline).toBe("£50 this month so far");
    expect(line.detail).toBe("£20 by this time last month.");
  });

  it("sends someone to a screen they can open: the Ball's, when that is the only money they may see", () => {
    expect(numbersLines({ money: { ball: { now: 1, before: 1 } } })[0]).toMatchObject({ view: "ball", button: "Festive Ball" });
    expect(numbersLines({ money: { fundraising: { now: 1, before: 1 } } })[0]).toMatchObject({ view: "fundraising", button: "Fundraising" });
    expect(numbersLines({ money: { ball: { now: 1, before: 1 }, fundraising: { now: 1, before: 1 } } })[0].view).toBe("ball");
  });

  it("says how many give monthly, and who joined and stopped", () => {
    const [line] = numbersLines({ monthly: { giving: 84, monthlyPence: 126_000, joined: 3, stopped: 1 } });
    expect(line).toMatchObject({ key: "monthly", title: "Monthly givers", view: "monthly", button: "Monthly givers" });
    expect(line.headline).toBe("84 people give £1,260 a month");
    expect(line.detail).toBe("3 joined and 1 stopped this month.");
    expect(numbersLines({ monthly: { giving: 1, monthlyPence: 1_000, joined: 0, stopped: 0 } })[0]).toMatchObject({
      headline: "1 person gives £10 a month",
      detail: "Nobody joined or stopped this month.",
    });
  });

  it("says how the Festive Ball is selling, and how long to go", () => {
    const [line] = numbersLines({ ball: { seatsSold: 212, totalSeats: 300, takenPence: 1_840_000, transferSeats: 16, daysToGo: 36 } });
    expect(line).toMatchObject({ key: "ball", title: "Festive Ball", view: "ball", button: "Festive Ball" });
    expect(line.headline).toBe("212 of 300 seats sold");
    expect(line.detail).toBe("£18,400 taken. 16 seats held for bank transfers. 36 days to go.");
    const today = numbersLines({ ball: { seatsSold: 1, totalSeats: 300, takenPence: 0, transferSeats: 1, daysToGo: 0 } })[0];
    expect(today.detail).toBe("£0 taken. 1 seat held for a bank transfer. The Ball is tonight.");
    const past = numbersLines({ ball: { seatsSold: 1, totalSeats: 300, takenPence: 0, transferSeats: 0, daysToGo: -3 } })[0];
    expect(past.detail).toBe("£0 taken.");
  });

  it("says how the website did in the last 7 days", () => {
    const [line] = numbersLines({ website: { visitors: 1_240, visitorsBefore: 1_100, onNow: 3, topChannel: "search" } });
    expect(line).toMatchObject({ key: "website", title: "Website", view: "analytics", button: "Analytics" });
    expect(line.headline).toBe("1,240 visitors in the last 7 days");
    expect(line.detail).toBe("1,100 in the 7 days before. 3 people on the site now. Most came from Search.");
    expect(numbersLines({ website: { visitors: 1, visitorsBefore: 0, onNow: 1, topChannel: null } })[0]).toMatchObject({
      headline: "1 visitor in the last 7 days",
      detail: "0 in the 7 days before. 1 person on the site now.",
    });
  });

  it("keeps the order money, monthly givers, the Ball, the website, and leaves out what is not there", () => {
    const lines = numbersLines({
      website: { visitors: 1, visitorsBefore: 1, onNow: 0, topChannel: null },
      monthly: { giving: 1, monthlyPence: 1, joined: 0, stopped: 0 },
    });
    expect(lines.map((l) => l.key)).toEqual(["monthly", "website"]);
    expect(numbersLines({})).toEqual([]);
  });

  it("follows the house style: no hyphens joining words, no dashes", () => {
    const lines = numbersLines({
      money: { donations: { now: 1, before: 1 }, ball: { now: 1, before: 1 }, fundraising: { now: 1, before: 1 } },
      monthly: { giving: 2, monthlyPence: 1, joined: 2, stopped: 2 },
      ball: { seatsSold: 2, totalSeats: 3, takenPence: 1, transferSeats: 2, daysToGo: 2 },
      website: { visitors: 2, visitorsBefore: 2, onNow: 2, topChannel: "other_websites" },
    });
    for (const l of lines) {
      const all = `${l.title} ${l.headline} ${l.detail}`;
      expect(all, l.key).not.toMatch(/[A-Za-z]-[A-Za-z]/);
      expect(all, l.key).not.toMatch(/[–—]/);
    }
  });
});
