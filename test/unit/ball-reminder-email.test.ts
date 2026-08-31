import { describe, it, expect } from "vitest";
import { buildBallReminderEmail } from "../../src/ball/reminder-email";

const booking = {
  reference: "BALL-K7M2PQ",
  buyerName: "Jo Smith",
  seats: 10,
  tableName: "Ayrshire Bakery",
};

const guests = [
  { fullName: "Jo Smith", dietary: "Coeliac", accessNeeds: null },
  { fullName: "Pat Brown", dietary: null, accessNeeds: "Step-free access" },
  { fullName: "Ayesha Khan", dietary: null, accessNeeds: null },
];

const details = {
  arrivalTime: "7pm for 7.30pm",
  includedNote: null,
  guestLink: "https://nbcc.scot/ball/guests/tok",
};

describe("buildBallReminderEmail", () => {
  it("says a week to go in the subject, with the reference", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    expect(mail.subject).toMatch(/week to go/i);
    expect(mail.subject).toContain("BALL-K7M2PQ");
  });

  it("carries the practical details a guest needs on the day", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    for (const d of ["7 November 2026", "The Park Hotel", "7pm for 7.30pm", "Dress to impress", "Over 18"]) {
      expect(mail.html).toContain(d);
    }
  });

  // The reason this email exists at all, beyond a nudge.
  it("reads back what the booker told us, so a mistake is caught a week out", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    expect(mail.html).toContain("Jo Smith");
    expect(mail.html).toContain("Coeliac");
    expect(mail.html).toContain("Pat Brown");
    expect(mail.html).toContain("Step-free access");
    expect(mail.text).toContain("Coeliac");
  });

  it("tells them it is not too late to change it", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    expect(mail.html).toMatch(/it's not too late/i);
    expect(mail.html).toContain("https://nbcc.scot/ball/guests/tok");
  });

  it("mentions the places still without a name, without making it the headline", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    // 10 seats, 3 named
    expect(mail.html).toMatch(/still 7 places without a name/i);
    expect(mail.text).toMatch(/still 7 places without a name/i);
  });

  it("uses the singular when only one place is unnamed", () => {
    const nine = [...guests, ...Array.from({ length: 6 }, (_, i) => ({
      fullName: `Guest ${i}`, dietary: null, accessNeeds: null,
    }))];
    const mail = buildBallReminderEmail(booking, nine, details);
    expect(mail.html).toMatch(/still 1 place without a name/i);
  });

  it("says nothing about missing names when the table is full", () => {
    const full = Array.from({ length: 10 }, (_, i) => ({
      fullName: `Guest ${i}`, dietary: null, accessNeeds: null,
    }));
    const mail = buildBallReminderEmail(booking, full, details);
    expect(mail.html).not.toMatch(/without a name/i);
  });

  it("copes with a booker who never filled anything in", () => {
    const mail = buildBallReminderEmail(booking, [], details);
    expect(mail.html).not.toMatch(/Your table<\/h2>/);
    expect(mail.html).toMatch(/still 10 places without a name/i);
    expect(mail.html).toContain("BALL-K7M2PQ");
  });

  it("primes people for the auction and raffle so the buckets are not an ambush", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    expect(mail.html).toMatch(/auction and a raffle/i);
    expect(mail.html).toMatch(/bring a little extra/i);
  });

  it("is honest when the start time still is not confirmed", () => {
    const mail = buildBallReminderEmail(booking, guests, { ...details, arrivalTime: null });
    expect(mail.html).toMatch(/confirm the start time shortly/i);
  });

  it("escapes guest-entered text", () => {
    const mail = buildBallReminderEmail(
      booking,
      [{ fullName: "<script>alert(1)</script>", dietary: null, accessNeeds: null }],
      details,
    );
    expect(mail.html).not.toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("carries the charity registration statement and a plain-text alternative", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    expect(mail.html).toContain("SC047995");
    expect(mail.text).toContain("SC047995");
    expect(mail.text).not.toContain("<");
  });
});

describe("how the reminder greets people (TASK-318)", () => {
  it("uses the first name, the way a person writing would", () => {
    const mail = buildBallReminderEmail({ ...booking, buyerFirstName: "Jo" }, guests, details);
    expect(mail.html).toContain("Hello Jo —");
    expect(mail.text).toContain("Hello Jo —");
    expect(mail.html).not.toContain("Hello Jo Smith");
  });

  // Bookings taken before the split have no first name. Falling back to the whole name is
  // right; splitting it here would reintroduce exactly the guess the two columns removed.
  it("falls back to the whole name rather than guessing where it divides", () => {
    const mail = buildBallReminderEmail(
      { ...booking, buyerName: "Jo van der Berg", buyerFirstName: null },
      guests,
      details,
    );
    expect(mail.html).toContain("Hello Jo van der Berg —");
  });
});
