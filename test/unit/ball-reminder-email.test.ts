import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBallReminderEmail, DRINKS_SHEET_URL } from "../../src/ball/reminder-email";

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
    for (const d of ["7th November 2026", "The Park Hotel", "7pm for 7.30pm", "Dress to impress", "Over 18"]) {
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
    expect(mail.html).toContain("Hello Jo.");
    expect(mail.text).toContain("Hello Jo.");
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
    expect(mail.html).toContain("Hello Jo van der Berg.");
  });
});

// TASK-577, Jaimie, 31 October 2026: everyone with a ticket hears about the hotel's drinks pre-order
// here, and that "Everyone needs to submit their meals". The sheet is linked, not attached: the
// site's emails carry no attachments, on purpose (src/clients/email.ts).
describe("the hotel's drinks pre-order and the meals reminder", () => {
  const flat = (s: string) => s.replace(/\s+/g, " ");
  // What a reader sees: no tags, and an escaped apostrophe is an apostrophe.
  const seen = (html: string) => flat(html.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'"));
  const DRINKS = [
    "The Park Hotel is taking drinks pre-orders: wine, spirits, buckets of beer and soft drinks, brought to your table on the night.",
    "If you'd like one, fill in the hotel's form and send it straight to the hotel, not to us, at enquiries@theparkhotelayrshire.co.uk.",
    "Orders must reach them by Wednesday 4th November and be paid by 12pm on Friday 6th November.",
    "They'll email you a secure payment link.",
    "The minimum is 4 people per party, and spirit bottles include 8 mixers.",
  ];

  it("says all of it, in both the html and the plain text", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    for (const sentence of DRINKS) {
      expect(seen(mail.html)).toContain(sentence);
      expect(flat(mail.text)).toContain(sentence);
    }
    expect(mail.html).toContain("Drinks on your table");
    expect(mail.text).toContain("DRINKS ON YOUR TABLE");
  });

  it("links the hotel's own sheet with a button, and the sheet is really there", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    expect(DRINKS_SHEET_URL).toBe("https://nbcc.scot/assets/park-hotel-drinks-pre-order.pdf");
    expect(mail.html).toContain(`href="${DRINKS_SHEET_URL}"`);
    expect(seen(mail.html)).toContain("Download the hotel's drinks form");
    expect(mail.html).toContain('href="mailto:enquiries@theparkhotelayrshire.co.uk"');
    expect(mail.text).toContain(DRINKS_SHEET_URL);
    const sheet = readFileSync(resolve(__dirname, "../../assets/park-hotel-drinks-pre-order.pdf"));
    expect(sheet.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("tells everyone to submit their meals, and links their guest page", () => {
    const mail = buildBallReminderEmail(booking, guests, details);
    expect(mail.html).toContain("Everyone needs to submit their meals.");
    expect(mail.text).toContain("Everyone needs to submit their meals.");
    expect(flat(mail.text)).toContain("If anyone at your table is vegan or vegetarian, make sure that's on your guest page so the kitchen has it.");
    expect(mail.html).toContain(`<a href="${details.guestLink}"`);
    expect(mail.html).toContain(">your guest page</a> so the kitchen has it.");
  });

  it("does not link a guest page it does not have", () => {
    const mail = buildBallReminderEmail(booking, guests, { ...details, guestLink: null });
    expect(flat(mail.html)).toContain("make sure that's on your guest page so the kitchen has it.");
    expect(mail.html).not.toContain(">your guest page</a>");
  });

  it("sits after their table and before the night itself", () => {
    const { html, text } = buildBallReminderEmail(booking, guests, details);
    expect(html.indexOf("Your table")).toBeLessThan(html.indexOf("Drinks on your table"));
    expect(html.indexOf("Drinks on your table")).toBeLessThan(html.indexOf("Everyone needs to submit"));
    expect(html.indexOf("Everyone needs to submit")).toBeLessThan(html.indexOf("On the night"));
    expect(text.indexOf("YOUR TABLE")).toBeLessThan(text.indexOf("DRINKS ON YOUR TABLE"));
    expect(text.indexOf("Everyone needs to submit")).toBeLessThan(text.indexOf("ON THE NIGHT"));
  });

  // Orders close on Wednesday 4th, three days before the Ball. A later email (someone who booked in
  // the last few days, or the staff button) must not offer what can no longer be ordered.
  it.each([[7], [undefined], [4], [3]])("offers drinks with %s days to go", (daysToGo) => {
    const mail = buildBallReminderEmail(booking, guests, { ...details, daysToGo });
    expect(mail.html).toContain("Drinks on your table");
    expect(mail.text).toContain("DRINKS ON YOUR TABLE");
  });

  it.each([[2], [1], [0]])("leaves drinks out with %s days to go, but keeps the meals", (daysToGo) => {
    const mail = buildBallReminderEmail(booking, guests, { ...details, daysToGo });
    expect(mail.html).not.toContain("Drinks on your table");
    expect(mail.text).not.toContain("DRINKS ON YOUR TABLE");
    expect(mail.html).not.toContain(DRINKS_SHEET_URL);
    expect(mail.text).not.toContain(DRINKS_SHEET_URL);
    expect(mail.html).toContain("Everyone needs to submit their meals.");
  });
});
