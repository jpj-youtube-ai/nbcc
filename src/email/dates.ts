// The one date style for the fundraising, team, in memory, pledge, event ticket and (non-Ball)
// staff emails (Jaimie, 2026-10-04): "Saturday 7th November", with the year where one is shown.
//
//   emailDate       the words, with a plain "7th": for a subject, a plain text part, alt text and
//                   anything else that cannot carry markup.
//   raiseOrdinals   the same words in an HTML body, with the st, nd, rd or th raised (<sup>). Each
//                   email's shell runs its body through this, so a date is written once, plainly,
//                   and comes out raised wherever it is shown as HTML.
//
// Pure: no clock, no config. A stored day ("2026-11-07") is that day; a moment in time (a Date, or a
// full ISO timestamp) is the day it is in the UK.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 31st. */
export function ordinal(n: number): string {
  const teens = n % 100 >= 11 && n % 100 <= 13;
  const end = teens ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${end}`;
}

const UK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const STORED_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day, as YYYY-MM-DD: a stored day as it is, a moment in time as the UK's day. */
function dayOf(value: string | Date): string {
  if (typeof value === "string" && STORED_DAY.test(value)) return value;
  return UK_DAY.format(typeof value === "string" ? new Date(value) : value);
}

export interface EmailDateOptions {
  /** "Saturday" first. On unless switched off. */
  weekday?: boolean;
  /** "2026" last. Off unless asked for. */
  year?: boolean;
}

/** "Saturday 7th November", "Saturday 7th November 2026", "7th November 2026". */
export function emailDate(value: string | Date, o: EmailDateOptions = {}): string {
  const [y, m, d] = dayOf(value).split("-").map(Number);
  // Midday UTC, so the weekday is that day's wherever this runs.
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return [o.weekday === false ? "" : weekday, ordinal(d), MONTHS[m - 1], o.year ? String(y) : ""].filter(Boolean).join(" ");
}

const DAY_THEN_MONTH = new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)(?= (?:${MONTHS.join("|")})\\b)`, "g");

/**
 * An HTML body with the ending of every date raised: "7th November" becomes "7<sup>th</sup>
 * November". Only a day followed by its month, and only in the words, never inside a tag (a link's
 * address or a picture's alt text stays plain).
 */
export function raiseOrdinals(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith("<") ? part : part.replace(DAY_THEN_MONTH, "$1<sup>$2</sup>")))
    .join("");
}
