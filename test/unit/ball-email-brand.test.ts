import { describe, it, expect } from "vitest";
import { buildBallConfirmationEmail } from "../../src/ball/confirmation-email";
import { buildBallReminderEmail } from "../../src/ball/reminder-email";
import { buildGuestSummaryEmail, buildGuestChaseEmail } from "../../src/ball/run-up-email";
import { TICKET_INCLUDES } from "../../src/ball/page";

// The ball emails were the only NBCC family that did not wear the house shell. They were built
// before src/email/templates.ts existed and grew their own markup: system-ui type, a bare cream
// box, no letterhead, no sponsor. Read next to a donation receipt they looked like a different
// charity, and the one paying for the evening was nowhere on them.
//
// So this file pins the SHELL rather than the wording. Copy is edited constantly and should be;
// the frame is what makes five separate emails read as one organisation, and it is what silently
// rots when the next email is added by copying an old one.

const booking = {
  reference: "BALL-K7M2PQ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Jo Smith",
  buyerFirstName: "Jo",
  buyerEmail: "jo@example.com",
  ticketsPence: 100_000,
  donationPence: 0,
  feeCoverPence: 0,
  totalPence: 100_000,
  giftAid: false,
  newsletterOptIn: false,
  tableName: null,
  stripeSessionId: "cs_1",
};

const details = {
  arrivalTime: null,
  includedNote: null,
  guestLink: "https://nbcc.scot/ball/guests/tok",
};

// Every ball email, as a recipient receives it. Named so a failure says which one broke.
const EMAILS: Array<[string, { subject: string; html: string; text: string }]> = [
  ["confirmation", buildBallConfirmationEmail(booking, details)],
  ["reminder", buildBallReminderEmail(booking, [], details)],
  [
    "guest summary",
    buildGuestSummaryEmail({
      buyerFirstName: "Jo",
      reference: "BALL-K7M2PQ",
      seats: 10,
      guests: [{ fullName: "Jo Smith", dietary: null, accessNeeds: null }],
      guestLink: "https://nbcc.scot/ball/guests/tok",
      lockAt: null,
    }),
  ],
  [
    "guest chase",
    buildGuestChaseEmail({
      buyerFirstName: "Jo",
      reference: "BALL-K7M2PQ",
      seats: 10,
      guestsNamed: 2,
      guestLink: "https://nbcc.scot/ball/guests/tok",
      lockAt: new Date("2026-10-24T00:00:00Z"),
      finalCall: false,
    }),
  ],
  [
    "final call",
    buildGuestChaseEmail({
      buyerFirstName: "Jo",
      reference: "BALL-K7M2PQ",
      seats: 10,
      guestsNamed: 2,
      guestLink: "https://nbcc.scot/ball/guests/tok",
      lockAt: new Date("2026-10-24T00:00:00Z"),
      finalCall: true,
    }),
  ],
];

describe("every ball email wears the NBCC letterhead", () => {
  // An email whose logo is a relative path renders as a broken-image icon in every mail client
  // on earth, because there is no page for it to be relative TO.
  it.each(EMAILS)("%s carries the NBCC logo on an absolute URL", (_name, mail) => {
    expect(mail.html).toContain("https://nbcc.scot/assets/img/nbcc-logo.png");
  });

  it.each(EMAILS)("%s carries The Designer Rooms logo, absolute too", (_name, mail) => {
    expect(mail.html).toContain("https://nbcc.scot/assets/img/the-designer-rooms-cream.png");
  });

  // The sponsor is paying for the entire evening. Clause 11.1 requires the credit wherever the
  // event is promoted, and every one of these emails promotes it.
  it.each(EMAILS)("%s credits The Designer Rooms in words as well", (_name, mail) => {
    expect(mail.html).toMatch(/Organised and sponsored by The Designer Rooms/i);
    expect(mail.text).toMatch(/Organised and sponsored by The Designer Rooms/i);
  });
});

