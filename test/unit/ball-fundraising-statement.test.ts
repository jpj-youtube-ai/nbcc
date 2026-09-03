import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FUNDRAISING_STATEMENT,
  CHARITY_STATEMENT,
  CHARITY_STATEMENT_HTML,
} from "../../src/ball/fundraising-statement";
import { buildBallConfirmationEmail } from "../../src/ball/confirmation-email";
import { buildBallReminderEmail } from "../../src/ball/reminder-email";

// TASK-347: Appendix A of the fundraising agreement requires this wording VERBATIM. These are not
// style assertions - they are the text of a signed agreement, and a reworded version is a breach
// rather than a preference.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

// Collapsed, because the same sentence is wrapped differently in HTML, in a plain-text email and
// in a TypeScript string. Comparing raw would fail on a line break rather than on the wording.
const flat = (s: string) => s.replace(/\s+/g, " ");

// One paid table, enough to render either email in full.
const sampleBooking = {
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
const sampleDetails = { arrivalTime: null, includedNote: null, guestLink: null };

describe("Appendix A2 is quoted exactly", () => {
  // The three parts clause 11.1 makes mandatory.
  it.each([
    ["who organised it", "Organised and sponsored by The Designer Rooms in aid of NBCC."],
    ["that they take nothing", "The Designer Rooms receives no payment for organising this event."],
    ["where the money goes", "all proceeds from ticket sales are donated to the charity"],
  ])("says %s", (_part, sentence) => {
    expect(FUNDRAISING_STATEMENT).toContain(sentence);
  });

  it("is one statement, not a paraphrase assembled elsewhere", () => {
    expect(flat(FUNDRAISING_STATEMENT)).toBe(
      "Organised and sponsored by The Designer Rooms in aid of NBCC. The Designer Rooms is " +
        "covering the full cost of the evening, so all proceeds from ticket sales are donated " +
        "to the charity. The Designer Rooms receives no payment for organising this event.",
    );
  });
});

describe("Appendix A1 links the charity number online", () => {
  // "Online, the charity number links to the Charity's entry on the Scottish Charity Register."
  it("makes the number itself the link", () => {
    expect(CHARITY_STATEMENT_HTML).toMatch(/<a href="https:\/\/www\.oscr\.org\.uk[^"]*"[^>]*>SC047995<\/a>/);
  });

  it("keeps the plain-text form unlinked, for print", () => {
    expect(CHARITY_STATEMENT).toContain("Scottish Charity Number SC047995.");
    expect(CHARITY_STATEMENT).not.toContain("<a ");
  });
});

describe("the statement reaches every surface the agreement names", () => {
  // Clause 11.1: "All promotional material for the event, AND the point at which tickets are
  // bought". So the page, the terms, the confirmation email and the thank-you page.
  // The emails are checked as they are RENDERED, not as they are written. The statement used to
  // be typed into confirmation-email.ts and is now composed into the shared sponsor band that
  // every ball email carries (src/ball/email-shell.ts), so reading that one source file proves
  // nothing either way. Rendering is also the stronger assertion: it fails if the band is
  // dropped from the shell, which grepping a source file would not catch.
  const confirmation = buildBallConfirmationEmail(sampleBooking, sampleDetails);
  const surfaces: Array<[string, string]> = [
    ["the ball page", read("ball.html")],
    ["the ticket terms", read("ball-terms.html")],
    ["the confirmation email (html)", confirmation.html],
    ["the confirmation email (text)", confirmation.text],
    ["the reminder email (html)", buildBallReminderEmail(sampleBooking, [], sampleDetails).html],
    ["the thank-you page", read("src/ball/thank-you-page.ts")],
    ["the home page promotion", read("src/ball/home-promo.ts")],
  ];

  it.each(surfaces)("%s carries the agreed statement", (_where, source) => {
    // Either quoted inline (static HTML) or composed from the constant (server-rendered).
    const carries =
      flat(source).includes(flat(FUNDRAISING_STATEMENT)) ||
      source.includes("FUNDRAISING_STATEMENT");
    expect(carries).toBe(true);
  });
});

describe("NBCC's own warmer wording is kept, not replaced", () => {
  // The agreed sentence does the legal work; this does the human work. Losing it would be a
  // regression in the other direction.
  it("still thanks the sponsor in the charity's own voice", () => {
    expect(read("ball.html")).toMatch(/proud to have The Designer Rooms behind this/i);
  });
});
