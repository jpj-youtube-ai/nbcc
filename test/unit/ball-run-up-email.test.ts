import { describe, it, expect } from "vitest";
import { buildGuestSummaryEmail, readableDate } from "../../src/ball/run-up-email";

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

// TASK-576: the nudge and the last call (buildGuestChaseEmail) are gone. Their replacements, the
// reminder and the volunteers' list, are tested in ball-chase-email.test.ts.
describe("every run-up email", () => {
  const all = [summary()];

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
