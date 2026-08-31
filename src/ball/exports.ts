// TASK-313 (plan 5): the three lists staff actually need. Pure CSV building — no pool, no
// config — so it is unit-tested DB-free.
//
// Three lists rather than one, because they go to different people and that changes what may
// be in them:
//
//   Door list      — for the welcome desk on the night. Names and tables, nothing else.
//   Catering list  — for THE PARK HOTEL. Food and access needs only. It is the one export that
//                    leaves NBCC, and it carries special category data, so it contains no email
//                    addresses, no money and no booking references. The ticket page promises
//                    exactly this ("we tell them nothing else about you") and the promise is
//                    kept here, in code, rather than by whoever assembles the file.
//   Bookings list  — for the charity's own records and the accountant.

export interface ExportGuest {
  fullName: string;
  dietary: string | null;
  accessNeeds: string | null;
  tableName: string | null;
  reference: string;
}

export interface ExportBooking {
  reference: string;
  kind: string;
  quantity: number;
  seats: number;
  buyerName: string;
  buyerFirstName: string | null;
  buyerSurname: string | null;
  buyerEmail: string;
  ticketsPence: number;
  donationPence: number;
  feeCoverPence: number;
  totalPence: number;
  giftAid: boolean;
  newsletterOptIn: boolean;
  status: string;
  tableName: string | null;
  createdAt: string;
}

// RFC 4180 quoting. Also defuses a leading =, +, - or @, which Excel would otherwise execute as
// a formula — a real risk here because guests type these fields themselves.
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRows(rows: Array<Array<string | number | null>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// Surname = the last whitespace-separated word. Crude, and deliberately so: it is only a sort
// order for a printed list a human reads, and a cleverer parser would get "van der Berg" and
// "Smith Jones" wrong in less predictable ways.
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "").toLowerCase();
}

export function doorListCsv(guests: ExportGuest[]): string {
  const sorted = [...guests].sort((a, b) => {
    const s = surnameOf(a.fullName).localeCompare(surnameOf(b.fullName));
    return s !== 0 ? s : a.fullName.localeCompare(b.fullName);
  });
  return csvRows([
    ["Name", "Table", "Booking"],
    ...sorted.map((g) => [g.fullName, g.tableName ?? "", g.reference]),
  ]);
}

// Only guests who actually have something to tell the kitchen. A list of forty rows of blanks
// buries the three that matter, and the three that matter are the whole point.
export function cateringCsv(guests: ExportGuest[]): string {
  const relevant = guests.filter((g) => g.dietary || g.accessNeeds);
  const sorted = [...relevant].sort(
    (a, b) => (a.tableName ?? "").localeCompare(b.tableName ?? "") ||
      a.fullName.localeCompare(b.fullName),
  );
  return csvRows([
    ["Table", "Guest", "Food", "Access"],
    ...sorted.map((g) => [g.tableName ?? "", g.fullName, g.dietary ?? "", g.accessNeeds ?? ""]),
  ]);
}

export function bookingsCsv(bookings: ExportBooking[]): string {
  const money = (p: number) => (p / 100).toFixed(2);
  return csvRows([
    [
      "Reference", "Booked", "What", "Seats", "Table name", "First name", "Surname", "Email",
      "Tickets", "Donation", "Fee covered", "Total", "Gift Aid", "Newsletter", "Status",
    ],
    ...bookings.map((b) => [
      b.reference,
      b.createdAt,
      b.kind === "table" ? `${b.quantity} table(s)` : `${b.quantity} ticket(s)`,
      b.seats,
      b.tableName ?? "",
      // Split columns so the sheet can be sorted by surname. Bookings taken before TASK-318
      // have no split stored, so fall back to the single name rather than showing a blank
      // row: a name in the wrong column still finds the person on the night.
      b.buyerFirstName ?? b.buyerName,
      b.buyerSurname ?? "",
      b.buyerEmail,
      money(b.ticketsPence),
      money(b.donationPence),
      money(b.feeCoverPence),
      money(b.totalPence),
      b.giftAid ? "yes" : "",
      b.newsletterOptIn ? "yes" : "",
      b.status,
    ]),
  ]);
}
