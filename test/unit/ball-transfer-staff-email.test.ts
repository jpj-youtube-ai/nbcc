import { describe, it, expect } from "vitest";
import { buildTransferStaffEmail } from "../../src/ball/transfer-staff-email";

// TASK-487: the email to events@nbcc.scot for each new bank transfer booking, so the team knows to
// look out for the money. Every name, number and amount here is invented: this repository is public.

const booking = {
  reference: "BALL-7KQ2MZ",
  kind: "table" as const,
  quantity: 1,
  seats: 10,
  buyerName: "Ada Test",
  buyerEmail: "ada@example.com",
  ticketsPence: 100_000,
  donationPence: 2_000,
  totalPence: 102_000,
  giftAid: false,
};
const base = { payBy: "2026-10-08", adminUrl: "https://nbcc.scot/admin", invoice: null };

describe("the events@ email for a new bank transfer booking", () => {
  const mail = buildTransferStaffEmail(booking, base);

  it("says who, how much and which booking in the subject", () => {
    expect(mail.subject).toBe("New bank transfer booking: BALL-7KQ2MZ, £1,020.00, Ada Test");
  });

  it("gives what to look out for in the bank, and by when", () => {
    for (const part of ["a table of 10", "£1,020.00", "BALL-7KQ2MZ", "Thursday 8 October", "ada@example.com"]) {
      expect(mail.text, part).toContain(part);
      expect(mail.html, part).toContain(part);
    }
  });

  it("links the admin, where it is marked paid", () => {
    expect(mail.html).toContain('href="https://nbcc.scot/admin"');
    expect(mail.text).toContain("https://nbcc.scot/admin");
    expect(mail.text).toMatch(/Awaiting transfer/);
  });

  it("names the company and links its invoice when there is one, and not otherwise", () => {
    expect(mail.text).not.toMatch(/invoice/i);
    const invoiced = buildTransferStaffEmail(booking, {
      ...base,
      payBy: "2026-10-15",
      invoice: { company: "Example Widgets Ltd", url: "https://nbcc.scot/ball/invoice/42.abc" },
    });
    expect(invoiced.text).toContain("Example Widgets Ltd");
    expect(invoiced.html).toContain('href="https://nbcc.scot/ball/invoice/42.abc"');
    expect(invoiced.text).toContain("https://nbcc.scot/ball/invoice/42.abc");
  });

  it("escapes what the buyer typed", () => {
    const mail2 = buildTransferStaffEmail(
      { ...booking, buyerName: "<b>x</b>" },
      { ...base, invoice: { company: "<i>Co</i>", url: "https://nbcc.scot/ball/invoice/1.a" } },
    );
    expect(mail2.html).not.toContain("<b>x</b>");
    expect(mail2.html).not.toContain("<i>Co</i>");
  });

  it("has a plain text part with no markup", () => {
    expect(mail.text).not.toContain("<");
  });
});
