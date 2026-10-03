import { describe, it, expect } from "vitest";
import {
  purchaseSchema,
  ballMetadata,
  bookingRequestError,
  PHONE_REQUIRED_MESSAGE,
  PHONE_INVALID_MESSAGE,
} from "../../src/ball/booking";
import { bookingsCsv, type ExportBooking } from "../../src/ball/exports";
import { buildTransferStaffEmail } from "../../src/ball/transfer-staff-email";

// Jaimie 2026-10-03: the Festive Ball booking form asks for the booker's phone number, required, so
// NBCC can contact them about menu choices for their table. NBCC only: it never goes to Stripe's
// metadata, the venue or the organiser. Every name and number here is invented (Ofcom's drama range).

const valid = {
  kind: "seat",
  quantity: 2,
  buyerFirstName: "Jo",
  buyerSurname: "Smith",
  buyerEmail: "jo@example.com",
  buyerPhone: "07700 900123",
  termsAccepted: true,
};

const issuesFor = (body: Record<string, unknown>) => {
  const r = purchaseSchema.safeParse(body);
  return r.success ? [] : r.error.issues;
};

describe("the booker's phone number on a new booking", () => {
  it("is required", () => {
    const without = { ...valid, buyerPhone: undefined };
    const issues = issuesFor(without);
    expect(issues.map((i) => i.path.join("."))).toContain("buyerPhone");
    expect(issuesFor({ ...valid, buyerPhone: "   " }).map((i) => i.path.join("."))).toContain("buyerPhone");
  });

  it.each([
    ["a mobile", "07700 900123"],
    ["a mobile with no spaces", "07700900123"],
    ["a landline", "01632 960123"],
    ["an international mobile", "+44 7700 900123"],
    ["a landline in brackets", "(01632) 960 123"],
  ])("accepts %s", (_label, phone) => {
    const p = purchaseSchema.parse({ ...valid, buyerPhone: phone });
    expect(p.buyerPhone).toBe(phone);
  });

  it("trims the spaces round it", () => {
    expect(purchaseSchema.parse({ ...valid, buyerPhone: "  07700 900123 " }).buyerPhone).toBe("07700 900123");
  });

  it.each([
    ["letters", "call me"],
    ["too few digits", "12345"],
    ["an email address", "jo@example.com"],
    ["something far too long", "0".repeat(41)],
  ])("refuses %s", (_label, phone) => {
    expect(issuesFor({ ...valid, buyerPhone: phone }).map((i) => i.path.join("."))).toContain("buyerPhone");
  });

  it("is never stamped on the Stripe session", () => {
    const md = ballMetadata(purchaseSchema.parse(valid), "BALL-ABC234", 2);
    expect(Object.values(md).join(" ")).not.toContain("900123");
    expect(Object.keys(md)).not.toContain("buyerPhone");
  });
});

describe("the error a booking without a phone number gets back", () => {
  it("names the phone number, in words the booker can act on", () => {
    const without = { ...valid, buyerPhone: undefined };
    expect(bookingRequestError(issuesFor(without))).toBe(PHONE_REQUIRED_MESSAGE);
    expect(PHONE_REQUIRED_MESSAGE).toMatch(/phone number/i);
    expect(PHONE_REQUIRED_MESSAGE).toMatch(/menu/i);
  });

  it("says to check it when one was given but does not look right", () => {
    expect(bookingRequestError(issuesFor({ ...valid, buyerPhone: "call me" }))).toBe(PHONE_INVALID_MESSAGE);
  });

  it("keeps the existing words for anything else", () => {
    expect(bookingRequestError(issuesFor({ ...valid, buyerEmail: "nope" }))).toBe("Invalid booking request");
  });
});

describe("the bookings export", () => {
  const booking: ExportBooking = {
    reference: "BALL-AAA111",
    kind: "table",
    quantity: 1,
    seats: 10,
    buyerName: "Jo Smith",
    buyerFirstName: "Jo",
    buyerSurname: "Smith",
    buyerEmail: "jo@example.com",
    buyerPhone: "07700 900123",
    ticketsPence: 100_000,
    donationPence: 0,
    feeCoverPence: 0,
    totalPence: 100_000,
    giftAid: false,
    newsletterOptIn: false,
    status: "paid",
    tableName: null,
    createdAt: "2026-09-05T10:00:00.000Z",
  };

  it("has a Phone column, straight after Email", () => {
    const [header, row] = bookingsCsv([booking]).split("\r\n");
    const cols = header.split(",");
    expect(cols.indexOf('"Phone"')).toBe(cols.indexOf('"Email"') + 1);
    expect(row.split(",")[cols.indexOf('"Phone"')]).toBe('"07700 900123"');
  });

  it("leaves it blank for a booking made before we asked", () => {
    const [header, row] = bookingsCsv([{ ...booking, buyerPhone: null }]).split("\r\n");
    const at = header.split(",").indexOf('"Phone"');
    expect(row.split(",")[at]).toBe('""');
  });
});

describe("the events@ email for a new bank transfer booking", () => {
  const b = {
    reference: "BALL-7KQ2MZ",
    kind: "table" as const,
    quantity: 1,
    seats: 10,
    buyerName: "Ada Test",
    buyerEmail: "ada@example.com",
    ticketsPence: 100_000,
    donationPence: 0,
    totalPence: 100_000,
    giftAid: false,
  };
  const o = { payBy: "2026-10-08", adminUrl: "https://nbcc.scot/admin", invoice: null };

  it("gives the buyer's phone number when there is one", () => {
    const mail = buildTransferStaffEmail({ ...b, buyerPhone: "07700 900123" }, o);
    expect(mail.text).toContain("07700 900123");
    expect(mail.html).toContain("07700 900123");
    expect(mail.html).toContain('href="tel:07700900123"');
  });

  it("says nothing about a phone when there is none", () => {
    const mail = buildTransferStaffEmail(b, o);
    expect(mail.text).not.toMatch(/phone/i);
  });
});
