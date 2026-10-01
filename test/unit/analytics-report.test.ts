import { describe, it, expect } from "vitest";
import {
  periodsFor,
  fillDays,
  headlineFrom,
  pagesFrom,
  countriesFrom,
  countryName,
  labelNewsletters,
  newsletterIds,
} from "../../src/analytics/report";

// TASK-482: the arithmetic behind Admin > Analytics that is not done in SQL. The counting itself
// (visitors, visits split at 30 minutes, bounces, averages, entry pages) is GROUP BY and window
// functions in src/db/analytics-report.ts, proved against Postgres by
// features/analytics-admin.feature. Every number and label here is invented.

describe("periodsFor: like with like", () => {
  // Review of #605: with today in the period but whole days before it, steady traffic read "Down
  // 12%" every morning. The days before are now counted up to the same time of day.
  it("at 9am, counts today up to now and the days before up to 9am too", () => {
    const nineAm = new Date("2026-10-01T08:00:00Z"); // 9am in the UK, summer time
    expect(periodsFor(nineAm, 7)).toEqual({
      current: { from: "2026-09-25", to: "2026-10-01", until: "2026-10-01T08:00:00.000Z" },
      previous: { from: "2026-09-18", to: "2026-09-24", until: "2026-09-24T08:00:00.000Z" },
    });
  });

  it("keeps the same clock time across the change from summer time", () => {
    const nineAm = new Date("2026-11-01T09:00:00Z"); // 9am in the UK, winter time
    const p = periodsFor(nineAm, 30);
    expect(p.current).toEqual({ from: "2026-10-03", to: "2026-11-01", until: "2026-11-01T09:00:00.000Z" });
    // 2 October is still summer time, so 9am there is 08:00 UTC.
    expect(p.previous).toEqual({ from: "2026-09-03", to: "2026-10-02", until: "2026-10-02T08:00:00.000Z" });
  });

  it("uses the UK day, not the UTC one, just after midnight in summer", () => {
    const p = periodsFor(new Date("2026-07-14T23:30:00Z"), 7); // 00:30 on 15 July in the UK
    expect(p.current.to).toBe("2026-07-15");
    expect(p.previous).toEqual({ from: "2026-07-02", to: "2026-07-08", until: "2026-07-07T23:30:00.000Z" });
  });
});

describe("fillDays", () => {
  it("gives every day of the period its visitors, zero on a quiet day", () => {
    expect(fillDays([{ day: "2026-09-03", visitors: 4 }, { day: "2026-09-01", visitors: 2 }], { from: "2026-09-01", to: "2026-09-03" })).toEqual([
      { day: "2026-09-01", visitors: 2 },
      { day: "2026-09-02", visitors: 0 },
      { day: "2026-09-03", visitors: 4 },
    ]);
  });
});

describe("headlineFrom", () => {
  it("gives the share of visits that saw one page, as a whole percentage", () => {
    expect(headlineFrom({ visitors: 3, visits: 4, views: 5, bounces: 3 })).toEqual({ visitors: 3, visits: 4, views: 5, bounceShare: 75 });
  });

  it("is all zeros with no visits, rather than dividing by nothing", () => {
    expect(headlineFrom(undefined)).toEqual({ visitors: 0, visits: 0, views: 0, bounceShare: 0 });
  });
});

describe("pagesFrom", () => {
  it("gives each page the share of all visits that began there", () => {
    const rows = [
      { path: "/", views: 3, visitors: 2, avgActiveSeconds: 20, avgScroll: 30, entries: 2 },
      { path: "/donate", views: 2, visitors: 2, avgActiveSeconds: null, avgScroll: null, entries: 1 },
    ];
    expect(pagesFrom(rows, 3)).toEqual([
      { path: "/", title: "Home page", views: 3, visitors: 2, avgActiveSeconds: 20, avgScroll: 30, entryShare: 67 },
      { path: "/donate", title: "Donate", views: 2, visitors: 2, avgActiveSeconds: null, avgScroll: null, entryShare: 33 },
    ]);
  });

  it("names every page the way the site map does", () => {
    const named = (path: string) => pagesFrom([{ path, views: 1, visitors: 1, avgActiveSeconds: null, avgScroll: null, entries: 0 }], 1)[0].title;
    expect(named("/ball")).toBe("Festive Ball");
    expect(named("/ball/terms")).toBe("Ticket terms");
    expect(named("/donate/thank-you")).toBe("Thank you");
    expect(named("/gift-aid/declare")).toBe("Gift Aid declaration");
    expect(named("other")).toBe("Other pages");
    expect(named("/somewhere-new")).toBe("/somewhere-new");
  });
});

describe("countries", () => {
  it("names a country from its ISO code, and keeps a code it does not know", () => {
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("de")).toBe("Germany");
    expect(countryName("ZZ9")).toBe("ZZ9");
  });

  it("names every country row", () => {
    expect(countriesFrom([{ country: "FR", visitors: 2 }])).toEqual([{ country: "FR", name: "France", visitors: 2 }]);
  });
});

describe("newsletter issues", () => {
  it("picks out the campaigns that are newsletter ids", () => {
    expect(newsletterIds([{ campaign: "41" }, { campaign: "ballConfirmation" }, { campaign: null }, { campaign: "7" }])).toEqual([41, 7]);
  });

  it("labels an issue with its newsletter's subject, keeps any other campaign, and names a missing one", () => {
    const rows = [
      { campaign: "41", visits: 3 },
      { campaign: "spring", visits: 1 },
      { campaign: null, visits: 1 },
    ];
    expect(labelNewsletters(rows, new Map([[41, "Our winter news"]]))).toEqual([
      { campaign: "41", label: "Our winter news", visits: 3 },
      { campaign: "spring", label: "spring", visits: 1 },
      { campaign: null, label: "Not known", visits: 1 },
    ]);
  });
});
