import { describe, it, expect } from "vitest";
import {
  buildGuestSummaryEmail,
  buildGuestChaseEmail,
  readableDate,
} from "../../src/ball/run-up-email";

// TASK-338: the run-up emails.

const LOCK = new Date("2026-10-24T22:00:00Z");
const LINK = "https://nbcc.scot/ball/guests/tok123";

const summary = (over = {}) =>
  buildGuestSummaryEmail({
    buyerFirstName: "Jo",
    reference: "NBCC-BALL-0001",
    seats: 10,
    guests: [
      { fullName: "Ailsa Muir", dietary: "coeliac", accessNeeds: null },
      { fullName: "Rab Nicolson", dietary: null, accessNeeds: "step-free access" },
      { fullName: "Effie Tait", dietary: null, accessNeeds: null },
    ],
    guestLink: LINK,
    lockAt: LOCK,
    ...over,
  });

const chase = (over = {}) =>
  buildGuestChaseEmail({
    buyerFirstName: "Jo",
    reference: "NBCC-BALL-0001",
    seats: 10,
    guestsNamed: 4,
    guestLink: LINK,
    lockAt: LOCK,
    finalCall: false,
    ...over,
  });

describe("dates a person would say out loud", () => {
  it("reads as a weekday and a date, not a timestamp", () => {
    expect(readableDate(LOCK)).toBe("Saturday 24 October");
  });

  // A deadline rendered in UTC lands a day out either side of midnight, and the one day it
  // matters is the deadline itself. 23:30 UTC on 24 October 2026 is 00:30 on the 25th in
  // London, because British Summer Time does not end until the following morning — so the
  // London answer and the naive UTC answer are different days, which is the point.
  it("is formatted in London, not UTC", () => {
    expect(readableDate(new Date("2026-10-24T23:30:00Z"))).toBe("Sunday 25 October");
  });
});

describe("the read-back after someone saves their guest list", () => {
  const mail = summary();

  it("lists every guest, in both halves of the email", () => {
    for (const name of ["Ailsa Muir", "Rab Nicolson", "Effie Tait"]) {
      expect(mail.html).toContain(name);
      expect(mail.text).toContain(name);
    }
  });

  // The point of the whole email. An allergy recorded wrongly is the one that matters, and until
  // now a buyer who typed ten of them had no record of what they had sent.
  it("reads back what they said about food and access", () => {
    expect(mail.html).toContain("coeliac");
    expect(mail.html).toContain("step-free access");
    expect(mail.text).toContain("coeliac");
  });

  it("says how many places are still to fill, and by when", () => {
    expect(mail.html).toContain("<b>7</b>");
    expect(mail.html).toContain("Saturday 24 October");
  });

  it("says nothing more is needed when the list is complete", () => {
    const done = summary({
      seats: 3,
      guests: [
        { fullName: "A One", dietary: null, accessNeeds: null },
        { fullName: "B Two", dietary: null, accessNeeds: null },
        { fullName: "C Three", dietary: null, accessNeeds: null },
      ],
    });
    expect(done.html).toMatch(/that is everyone/i);
    expect(done.html).not.toMatch(/still to fill/i);
  });

  // No deadline agreed yet is a real state for months. Saying "by null" or inventing one is
  // worse than simply not mentioning a date.
  it("does not invent a deadline before one is agreed", () => {
    const mail = summary({ lockAt: null });
    expect(mail.html).toMatch(/still to fill/i);
    expect(mail.html).not.toMatch(/by <b>/);
    expect(mail.text).not.toContain("null");
  });

  it("says plainly what is shared with the venue, and what is not", () => {
    expect(mail.html).toMatch(/share food and access needs with the venue/i);
    expect(mail.html).toMatch(/nothing else about your guests is passed on/i);
  });

  it("carries the link back, so nobody has to find an old email", () => {
    expect(mail.html).toContain(LINK);
    expect(mail.text).toContain(LINK);
  });

  it("names the booking in the subject, so a table host can tell them apart", () => {
    expect(mail.subject).toContain("NBCC-BALL-0001");
  });
});

describe("the chase", () => {
  it("gives the deadline, and does not sound like a telling-off", () => {
    const mail = chase();
    expect(mail.html).toContain("Saturday 24 October");
    expect(mail.html).toMatch(/nudge rather than anything to worry about/i);
    expect(mail.subject).toMatch(/still need/i);
  });

  it("says how far along they are when they have started", () => {
    expect(chase().html).toContain("4 of 10");
  });

  it("does not say '0 of 10' to someone who has not begun", () => {
    const mail = chase({ guestsNamed: 0 });
    expect(mail.html).not.toContain("0 of 10");
    expect(mail.html).toMatch(/do not have any names yet/i);
  });

  it("counts a single ticket as a ticket, not a place", () => {
    expect(chase({ seats: 1, guestsNamed: 0 }).html).toMatch(/your ticket/i);
  });

  it("suggests passing the link on, since a table is rarely filled in by one person", () => {
    expect(chase().html).toMatch(/pass them the link/i);
  });
});

describe("the last call", () => {
  const mail = chase({ finalCall: true });

  it("says today, and says it in the subject line", () => {
    expect(mail.html).toMatch(/<b>today<\/b>/i);
    expect(mail.subject).toMatch(/last call/i);
    expect(mail.subject).toMatch(/closes today/i);
  });

  it("still asks for the same thing, with the same link", () => {
    expect(mail.html).toContain(LINK);
    expect(mail.html).toMatch(/add your guests/i);
  });

  it("does not also describe itself as a gentle nudge", () => {
    expect(mail.html).not.toMatch(/nothing to worry about/i);
  });
});

describe("every run-up email", () => {
  const all = [summary(), chase(), chase({ finalCall: true })];

  it("carries the charity's registration details", () => {
    for (const mail of all) {
      expect(mail.html).toMatch(/SC047995/);
      expect(mail.text).toMatch(/SC047995/);
    }
  });

  it("has a subject, and a body in both formats", () => {
    for (const mail of all) {
      expect(mail.subject.length).toBeGreaterThan(10);
      expect(mail.html.length).toBeGreaterThan(200);
      expect(mail.text.length).toBeGreaterThan(200);
    }
  });

  // Guest names come from a form. An apostrophe or an ampersand in a name must not be able to
  // break the markup around it.
  it("escapes what a buyer typed", () => {
    const mail = buildGuestSummaryEmail({
      buyerFirstName: "Jo",
      reference: "R1",
      seats: 1,
      guests: [{ fullName: "<script>alert(1)</script>", dietary: null, accessNeeds: null }],
      guestLink: LINK,
      lockAt: null,
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
