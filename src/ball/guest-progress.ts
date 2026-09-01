// TASK-336: who still owes us their guest details, and how close the catering list is to done.
//
// The gap this closes: guest names, dietary requirements and access needs arrive from BUYERS,
// via the link in their confirmation email, and most of a table of ten is filled in by someone
// chasing nine other people. Until now nothing recorded who had replied. Staff could see every
// booking and every guest, but not the difference between them — so "who do I nudge?" and "can
// the venue start on the catering list yet?" both had no answer short of counting by hand.
//
// Pure: no pool, no clock. The row shape is whatever the query in db/ball.ts returns, so this
// stays unit-testable DB-free (golden rule 5).

export interface GuestProgressRow {
  reference: string;
  buyerName: string;
  buyerEmail: string;
  // Seats the booking paid for. A table is ten seats, so this is the number of PEOPLE expected,
  // never the number of tickets or tables bought.
  seats: number;
  guestsNamed: number;
  // Guests who gave a dietary or access requirement. Deliberately NOT what makes a booking
  // complete: most people have nothing to declare, and treating silence as an outstanding
  // answer would leave the list permanently red.
  needsGiven: number;
  guestToken: string | null;
}

export interface BookingProgress extends GuestProgressRow {
  missing: number;
  complete: boolean;
}

// A booking is done when it has named as many guests as it has seats.
//
// Clamped at zero. A buyer can name more people than they have seats — the guest form does not
// stop them, and a table host adding a spare name is an obvious way to get there — and a
// negative "missing" would subtract from the totals below and report a catering list as more
// complete than it is.
export function bookingProgress(row: GuestProgressRow): BookingProgress {
  const missing = Math.max(0, row.seats - row.guestsNamed);
  return { ...row, missing, complete: missing === 0 };
}

export interface GuestProgressSummary {
  seatsBooked: number;
  guestsNamed: number;
  guestsMissing: number;
  bookingsComplete: number;
  bookingsOutstanding: number;
  needsGiven: number;
  // 0-100, rounded. 100 only when nothing is missing: a list that is 99.6% done rounds to 100
  // and reads as finished, which is exactly the wrong thing to tell someone whose job is to
  // chase the last few.
  percentComplete: number;
}

export function summariseGuestProgress(rows: GuestProgressRow[]): GuestProgressSummary {
  const progress = rows.map(bookingProgress);
  const seatsBooked = progress.reduce((n, b) => n + b.seats, 0);
  const guestsNamed = progress.reduce((n, b) => n + Math.min(b.guestsNamed, b.seats), 0);
  const guestsMissing = progress.reduce((n, b) => n + b.missing, 0);
  return {
    seatsBooked,
    guestsNamed,
    guestsMissing,
    bookingsComplete: progress.filter((b) => b.complete).length,
    bookingsOutstanding: progress.filter((b) => !b.complete).length,
    needsGiven: progress.reduce((n, b) => n + b.needsGiven, 0),
    percentComplete:
      seatsBooked === 0 ? 0 : guestsMissing === 0 ? 100 : Math.min(99, Math.round((guestsNamed / seatsBooked) * 100)),
  };
}

// The chase list: only what is outstanding, biggest gap first.
//
// Biggest gap rather than oldest booking because a table of ten with nobody named is both the
// most work to fix and the most damaging to leave — ten meals the venue cannot plan — while a
// booking missing one name is a single reply away.
export function outstandingBookings(rows: GuestProgressRow[]): BookingProgress[] {
  return rows
    .map(bookingProgress)
    .filter((b) => !b.complete)
    .sort((a, b) => b.missing - a.missing || a.reference.localeCompare(b.reference));
}

// The buyer's own guest link, so staff can resend it rather than asking someone to find an email
// from weeks ago. Null when the booking has no token yet — it is minted with the confirmation,
// so a booking paid seconds ago can legitimately be without one.
export function guestLinkFor(row: GuestProgressRow, baseUrl: string): string | null {
  if (!row.guestToken) return null;
  return `${baseUrl.replace(/\/+$/, "")}/ball/guests/${row.guestToken}`;
}
