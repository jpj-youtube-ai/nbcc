import { describe, it, expect } from "vitest";
import {
  csvCell,
  surnameOf,
  doorListCsv,
  cateringCsv,
  bookingsCsv,
  type ExportGuest,
  type ExportBooking,
} from "../../src/ball/exports";

const guests: ExportGuest[] = [
  { fullName: "Jo Smith", dietary: "Coeliac", accessNeeds: null, tableName: "Bakery", reference: "BALL-AAA111" },
  { fullName: "Pat Brown", dietary: null, accessNeeds: null, tableName: "Bakery", reference: "BALL-AAA111" },
  { fullName: "Ayesha Khan", dietary: null, accessNeeds: "Step-free access", tableName: "Team Ayr", reference: "BALL-BBB222" },
];

const booking: ExportBooking = {
  reference: "BALL-AAA111",
  kind: "table",
  quantity: 1,
  seats: 10,
  buyerName: "Jo Smith",
  buyerFirstName: "Jo",
  buyerSurname: "Smith",
  buyerEmail: "jo@example.com",
  ticketsPence: 100_000,
  donationPence: 2_500,
  feeCoverPence: 1_558,
  totalPence: 104_058,
  giftAid: true,
  newsletterOptIn: true,
  status: "paid",
  tableName: "Bakery",
  createdAt: "2026-09-05T10:00:00.000Z",
};

describe("csvCell", () => {
  it("quotes and escapes embedded quotes", () => {
    expect(csvCell('He said "hello"')).toBe('"He said ""hello"""');
  });

  it("keeps commas and newlines inside the cell", () => {
    expect(csvCell("Coeliac, no shellfish")).toBe('"Coeliac, no shellfish"');
  });

  it("defuses a formula so a spreadsheet cannot execute what a guest typed", () => {
    // Guests type these fields themselves; =cmd|... in a dietary note is a real attack on
    // whoever opens the file.
    expect(csvCell("=1+1")).toBe("\"'=1+1\"");
    expect(csvCell("+44 7700 900000")).toBe("\"'+44 7700 900000\"");
    expect(csvCell("@example")).toBe("\"'@example\"");
  });

  it("leaves ordinary text alone", () => {
    expect(csvCell("Jo Smith")).toBe('"Jo Smith"');
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe("surnameOf", () => {
  it("takes the last word", () => {
    expect(surnameOf("Jo Smith")).toBe("smith");
    expect(surnameOf("Ayesha Noor Khan")).toBe("khan");
  });
  it("falls back to the only word given", () => {
    expect(surnameOf("Madonna")).toBe("madonna");
  });
});

describe("doorListCsv", () => {
  it("is alphabetical by surname, which is how a door list is read", () => {
    const lines = doorListCsv(guests).split("\r\n");
    expect(lines[0]).toBe('"Name","Table","Booking"');
    expect(lines[1]).toContain("Pat Brown"); // Brown
    expect(lines[2]).toContain("Ayesha Khan"); // Khan
    expect(lines[3]).toContain("Jo Smith"); // Smith
  });

  it("lists everyone, including guests with nothing to declare", () => {
    expect(doorListCsv(guests).split("\r\n")).toHaveLength(4);
  });

  it("carries no contact details — it is printed and left on a desk all evening", () => {
    expect(doorListCsv(guests)).not.toContain("@");
  });
});

describe("cateringCsv", () => {
  it("includes only guests who have something to tell the kitchen", () => {
    const lines = cateringCsv(guests).split("\r\n");
    expect(lines).toHaveLength(3); // header + Jo (coeliac) + Ayesha (access)
    expect(cateringCsv(guests)).not.toContain("Pat Brown");
  });

  it("carries NOTHING beyond what the venue needs", () => {
    // This is the one export that leaves NBCC, and the ticket page promises the venue is told
    // nothing else. Keep that promise here rather than trusting whoever assembles the file.
    const csv = cateringCsv(guests);
    expect(csv).not.toContain("@");           // no email addresses
    expect(csv).not.toMatch(/BALL-[A-Z0-9]/); // no booking references
    expect(csv).not.toMatch(/\d+\.\d\d/);     // no money
  });

  it("groups by table so the kitchen can work through the room", () => {
    const lines = cateringCsv(guests).split("\r\n");
    expect(lines[0]).toBe('"Table","Guest","Menu","Food","Access"');
    expect(lines[1]).toContain("Bakery");
    expect(lines[2]).toContain("Team Ayr");
  });

  it("is just a header when nobody has declared anything", () => {
    const none = guests.map((g) => ({ ...g, dietary: null, accessNeeds: null }));
    expect(cateringCsv(none).split("\r\n")).toHaveLength(1);
  });
});

describe("bookingsCsv", () => {
  it("renders money as decimal pounds for a spreadsheet", () => {
    const csv = bookingsCsv([booking]);
    expect(csv).toContain('"1000.00"');
    expect(csv).toContain('"25.00"');
    expect(csv).toContain('"1040.58"');
  });

  it("flags Gift Aid and newsletter opt-ins so they can be actioned", () => {
    expect(bookingsCsv([booking])).toContain('"yes"');
  });

  it("keeps the buyer's email, because this list stays inside NBCC", () => {
    expect(bookingsCsv([booking])).toContain("jo@example.com");
  });
});

describe("bookingsCsv name columns (TASK-318)", () => {
  it("keeps first name and surname in their own columns, so it sorts by surname", () => {
    const lines = bookingsCsv([booking]).split("\r\n");
    expect(lines[0]).toContain('"First name"');
    expect(lines[0]).toContain('"Surname"');
    expect(lines[1]).toContain('"Jo"');
    expect(lines[1]).toContain('"Smith"');
  });

  // Bookings taken before the split have no first name or surname stored. A blank name is
  // worse than a name in the wrong column - on the night, staff still have to find them.
  it("falls back to the single name for a booking taken before the split", () => {
    const old = { ...booking, buyerFirstName: null, buyerSurname: null };
    expect(bookingsCsv([old]).split("\r\n")[1]).toContain('"Jo Smith"');
  });
});
