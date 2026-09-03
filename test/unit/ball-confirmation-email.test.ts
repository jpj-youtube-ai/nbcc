import { describe, it, expect } from "vitest";
import { buildBallConfirmationEmail } from "../../src/ball/confirmation-email";

const seatBooking = {
  reference: "BALL-ABC234",
  kind: "seat" as const,
  quantity: 2,
  seats: 2,
  buyerName: "Jo Smith",
  buyerEmail: "jo@example.com",
  ticketsPence: 20_000,
  donationPence: 0,
  feeCoverPence: 0,
  totalPence: 20_000,
  giftAid: false,
  newsletterOptIn: false,
  stripeSessionId: "cs_test_1",
};

const tableBooking = {
  ...seatBooking,
  reference: "BALL-XYZ789",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Ayrshire Bakery",
  ticketsPence: 100_000,
  donationPence: 2_500,
  feeCoverPence: 1_558,
  totalPence: 104_058,
  giftAid: true,
};

const noArrival = { arrivalTime: null, includedNote: null };

describe("buildBallConfirmationEmail", () => {
  it("puts the booking reference in the subject so it is findable later", () => {
    const mail = buildBallConfirmationEmail(seatBooking, noArrival);
    expect(mail.subject).toContain("BALL-ABC234");
  });

  it("says plainly what was bought", () => {
    const mail = buildBallConfirmationEmail(seatBooking, noArrival);
    expect(mail.html).toContain("2 tickets");
    expect(mail.text).toContain("2 tickets");
  });

  it("describes a table by its seats, not just as one item", () => {
    const mail = buildBallConfirmationEmail(tableBooking, noArrival);
    expect(mail.html).toMatch(/table of 10/i);
  });

  it("shows the money broken down, not just a total", () => {
    const mail = buildBallConfirmationEmail(tableBooking, noArrival);
    expect(mail.html).toContain("£1,000.00");
    expect(mail.html).toContain("£25.00");
    expect(mail.html).toContain("£15.58");
    expect(mail.html).toContain("£1,040.58");
  });

  // Assert on the ROW LABELS, not the word anywhere in the document. The email deliberately
  // still explains Gift Aid to a buyer who did not donate (it heads off a support email), so a
  // bare /donation/i search fails on prose while the receipt itself is correct.
  it("omits the donation and fee ROWS entirely when there are none", () => {
    const mail = buildBallConfirmationEmail(seatBooking, noArrival);
    expect(mail.html).not.toContain("Donation to NBCC");
    expect(mail.html).not.toContain("Card fee covered");
    expect(mail.text).not.toContain("Donation to NBCC");
    // and the one row that must always be there
    expect(mail.html).toContain("Total paid");
  });

  it("thanks a Gift Aid donor for the declaration", () => {
    const mail = buildBallConfirmationEmail(tableBooking, noArrival);
    expect(mail.html).toMatch(/gift aid/i);
  });

  it("never claims Gift Aid on the ticket itself", () => {
    const mail = buildBallConfirmationEmail(tableBooking, noArrival);
    // HMRC does not allow it: the buyer receives a dinner and a show in return.
    expect(mail.html).toMatch(/can(no|')t be claimed on ticket|not.{0,20}on ticket/i);
  });

  it("carries the event details a guest actually needs", () => {
    const mail = buildBallConfirmationEmail(seatBooking, noArrival);
    for (const detail of ["7th November 2026", "The Park Hotel", "Dress to impress", "over 18"]) {
      expect(mail.html.toLowerCase()).toContain(detail.toLowerCase());
    }
  });

  it("is honest that the start time is not settled yet", () => {
    const mail = buildBallConfirmationEmail(seatBooking, noArrival);
    expect(mail.html).toMatch(/to be confirmed/i);
  });

  it("uses a confirmed arrival time once there is one", () => {
    const mail = buildBallConfirmationEmail(seatBooking, {
      arrivalTime: "7pm for 7.30pm",
      includedNote: null,
    });
    expect(mail.html).toContain("7pm for 7.30pm");
    expect(mail.html).not.toMatch(/start time to be confirmed/i);
  });

  it("tells the buyer transfers are fine but refunds are not", () => {
    const mail = buildBallConfirmationEmail(seatBooking, noArrival);
    expect(mail.html).toMatch(/transfer/i);
    expect(mail.html).toMatch(/non-refundable/i);
  });

  it("carries the charity registration statement", () => {
    const mail = buildBallConfirmationEmail(seatBooking, noArrival);
    expect(mail.html).toContain("SC047995");
    expect(mail.text).toContain("SC047995");
  });

  it("escapes a buyer name so it cannot break the markup", () => {
    const mail = buildBallConfirmationEmail(
      { ...seatBooking, buyerName: 'Jo <img src=x onerror="alert(1)">' },
      noArrival,
    );
    // Asserts on the INJECTION, not on the string "<img" anywhere in the document. The branded
    // shell carries two legitimate images of its own now (the NBCC letterhead and the sponsor
    // wordmark), so a blanket ban on the tag would fail on the design rather than on a hole.
    expect(mail.html).not.toContain("<img src=x");
    // The escaped text still reads "onerror=&quot;", which is the SAFE outcome. What must not
    // appear is the live attribute, quote and all.
    expect(mail.html).not.toContain('onerror="');
    expect(mail.html).toContain("&lt;img");
  });

  it("always provides a plain-text alternative", () => {
    const mail = buildBallConfirmationEmail(tableBooking, noArrival);
    expect(mail.text.length).toBeGreaterThan(200);
    expect(mail.text).not.toContain("<");
  });
});

describe("the guest details link", () => {
  const base = {
    reference: "BALL-ABC234",
    kind: "table" as const,
    quantity: 1,
    seats: 10,
    buyerName: "Jo Smith",
    buyerEmail: "jo@example.com",
    ticketsPence: 100_000,
    donationPence: 0,
    feeCoverPence: 0,
    totalPence: 100_000,
    giftAid: false,
    newsletterOptIn: false,
    stripeSessionId: "cs_1",
  };

  it("invites the booker to add their table when a link exists", () => {
    const mail = buildBallConfirmationEmail(base, {
      arrivalTime: null,
      includedNote: null,
      guestLink: "https://nbcc.scot/ball/guests/tok123",
    });
    expect(mail.html).toContain("https://nbcc.scot/ball/guests/tok123");
    expect(mail.html).toMatch(/Add your guests/);
    expect(mail.text).toContain("https://nbcc.scot/ball/guests/tok123");
  });

  it("falls back to a promise to ask later when there is no link", () => {
    const mail = buildBallConfirmationEmail(base, { arrivalTime: null, includedNote: null });
    expect(mail.html).toMatch(/Nearer the time we'll ask/);
    expect(mail.html).not.toMatch(/Add your guests/);
  });

  it("says why we are asking, not just that we are", () => {
    const mail = buildBallConfirmationEmail(base, {
      arrivalTime: null,
      includedNote: null,
      guestLink: "https://nbcc.scot/ball/guests/t",
    });
    expect(mail.html).toMatch(/so the venue can look after everyone properly/i);
    expect(mail.html).toMatch(/save what you know and come back/i);
  });
});
