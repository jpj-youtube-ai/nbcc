import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBallReminderEmail } from "../../src/ball/reminder-email";
import { daysToBall, stageFor, runRunUpPass, type RunUpBooking } from "../../src/ball/run-up";

// The charity's decision, 2026-10-04: the Ball reminder says the TRUE time to go. Sent a week before
// (the normal run on Saturday 31 October) it is word for word as it always was: "A week to go" and
// "A week on Saturday you'll be with us". Sent on any other day (to someone who booked in the last
// week, or early with the staff button) it says the real number of days, and "Tomorrow" the day
// before. Days are counted by the day in the UK. Every name here is invented.

const EVENT = new Date("2026-11-07T19:00:00Z");
const booking = { reference: "BALL-EXAMPL", buyerName: "Alex Example", buyerFirstName: "Alex", seats: 2, tableName: null };
const guests = [{ fullName: "Alex Example", dietary: "Vegetarian", accessNeeds: null }];
const details = { arrivalTime: "7pm for 7.30pm", includedNote: null, guestLink: "https://nbcc.test/ball/guests/tok" };
const at = (daysToGo?: number) => buildBallReminderEmail(booking, guests, daysToGo === undefined ? details : { ...details, daysToGo });
const eyebrow = (html: string) => (/text-transform:uppercase[^>]*>([^<]*)<\/p>/.exec(html) ?? [])[1];

describe("counting the days to the Ball, by the day in the UK", () => {
  it("is 7 on Saturday 31 October, whatever the time of day", () => {
    expect(daysToBall(new Date("2026-10-31T00:30:00Z"), EVENT)).toBe(7);
    expect(daysToBall(new Date("2026-10-31T08:00:00Z"), EVENT)).toBe(7);
    expect(daysToBall(new Date("2026-10-31T23:30:00Z"), EVENT)).toBe(7);
  });

  it("counts down to 1 the day before, 0 on the day, and below 0 after", () => {
    expect(daysToBall(new Date("2026-10-28T08:00:00Z"), EVENT)).toBe(10);
    expect(daysToBall(new Date("2026-11-03T08:00:00Z"), EVENT)).toBe(4);
    expect(daysToBall(new Date("2026-11-06T08:00:00Z"), EVENT)).toBe(1);
    expect(daysToBall(new Date("2026-11-07T08:00:00Z"), EVENT)).toBe(0);
    expect(daysToBall(new Date("2026-11-08T08:00:00Z"), EVENT)).toBe(-1);
  });
});

describe("the reminder sent a week before", () => {
  // The fixture is the reminder as origin/main's builder made it (commit 7bd8a698), for this same
  // booking, written out before the builder was touched.
  it("is byte for byte the reminder on origin/main", () => {
    const original = JSON.parse(readFileSync(resolve(__dirname, "fixtures/ball-reminder-week-origin-main.json"), "utf8"));
    expect(at(7)).toEqual(original);
    // With no number given (as any caller from before would call it), the same.
    expect(at()).toEqual(original);
    expect(original.subject).toBe("A week to go: you're coming to the ball, BALL-EXAMPL");
    expect(eyebrow(original.html)).toBe("A week to go");
    expect(original.html).toContain("Hello Alex. A week on Saturday you'll be with us at The Park Hotel. Here's everything you need.</p>");
  });
});

describe("the reminder sent on any other day", () => {
  it.each([
    [10, "10 days to go", "In 10 days"],
    [6, "6 days to go", "In 6 days"],
    [4, "4 days to go", "In 4 days"],
    [2, "2 days to go", "In 2 days"],
  ])("with %i days to go says so", (n, label, lead) => {
    const m = at(n as number);
    expect(m.subject).toBe(`${label}: you're coming to the ball, BALL-EXAMPL`);
    expect(eyebrow(m.html)).toBe(label);
    expect(m.html).toContain(`Hello Alex. ${lead} you'll be with us at The Park Hotel. Here's everything you need.</p>`);
    expect(m.text).toContain(`IT'S NEARLY HERE: ${(label as string).toUpperCase()}\n\nHello Alex. ${lead} you'll be with us at\nThe Park Hotel. Here's everything you need.`);
    expect(m.subject + m.html + m.text).not.toMatch(/a week/i);
  });

  it("says Tomorrow the day before", () => {
    const m = at(1);
    expect(m.subject).toBe("Tomorrow: you're coming to the ball, BALL-EXAMPL");
    expect(eyebrow(m.html)).toBe("Tomorrow");
    expect(m.html).toContain("Hello Alex. Tomorrow you'll be with us at The Park Hotel. Here's everything you need.</p>");
    expect(m.text).toContain("IT'S NEARLY HERE: TOMORROW\n\nHello Alex. Tomorrow you'll be with us at\nThe Park Hotel. Here's everything you need.");
    expect(m.subject + m.html + m.text).not.toMatch(/a week|days to go|1 day/i);
  });

  it("changes nothing else in the email", () => {
    const swap = (s: string) => s.replace(/4 days to go/g, "A week to go").replace(/4 DAYS TO GO/g, "A WEEK TO GO").replace(/In 4 days you'll/g, "A week on Saturday you'll");
    const four = at(4);
    const week = at(7);
    expect(swap(four.subject)).toBe(week.subject);
    expect(swap(four.html)).toBe(week.html);
    expect(swap(four.text)).toBe(week.text);
  });
});

describe("someone who books in the last week still gets it, the morning after", () => {
  const b = (over: Partial<RunUpBooking> = {}): RunUpBooking => ({
    id: 1, reference: "BALL-EXAMPL", buyerEmail: "alex@example.com", buyerName: "Alex Example", buyerFirstName: "Alex", tableName: null,
    guestToken: "tok", seats: 2, guestsNamed: 2, guestChaseSentAt: null, guestFinalCallSentAt: null, reminderSentAt: null, ...over,
  });
  const due = (now: string) => stageFor(b(), { now: new Date(now), eventDate: EVENT, lockAt: null });

  it("paid on 2 November: the run on 3 November sends it, saying 4 days to go", () => {
    expect(due("2026-11-03T08:00:00Z")).toBe("practical");
    expect(daysToBall(new Date("2026-11-03T08:00:00Z"), EVENT)).toBe(4);
    expect(at(4).subject).toBe("4 days to go: you're coming to the ball, BALL-EXAMPL");
  });

  it("paid on 5 November: the run on 6 November sends it, saying Tomorrow", () => {
    expect(due("2026-11-06T08:00:00Z")).toBe("practical");
    expect(at(daysToBall(new Date("2026-11-06T08:00:00Z"), EVENT)).subject).toBe("Tomorrow: you're coming to the ball, BALL-EXAMPL");
  });

  // A booking paid on 6 November after that morning's run, or on the 7th, is first seen by the run
  // on the day of the Ball, which sends nothing. They have their confirmation from hours before.
  it("nothing is ever sent on the day of the Ball or after", () => {
    expect(due("2026-11-07T08:00:00Z")).toBeNull();
    expect(due("2026-11-08T08:00:00Z")).toBeNull();
  });

  it("the pass tells the sender nothing is due twice: one send, whatever the day", async () => {
    const booking = b();
    const sent: string[] = [];
    for (const day of ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]) {
      await runRunUpPass({
        listBookings: async () => [booking],
        send: async () => {
          sent.push(day);
        },
        markSent: async () => {
          booking.reminderSentAt = `${day}T08:00:01Z`;
        },
        window: { now: new Date(`${day}T08:00:00Z`), eventDate: EVENT, lockAt: null },
      });
    }
    expect(sent).toEqual(["2026-11-03"]);
  });
});
