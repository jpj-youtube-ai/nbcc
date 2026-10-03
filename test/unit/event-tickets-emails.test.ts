import { describe, it, expect } from "vitest";
import {
  buildTicketConfirmationEmail,
  buildTicketRefundEmail,
  buildRefundRequestStaffEmail,
  buildTicketsProposedStaffEmail,
  buildOrderFlagStaffEmail,
  buildBookingCancelledEmail,
  buildTicketsReleasedEmail,
  buildUnknownPaymentStaffEmail,
  type TicketEmailEvent,
} from "../../src/tickets/emails";

const event: TicketEmailEvent = {
  title: "Example Quiz Night",
  eventDate: "2026-12-05",
  startTime: "19:30",
  endTime: "22:30",
  timeTbc: false,
  where: "Example Village Hall, Main Street, Exampleton, KA1 1AA",
  organisedBy: "The Example Quiz Team",
  pageUrl: "https://nbcc.scot/event/example-quiz",
};

const order = {
  reference: "TIX-ABCDEF",
  firstName: "Robin",
  lines: [
    { id: 1, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 },
    { id: 2, typeName: "Child", unitPence: 500, quantity: 1, refundedQuantity: 0 },
  ],
  ticketsPence: 2500,
  feeCoverPence: 52,
  totalPence: 2552,
};

describe("the buyer's tickets email", () => {
  const mail = buildTicketConfirmationEmail(event, order);

  it("says what it is in the subject", () => {
    expect(mail.subject).toBe("Your tickets for Example Quiz Night");
  });

  it("lists the tickets, the reference, the money and when and where, in both parts", () => {
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain("TIX-ABCDEF");
      expect(part).toContain("2 × Adult");
      expect(part).toContain("1 × Child");
      expect(part).toContain("£25.52");
      expect(part).toContain("£0.52 to cover the card fee");
      expect(part).toContain("Saturday 5 December 2026, 7.30pm to 10.30pm");
      expect(part).toContain("Example Village Hall, Main Street, Exampleton, KA1 1AA");
      expect(part).toContain("Show this email at the door");
    }
  });

  it("says ticket money is not a donation, so there is no Gift Aid on it", () => {
    expect(mail.text).toContain("Tickets are not donations, so Gift Aid does not apply to them.");
    expect(mail.text).toContain("children, young people and vulnerable adults");
    expect(mail.text).not.toMatch(/families/i);
  });

  it("greets only a safe first name, and escapes what was typed", () => {
    expect(mail.text.startsWith("Hi Robin,")).toBe(true);
    const odd = buildTicketConfirmationEmail({ ...event, title: "<b>Quiz</b>" }, { ...order, firstName: "<script>" });
    expect(odd.html).not.toContain("<b>Quiz</b>");
    expect(odd.html).toContain("&lt;b&gt;Quiz&lt;/b&gt;");
    expect(odd.text.startsWith("Hi there,")).toBe(true);
  });

  it("leaves out the fee line when the fee was not covered", () => {
    const plain = buildTicketConfirmationEmail(event, { ...order, feeCoverPence: 0, totalPence: 2500 });
    expect(plain.text).not.toContain("card fee");
    expect(plain.text).toContain("£25");
  });
});

describe("the buyer's refund email", () => {
  it("says how much went back, and that the booking is cancelled when it is all refunded", () => {
    const mail = buildTicketRefundEmail(event, { reference: "TIX-ABCDEF", firstName: "Robin", amountPence: 2552, full: true, standing: "" });
    expect(mail.subject).toBe("Your refund for Example Quiz Night");
    expect(mail.text).toContain("We have refunded £25.52 to the card you paid with.");
    expect(mail.text).toContain("Your booking TIX-ABCDEF is now cancelled.");
    expect(mail.text).toContain("5 to 10 working days");
  });

  it("says which tickets still stand after a partial refund", () => {
    const mail = buildTicketRefundEmail(event, { reference: "TIX-ABCDEF", firstName: "Robin", amountPence: 1000, full: false, standing: "1 Adult, 1 Child" });
    expect(mail.text).toContain("You still have 1 Adult, 1 Child on booking TIX-ABCDEF. Show your tickets email at the door as before.");
  });
});

describe("the staff email for a refund request", () => {
  it("names the event, the booking and the reason, and replies to the organiser", () => {
    const mail = buildRefundRequestStaffEmail(
      { title: "Example Quiz Night", organiserName: "Kim Example" },
      { reference: "TIX-ABCDEF", buyerName: "Robin Example", tickets: "2 Adult", reason: "They are ill and cannot come." },
      { adminUrl: "https://nbcc.scot/admin" },
    );
    expect(mail.subject).toBe("Refund asked for: TIX-ABCDEF, Example Quiz Night");
    expect(mail.text).toContain("Kim Example has asked for a refund of booking TIX-ABCDEF (Robin Example, 2 Adult).");
    expect(mail.text).toContain("They are ill and cannot come.");
    expect(mail.text).toContain("Only an admin can make the refund, in Admin > Fundraising > Event tickets.");
  });
});

