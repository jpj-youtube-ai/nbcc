import { describe, it, expect } from "vitest";
import {
  ballDateItems,
  comingUp,
  eventItems,
  fundraiserItems,
  newsletterItems,
  ukDayAndTime,
  withoutListedNight,
  type Upcoming,
} from "../../src/admin/overview-coming-up";

// "Coming up" on the admin Overview (stage 3): the next 14 days, in date order, grouped by day.
// These are the pure rules. Invented events and dates only.

const item = (over: Partial<Upcoming>): Upcoming => ({
  day: "2026-10-05",
  time: null,
  text: "Quiz night",
  view: "events",
  button: "Events",
  ...over,
});

describe("the next 14 days, in date order", () => {
  // Saturday 3 October 2026.
  const today = "2026-10-03";

  it("keeps today and the 13 days after it, and leaves out the past and anything later", () => {
    const days = comingUp(
      [
        item({ day: "2026-10-02", text: "Yesterday" }),
        item({ day: "2026-10-03", text: "Today" }),
        item({ day: "2026-10-16", text: "Day 14" }),
        item({ day: "2026-10-17", text: "Day 15" }),
      ],
      today,
    );
    expect(days.flatMap((d) => d.items.map((i) => i.text))).toEqual(["Today", "Day 14"]);
  });

  it("puts the days in order, and within a day the timed ones first, earliest first", () => {
    const days = comingUp(
      [
        item({ day: "2026-10-06", text: "Later day" }),
        item({ day: "2026-10-05", time: null, text: "No time" }),
        item({ day: "2026-10-05", time: "19:30", text: "Evening" }),
        item({ day: "2026-10-05", time: "08:00", text: "Morning" }),
      ],
      today,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(days[0].items.map((i) => i.text)).toEqual(["Morning", "Evening", "No time"]);
  });

  it("names each day: today, tomorrow, then the weekday and date", () => {
    const days = comingUp(
      [item({ day: "2026-10-03" }), item({ day: "2026-10-04" }), item({ day: "2026-10-07" })],
      today,
    );
    expect(days.map((d) => d.label)).toEqual(["Today", "Tomorrow", "Wednesday 7 October"]);
  });

  it("says the time in the UK's words, 7:30pm and 8am", () => {
    const days = comingUp([item({ time: "19:30" }), item({ time: "08:00", text: "Report" }), item({ time: "12:00", text: "Lunch" })], today);
    expect(days[0].items.map((i) => i.when)).toEqual(["8am", "12pm", "7:30pm"]);
    expect(comingUp([item({ time: null })], today)[0].items[0].when).toBe("");
  });

  it("gives nothing for a quiet fortnight", () => {
    expect(comingUp([], today)).toEqual([]);
  });

  it("crosses the end of a month and the clocks going back", () => {
    // 31 October to 1 November 2026, when the UK clocks go back on 25 October.
    const days = comingUp([item({ day: "2026-11-01" }), item({ day: "2026-10-31" })], "2026-10-24");
    expect(days.map((d) => d.label)).toEqual(["Saturday 31 October", "Sunday 1 November"]);
  });
});

describe("turning each screen's rows into dated lines", () => {
  it("reads a moment as its UK day and time, across the clock change", () => {
    expect(ukDayAndTime(new Date("2026-10-10T18:30:00Z"))).toEqual({ day: "2026-10-10", time: "19:30" });
    expect(ukDayAndTime(new Date("2026-11-10T18:30:00Z"))).toEqual({ day: "2026-11-10", time: "18:30" });
    // 00:15 on 1 October in the UK.
    expect(ukDayAndTime("2026-09-30T23:15:00Z")).toEqual({ day: "2026-10-01", time: "00:15" });
  });

  it("lists events, saying when one is still a draft, and no time when it is to be confirmed", () => {
    const items = eventItems([
      { name: "Quiz night", date: "2026-10-09", start: "19:30", timeTbc: false, status: "live" },
      { name: "Coffee morning", date: "2026-10-10", start: "10:00", timeTbc: true, status: "draft" },
    ]);
    expect(items).toEqual([
      { day: "2026-10-09", time: "19:30", text: "Quiz night", view: "events", button: "Events" },
      { day: "2026-10-10", time: null, text: "Coffee morning (still a draft)", view: "events", button: "Events" },
    ]);
  });

  it("lists the event days of approved fundraisers still on the list", () => {
    const f = (over: Record<string, unknown>) => ({ title: "Bake sale", eventDate: "2026-10-09", startTime: null, status: "approved", offListAt: null, ...over });
    const items = fundraiserItems([
      f({}),
      f({ title: "New", status: "new" }),
      f({ title: "Finished", status: "finished" }),
      f({ title: "Off the list", offListAt: "2026-10-01T10:00:00Z" }),
      f({ title: "No date", eventDate: null }),
      f({ title: "Fun run", startTime: "09:00" }),
    ]);
    expect(items).toEqual([
      { day: "2026-10-09", time: null, text: "Bake sale (a fundraiser)", view: "fundraising", button: "Fundraising" },
      { day: "2026-10-09", time: "09:00", text: "Fun run (a fundraiser)", view: "fundraising", button: "Fundraising" },
    ]);
  });

  it("lists newsletters waiting to go at a set time, in UK time", () => {
    const items = newsletterItems([
      { status: "queued", scheduledAt: new Date("2026-10-08T07:00:00Z"), subject: "October news" },
      { status: "queued", scheduledAt: null, subject: "Sending now" },
      { status: "cancelled", scheduledAt: new Date("2026-10-08T07:00:00Z"), subject: "Called off" },
    ]);
    expect(items).toEqual([
      { day: "2026-10-08", time: "08:00", text: "The newsletter goes out: October news", view: "newsletter", button: "Newsletter" },
    ]);
  });

  it("lists the Festive Ball's dates that are set, and the night itself", () => {
    const items = ballDateItems({
      gateOpensAt: null,
      salesCloseAt: new Date("2026-10-31T23:59:00Z"),
      guestDetailsLockAt: "2026-10-24T22:59:00Z",
      night: new Date("2026-11-07T19:00:00Z"),
    });
    expect(items.map((i) => [i.day, i.time, i.text])).toEqual([
      ["2026-10-31", "23:59", "Festive Ball ticket sales close"],
      ["2026-10-24", "23:59", "Festive Ball guest details and menu choices close"],
      ["2026-11-07", "19:00", "The Festive Ball"],
    ]);
    expect(items.every((i) => i.view === "ball" && i.button === "Festive Ball")).toBe(true);
  });

  const dates = {
    gateOpensAt: new Date("2026-10-10T09:00:00Z"),
    salesCloseAt: new Date("2026-10-31T23:59:00Z"),
    guestDetailsLockAt: null,
    night: new Date("2026-11-07T19:00:00Z"),
  };
  const texts = (items: Upcoming[]) => items.map((i) => i.text);

  it("leaves out a Ball date already done by hand: sales opened or closed early", () => {
    expect(texts(ballDateItems({ ...dates, gateOpen: true }))).not.toContain("Festive Ball ticket sales open");
    expect(texts(ballDateItems({ ...dates, salesClosed: true }))).not.toContain("Festive Ball ticket sales close");
    expect(texts(ballDateItems(dates))).toContain("Festive Ball ticket sales open");
  });

  it("leaves out a Ball date that has already passed today", () => {
    const later = ballDateItems({ ...dates, now: new Date("2026-10-10T14:00:00Z") });
    expect(texts(later)).not.toContain("Festive Ball ticket sales open");
    expect(texts(later)).toContain("Festive Ball ticket sales close");
  });

  // The Events screen has its own row for the night; one line is enough.
  it("leaves out the night when the Events screen already lists the Festive Ball that day", () => {
    const ball = ballDateItems(dates);
    const events = eventItems([{ name: "Festive Ball 2026", date: "2026-11-07", start: null, timeTbc: true, status: "live" }]);
    expect(texts(withoutListedNight(ball, events))).toEqual(["Festive Ball ticket sales open", "Festive Ball ticket sales close"]);
    const other = eventItems([{ name: "Quiz night", date: "2026-11-07", start: "19:00", timeTbc: false, status: "live" }]);
    expect(texts(withoutListedNight(ball, other))).toContain("The Festive Ball");
    expect(texts(withoutListedNight(ball, []))).toContain("The Festive Ball");
  });
});
