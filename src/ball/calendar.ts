// TASK-337: the "add to calendar" file for the ball.
//
// Pure, so it is unit-testable DB-free. Everything variable (the arrival time staff set in admin)
// comes in as an argument.

export const BALL_DATE = "20261107"; // Saturday 7 November 2026

// Emitted as UTC, and that is exact rather than lazy: British Summer Time ends on the last Sunday
// of October, so on 7 November the United Kingdom is on GMT, which IS UTC. A single event in a
// single known offset needs no VTIMEZONE block, and shipping one would be more to get wrong.
const UTC = "Z";

// RFC 5545 escaping. Backslash FIRST — escaping it after the others would go back over the
// backslashes those escapes just introduced and double them.
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545 caps a line at 75 octets and continues with a leading space. Long DESCRIPTIONs are
// otherwise silently truncated or rejected by stricter clients.
export function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

// The arrival time is free text staff type into admin ("From 7pm, to be confirmed", "7.30pm"),
// because the venue confirms it late and a date picker cannot hold "to be confirmed". The
// calendar file needs a real clock time, so this reads one out of whatever they wrote.
//
// It is deliberately narrow: it takes the FIRST time-looking thing and understands the shapes a
// person actually types. Anything it does not recognise falls back to 7pm rather than guessing,
// because a calendar entry at the wrong hour is worse than one at the advertised hour.
export function parseArrivalHour(arrival: string | null): { hour: number; minute: number } {
  const fallback = { hour: 19, minute: 0 };
  if (!arrival) return fallback;
  const m = arrival.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if (!m) return fallback;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return fallback;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  // No am/pm and a small number means an evening event written as "7" or "7.30". Nobody arrives
  // at a Festive Ball at 7 in the morning.
  if (!meridiem && hour < 12) hour += 12;
  return { hour, minute };
}

const pad = (n: number) => String(n).padStart(2, "0");

export interface CalendarInput {
  arrivalTime: string | null;
  // Where the file says to go. Passed in so it cannot drift from the page.
  location: string;
  url: string;
  // Minted per booking where we have one, so re-downloading updates the same entry rather than
  // adding a second. A generic file gets a stable id for the same reason.
  uid: string;
}

export function buildBallCalendar(input: CalendarInput): string {
  const { hour, minute } = parseArrivalHour(input.arrivalTime);
  const start = `${BALL_DATE}T${pad(hour)}${pad(minute)}00${UTC}`;
  // Ends at midnight. An open-ended entry blocks nothing in a calendar, and guessing a finish
  // time we have not advertised would put a wrong fact in someone's diary.
  const end = `20261108T000000${UTC}`;

  const description =
    "A Night to Remember, in aid of the Night Before Christmas Campaign. " +
    "Dress to impress. Over 18s only. " +
    "Your ticket includes entry, a three-course meal, a welcome drink on arrival and " +
    "entertainment through the evening. Timings will be confirmed nearer the night.";

  // DTSTAMP is the ball's own date, not "now": these files are generated per request, and a
  // timestamp that changes every download makes every re-download look like an edit. It also
  // keeps the output identical for the same input, which is what makes it testable.
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Night Before Christmas Campaign//Festive Ball 2026//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsEscape(input.uid)}`,
    `DTSTAMP:${BALL_DATE}T000000${UTC}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    "SUMMARY:NBCC Festive Ball 2026",
    `LOCATION:${icsEscape(input.location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${icsEscape(input.url)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF throughout, which RFC 5545 requires and some clients enforce. The trailing pair matters
  // too: a file ending without one is rejected outright by stricter parsers.
  return lines.map(fold).join("\r\n") + "\r\n";
}