describe("every ball email uses the house palette and type", () => {
  it.each(EMAILS)("%s sits on the maroon ground with a cream panel", (_name, mail) => {
    expect(mail.html).toMatch(/background:#800000/);
    expect(mail.html).toContain("#F8F5EE");
  });

  // The ball emails used to open with -apple-system, which is the browser default dressed up.
  // The rest of the family is Poppins over a Playfair heading.
  it.each(EMAILS)("%s sets Poppins for body copy", (_name, mail) => {
    expect(mail.html).toContain("'Poppins'");
  });

  it.each(EMAILS)("%s sets Playfair Display for the heading", (_name, mail) => {
    expect(mail.html).toContain("'Playfair Display'");
  });

  // Without this meta, Outlook and Apple Mail in dark mode invert the maroon to a pale pink and
  // the cream to near-black, which is how a carefully chosen palette arrives looking broken.
  it.each(EMAILS)("%s pins the light colour scheme for dark-mode clients", (_name, mail) => {
    expect(mail.html).toContain('name="color-scheme"');
  });

  it.each(EMAILS)("%s is a whole document, not a bare div", (_name, mail) => {
    expect(mail.html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
  });
});

describe("how to reach a human is never more than a glance away", () => {
  // Asked for directly: the phone number and the events address should be prominent, not a line
  // of small print. They live in the maroon footer bar of every one, as tappable links.
  it.each(EMAILS)("%s makes the phone number tappable", (_name, mail) => {
    expect(mail.html).toContain('href="tel:+441292811015"');
    expect(mail.text).toContain("01292 811 015");
  });

  it.each(EMAILS)("%s puts events@nbcc.scot in front of the reader", (_name, mail) => {
    expect(mail.html).toContain('href="mailto:events@nbcc.scot"');
    expect(mail.text).toContain("events@nbcc.scot");
  });

  // The ball is not the giving inbox. A buyer replying about a dietary requirement should not
  // land in the donations queue.
  it.each(EMAILS)("%s does not send ball questions to the giving inbox", (_name, mail) => {
    expect(mail.html).not.toContain("giving@nbcc.scot");
  });
});

describe("the legal footer survives the redesign", () => {
  it.each(EMAILS)("%s carries the charity registration", (_name, mail) => {
    expect(mail.html).toContain("SC047995");
    expect(mail.text).toContain("SC047995");
  });

  // Microsoft in particular looks for a real postal address. Its absence is a small but real
  // spam signal, and these are the emails that were landing in junk.
  it.each(EMAILS)("%s carries the registered address", (_name, mail) => {
    expect(mail.html).toContain("Annbank");
    expect(mail.text).toContain("Annbank");
  });
});

describe("the confirmation email, which is the one people keep", () => {
  const mail = buildBallConfirmationEmail(booking, details);

  // Asked for directly. "Your Festive Ball booking, BALL-K7M2PQ" is a filing reference; someone
  // who has just spent £1,000 on a charity ball should be told they are coming to it.
  it("says you're coming to the ball in the subject line", () => {
    expect(mail.subject).toMatch(/you're coming to the ball/i);
  });

  it("still carries the reference in the subject, so it stays findable", () => {
    expect(mail.subject).toContain("BALL-K7M2PQ");
  });

  // The website promises a welcome drink and three courses. The email promised "a meal". The
  // website is right, so the email takes ITS sentence rather than a second hand-written one.
  it("promises exactly what the website promises", () => {
    expect(mail.html).toContain(TICKET_INCLUDES);
    expect(mail.text).toContain(TICKET_INCLUDES);
  });

  it("names the welcome drink, which the old email left out entirely", () => {
    expect(mail.html).toMatch(/welcome drink on arrival/i);
  });

  // Nobody who has just bought a ticket needs a paragraph about a tax relief they did not claim
  // and cannot claim on a ticket. It read as a form letter at the one moment the email should
  // feel like a welcome.
  it("says nothing about Gift Aid when none was added", () => {
    expect(mail.html).not.toMatch(/gift aid/i);
    expect(mail.text).not.toMatch(/gift aid/i);
  });

  // But a donor who DID add it gets it acknowledged, with the reason it cannot touch the ticket.
  it("thanks a donor who did add Gift Aid, and stays honest about the ticket", () => {
    const withGiftAid = buildBallConfirmationEmail(
      { ...booking, donationPence: 2_500, giftAid: true },
      details,
    );
    expect(withGiftAid.html).toMatch(/gift aid/i);
    expect(withGiftAid.html).toMatch(/can(no|')t be claimed on ticket/i);
  });
});
