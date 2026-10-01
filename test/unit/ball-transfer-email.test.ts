import { describe, it, expect } from "vitest";
import { buildTransferDetailsEmail, buildTransferCancelledEmail, buildTransferReminderEmail } from "../../src/ball/transfer-email";

// TASK-484: the emails a bank transfer buyer receives before their money arrives. Every name, number
// and amount here is invented: this repository is public.

const booking = {
  reference: "BALL-7KQ2MZ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Ada Test",
  ticketsPence: 100_000,
  donationPence: 2_000,
  totalPence: 102_000,
  giftAid: true,
};
const bank = { accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678" };

describe("the bank details email", () => {
  const mail = buildTransferDetailsEmail(booking, bank, "2026-10-08");

  it("says how much, to which account, with which reference, by when", () => {
    for (const part of ["£1,020.00", "12-34-56", "12345678", "Night Before Christmas Campaign", "BALL-7KQ2MZ", "Thursday 8 October"]) {
      expect(mail.text, part).toContain(part);
      expect(mail.html, part).toContain(part);
    }
  });

  it("names the booking in the subject", () => {
    expect(mail.subject).toBe("How to pay for your Festive Ball booking BALL-7KQ2MZ");
  });

  it("says the seats are held, and what happens when the money arrives", () => {
    expect(mail.text).toMatch(/held for you until Thursday 8 October/);
    expect(mail.text).toMatch(/who's coming/);
  });

  it("asks for the reference exactly as written", () => {
    expect(mail.text).toMatch(/reference exactly as it is written/);
  });

  it("shows the donation and mentions Gift Aid only when there is one", () => {
    expect(mail.text).toContain("Donation to NBCC");
    expect(mail.text).toMatch(/Gift Aid/);
    const plain = buildTransferDetailsEmail({ ...booking, donationPence: 0, totalPence: 100_000, giftAid: false }, bank, "2026-10-08");
    expect(plain.text).not.toContain("Donation to NBCC");
    expect(plain.text).not.toMatch(/Gift Aid/);
  });

  it("escapes what the buyer typed", () => {
    expect(buildTransferDetailsEmail({ ...booking, buyerName: "<b>x</b>" }, bank, "2026-10-08").html).not.toContain("<b>x</b>");
  });
});

// TASK-485: two days before the date, if it is still unpaid.
describe("the reminder", () => {
  const mail = buildTransferReminderEmail(booking, bank, "2026-10-08");

  it("names the booking and the date in the subject", () => {
    expect(mail.subject).toBe("Reminder: please pay for your Festive Ball booking BALL-7KQ2MZ by Thursday 8 October");
  });

  it("gives everything needed to pay again, so nobody has to find the first email", () => {
    for (const part of ["£1,020.00", "12-34-56", "12345678", "Night Before Christmas Campaign", "BALL-7KQ2MZ"]) {
      expect(mail.text, part).toContain(part);
      expect(mail.html, part).toContain(part);
    }
  });

  // Their money may be on its way while this is being sent.
  it("tells someone who has already paid that there is nothing to do", () => {
    expect(mail.text).toMatch(/already paid, thank you/);
  });

  it("escapes what the buyer typed", () => {
    expect(buildTransferReminderEmail({ ...booking, buyerName: "<b>x</b>" }, bank, "2026-10-08").html).not.toContain("<b>x</b>");
  });
});

// TASK-486: a booking with an invoice links it from every email about it.
describe("the emails for a booking with an invoice", () => {
  const url = "https://nbcc.scot/ball/invoice/42.abc";

  it("link the invoice from the bank details email and the reminder", () => {
    for (const mail of [
      buildTransferDetailsEmail(booking, bank, "2026-10-08", { invoiceUrl: url }),
      buildTransferReminderEmail(booking, bank, "2026-10-08", { invoiceUrl: url }),
    ]) {
      expect(mail.html).toContain(`href="${url}"`);
      expect(mail.text).toContain(url);
      expect(mail.text).toMatch(/invoice/i);
    }
  });

  it("say nothing about an invoice when there is none", () => {
    expect(buildTransferDetailsEmail(booking, bank, "2026-10-08").text).not.toMatch(/invoice/i);
  });

  it("link it from the cancelled email, which it now shows as cancelled", () => {
    const mail = buildTransferCancelledEmail(booking, { invoiceUrl: url });
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.text).toContain(url);
  });
});

describe("the cancelled email", () => {
  const mail = buildTransferCancelledEmail(booking);

  it("says the booking is cancelled and the seats released", () => {
    expect(mail.subject).toBe("Your Festive Ball booking BALL-7KQ2MZ has been cancelled");
    expect(mail.text).toMatch(/cancelled it and released the seats/);
  });

  it("tells someone who did pay what to do", () => {
    expect(mail.text).toMatch(/already paid/);
  });
});