describe("the staff email for tickets to approve", () => {
  it("lists what was proposed", () => {
    const mail = buildTicketsProposedStaffEmail(
      { title: "Example Quiz Night", organiserName: "Kim Example" },
      { types: [{ name: "Adult", pricePence: 1000, quantity: 80 }], salesLimit: 100 },
      { adminUrl: "https://nbcc.scot/admin" },
    );
    expect(mail.subject).toBe("Tickets to approve: Example Quiz Night");
    expect(mail.text).toContain("Adult at £10, 80 on sale");
    expect(mail.text).toContain("At most 100 tickets in all");
  });
});

describe("the staff email about a booking to check", () => {
  it("names the booking and says what to look at", () => {
    const mail = buildOrderFlagStaffEmail(
      { title: "Example Quiz Night" },
      { reference: "TIX-ABCDEF", buyerName: "Robin Example", tickets: "2 Adult", paid: "£25.52" },
      ["Paid late: this event is now 2 over its limit", "Amount paid doesn't match: check this booking"],
      { adminUrl: "https://nbcc.scot/admin" },
    );
    expect(mail.subject).toBe("Check this ticket booking: TIX-ABCDEF, Example Quiz Night");
    expect(mail.text).toContain("Paid late: this event is now 2 over its limit");
    expect(mail.text).toContain("Amount paid doesn't match: check this booking");
    expect(mail.text).toContain("Robin Example, 2 Adult, paid £25.52");
    expect(mail.text).toContain("The payment is recorded and the buyer has their tickets email.");
    expect(mail.html).toContain("TIX-ABCDEF");
  });
});

describe("a free booking's emails", () => {
  const free = {
    reference: "TIX-FREEAA",
    firstName: "Robin",
    lines: [{ id: 1, typeName: "Under 5", unitPence: 0, quantity: 2, refundedQuantity: 0 }],
    ticketsPence: 0,
    feeCoverPence: 0,
    totalPence: 0,
  };

  it("says the tickets are free and there was nothing to pay", () => {
    const mail = buildTicketConfirmationEmail(event, free);
    expect(mail.text).toContain("2 × Under 5, free");
    expect(mail.text).toContain("Paid: Nothing to pay");
    expect(mail.text).toContain("Show this email at the door");
    expect(mail.text).not.toContain("Every penny of your ticket money");
  });

  it("tells the buyer when their booking is cancelled", () => {
    const mail = buildBookingCancelledEmail(event, { reference: "TIX-FREEAA", firstName: "Robin", tickets: "2 Under 5" });
    expect(mail.subject).toBe("Your booking is cancelled: Example Quiz Night");
    expect(mail.text).toContain("Your booking is cancelled");
    expect(mail.text).toContain("Your booking TIX-FREEAA (2 Under 5) for Example Quiz Night has been cancelled, so please do not come along on these tickets.");
  });
});

describe("tickets released with no money moving", () => {
  it("tells the buyer which tickets are cancelled and what still stands", () => {
    const mail = buildTicketsReleasedEmail(event, { reference: "TIX-ABCDEF", firstName: "Robin", released: "1 Under 5", standing: "2 Adult" });
    expect(mail.subject).toBe("Tickets cancelled: Example Quiz Night");
    expect(mail.text).toContain("These tickets on your booking TIX-ABCDEF for Example Quiz Night have been cancelled: 1 Under 5.");
    expect(mail.text).toContain("You still have 2 Adult. Show your tickets email at the door as before.");
    expect(buildTicketsReleasedEmail(event, { reference: "TIX-ABCDEF", firstName: "Robin", released: "2 Adult", standing: "" }).text).toContain("so it is now cancelled");
  });
});

describe("a ticket payment with no booking", () => {
  it("tells the events inbox what Stripe said", () => {
    const mail = buildUnknownPaymentStaffEmail({ reference: "TIX-ABCDEF", sessionId: "cs_test_1", amountTotal: 2552 }, { adminUrl: "https://nbcc.scot/admin" });
    expect(mail.subject).toBe("Ticket payment with no booking: TIX-ABCDEF");
    expect(mail.text).toContain("Stripe took a ticket payment of £25.52 for booking TIX-ABCDEF, but there is no booking with that reference here.");
    expect(mail.text).toContain("checkout cs_test_1");
  });
});
