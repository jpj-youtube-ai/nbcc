import { z } from "zod";
import { ballEmailShell, factsCard, BALL_TEXT_FOOTER, BALL_EMAIL, BALL_PHONE } from "./email-shell";
import { CRIMSON, SLATE, SLATE_SOFT, HEAD, BODY_FONT } from "../email/brand";

// TASK-464: the Festive Ball ticket report. Twice a week (Monday and Thursday mornings, TASK-467) the people
// running the Ball with us, the organiser and the sponsor among them, get one email with the numbers:
// how many seats are sold, what sold lately, what is left, the waiting list and the days to go.
//
// Counts only. No names, no email addresses, no booking details, and no money: Jaimie chose that
// line, and the email is built from numbers alone so nothing else can creep in.
//
// Pure: no pool, no config, no clock. The runner (./sales-report-runner.ts) supplies the numbers
// and the day; the admin's preview and test send use the same render, so what staff check is what
// goes out.

/** The report goes on Mondays and Thursdays (0 is Sunday). Jaimie moved Tuesday to Monday in TASK-467. */
export const REPORT_WEEKDAYS: readonly number[] = [1, 4];
export const MAX_RECIPIENTS = 10;

// ---- who it goes to ----

const recipientSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().email("That isn't a whole email address."),
  ),
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Add their name.").max(60, "Keep the name to 60 characters or fewer."),
  ),
});
export type Recipient = z.output<typeof recipientSchema>;

/**
 * The list as staff save it: tidied, no address twice, and kept in alphabetical order by name, so
 * the panel and the email's To line read the same way every time.
 */
export const recipientsSchema = z
  .array(recipientSchema)
  .max(MAX_RECIPIENTS, `The report can go to up to ${MAX_RECIPIENTS} people.`)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((r, i) => {
      if (seen.has(r.email)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "email"], message: "That address is already on the list." });
      }
      seen.add(r.email);
    });
  })
  .transform((list) =>
    [...list].sort(
      (a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }) || a.email.localeCompare(b.email),
    ),
  );

// ---- the day, where the charity is ----

const UK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const UK_WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_WORDS = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Today's date in the UK, as YYYY-MM-DD. */
export function londonDate(at: Date): string {
  return UK_DATE.format(at);
}

/** Today's weekday in the UK: 0 for Sunday to 6 for Saturday. */
export function londonWeekday(at: Date): number {
  return SHORT_DAYS.indexOf(UK_WEEKDAY.format(at));
}

// A YYYY-MM-DD day at midday UTC, so adding days never trips over the clocks changing.
const midday = (day: string) => new Date(`${day}T12:00:00Z`);

function plusDays(day: string, n: number): string {
  const d = midday(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Tuesday 6 October". */
export function dayInWords(day: string): string {
  return DAY_WORDS.format(midday(day));
}

/** The next Monday or Thursday after today, or null when that would be after the Ball. */
export function nextUpdateAfter(today: string, eventDate: string): string | null {
  for (let n = 1; n <= 7; n++) {
    const day = plusDays(today, n);
    if (REPORT_WEEKDAYS.includes(midday(day).getUTCDay())) return day <= eventDate ? day : null;
  }
  return null;
}

const UK_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" });
/** The hour the daily job runs, UK time. */
export const REPORT_HOUR = 8;

/**
 * The day the next report goes, as the admin shows it: this morning, if today is a report day, it
 * has not gone yet and the 8am job has not run; otherwise the next report day. Null once the last
 * report before the Ball has gone.
 */
export function nextSendDay(o: { now: Date; eventDate: string; sentToday: boolean }): string | null {
  const today = londonDate(o.now);
  const beforeTheJob = Number(UK_HOUR.format(o.now)) < REPORT_HOUR;
  if (REPORT_WEEKDAYS.includes(londonWeekday(o.now)) && !o.sentToday && beforeTheJob && today <= o.eventDate) {
    return today;
  }
  return nextUpdateAfter(today, o.eventDate);
}

export function daysToGo(today: string, eventDate: string): number {
  return Math.round((midday(eventDate).getTime() - midday(today).getTime()) / 86_400_000);
}

/**
 * Whether the scheduled report should go now: a Monday or Thursday in the UK, switched on, with
 * someone to send it to, not already sent today, and the Ball not yet past.
 */
export function reportDue(o: {
  now: Date;
  reportOn: boolean;
  recipients: number;
  eventDate: string;
  sentToday: boolean;
}): boolean {
  return (
    o.reportOn &&
    o.recipients > 0 &&
    !o.sentToday &&
    londonDate(o.now) <= o.eventDate &&
    REPORT_WEEKDAYS.includes(londonWeekday(o.now))
  );
}

// ---- the email ----

export interface SalesInputs {
  totalSeats: number;
  /** Paid only: a booking still waiting for its card payment is not a sale yet. */
  seatsSold: number;
  tablesSold: number;
  singleSeatsSold: number;
  seatsRemaining: number;
  tablesRemaining: number;
  /** Kept back for the charity's and the sponsor's guests; never on sale. */
  heldSeats: number;
  /** Null before the first scheduled report: there is nothing to compare with. */
  soldSinceLast: number | null;
  soldLast7Days: number;
  soldPrevious7Days: number;
  /** People still waiting for a place: anyone already offered one is being looked after. */
  waitingList: number;
  /** The seats those people want between them. */
  waitingSeats: number;
}

/** One booking, as the numbers need it. */
export interface BookingRow {
  kind: string;
  status: string;
  quantity: number;
  seats: number;
  paidAt: Date | null;
}

const DAY_MS = 86_400_000;

/**
 * What has sold, counted from the bookings. Sold means paid: a booking waiting for its card
 * payment, refunded or cancelled is not a sale. Everything is counted up to `now`, and the next
 * report counts on from exactly there (`since` is the moment the last one counted to), so a sale
 * is never in two reports' "since the last update", and never in neither. A paid booking with no
 * payment time (set by hand) is in the totals but in no window.
 */
export function countSales(
  bookings: readonly BookingRow[],
  o: { now: Date; since: Date | null },
): Pick<SalesInputs, "seatsSold" | "tablesSold" | "singleSeatsSold" | "soldSinceLast" | "soldLast7Days" | "soldPrevious7Days"> {
  const now = o.now.getTime();
  const paid = bookings.filter((b) => b.status === "paid" && (b.paidAt === null || b.paidAt.getTime() <= now));
  const seatsPaidBetween = (from: number, to: number) =>
    paid
      .filter((b) => b.paidAt !== null && b.paidAt.getTime() > from && b.paidAt.getTime() <= to)
      .reduce((n, b) => n + b.seats, 0);
  return {
    seatsSold: paid.reduce((n, b) => n + b.seats, 0),
    tablesSold: paid.filter((b) => b.kind === "table").reduce((n, b) => n + b.quantity, 0),
    singleSeatsSold: paid.filter((b) => b.kind === "seat").reduce((n, b) => n + b.seats, 0),
    soldSinceLast: o.since === null ? null : seatsPaidBetween(o.since.getTime(), now),
    soldLast7Days: seatsPaidBetween(now - 7 * DAY_MS, now),
    soldPrevious7Days: seatsPaidBetween(now - 14 * DAY_MS, now - 7 * DAY_MS),
  };
}

export interface ReportContext {
  today: string;
  eventDate: string;
  test: boolean;
}

export interface ReportEmail {
  subject: string;
  html: string;
  text: string;
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Every line of the report, in the words both the HTML and the text version use.
function reportLines(i: SalesInputs, ctx: ReportContext) {
  // Rounded down, so the email never says 100% while a seat is still for sale.
  const percent = i.totalSeats > 0 ? Math.floor((i.seatsSold / i.totalSeats) * 100) : 0;
  const how = [
    i.tablesSold > 0 ? counted(i.tablesSold, "whole table", "whole tables") : "",
    i.singleSeatsSold > 0 ? counted(i.singleSeatsSold, "single seat", "single seats") : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const next = nextUpdateAfter(ctx.today, ctx.eventDate);
  const days = daysToGo(ctx.today, ctx.eventDate);
  // Only a preview or a test can go on the day of the Ball or after it: the schedule has stopped.
  const whatNext = next
    ? `Your next update will be on ${dayInWords(next)}.`
    : days > 0
      ? `This is the last update before the Ball on ${dayInWords(ctx.eventDate)}.`
      : "There are no more updates planned.";
  return {
    opening: `Here's how Festive Ball ticket sales stand this morning. ${whatNext} Any questions in the meantime, call us on ${BALL_PHONE} or email ${BALL_EMAIL}.`,
    sold: [`${i.seatsSold} of ${i.totalSeats} seats (${percent}%)`, how].filter(Boolean),
    lately: [
      i.soldSinceLast === null
        ? "This is the first update"
        : `${counted(i.soldSinceLast, "seat", "seats")} since the last update`,
      `${counted(i.soldLast7Days, "seat", "seats")} in the last 7 days (the 7 days before: ${i.soldPrevious7Days})`,
    ],
    left: [
      i.seatsRemaining === 0
        ? "Sold out"
        : i.tablesRemaining === 0
          ? `${counted(i.seatsRemaining, "seat", "seats")}, but no whole tables`
          : `${counted(i.seatsRemaining, "seat", "seats")}, including ${counted(i.tablesRemaining, "whole table", "whole tables")}`,
      i.heldSeats > 0 ? `${counted(i.heldSeats, "seat is", "seats are")} kept back for guests` : "",
      i.waitingList === 0
        ? "Nobody on the waiting list"
        : `${counted(i.waitingList, "person", "people")} on the waiting list, wanting ${counted(i.waitingSeats, "seat", "seats")}`,
    ].filter(Boolean),
    countdown:
      days > 0
        ? `${counted(days, "day", "days")} to go`
        : days === 0
          ? "The Ball is tonight"
          : `The Ball was on ${dayInWords(ctx.eventDate)}`,
  };
}

const P = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px"`;

function section(label: string, lines: string[], last = false): string {
  const [first, ...rest] = lines;
  return (
    `<tr><td style="padding:14px 18px 2px;color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">${label}</td></tr>` +
    `<tr><td style="padding:0 18px ${last ? 16 : 6}px;color:${SLATE};font-family:${BODY_FONT};font-size:15px;line-height:1.5;"><b>${first}</b>${rest
      .map((l) => `<br />${l}`)
      .join("")}</td></tr>`
  );
}

/** The report, as it goes out: subject, HTML in the Ball's own frame, and the plain text part. */
export function renderReport(inputs: SalesInputs, ctx: ReportContext): ReportEmail {
  const l = reportLines(inputs, ctx);
  const day = dayInWords(ctx.today);
  const subject = `${ctx.test ? "[Test] " : ""}Festive Ball tickets: ${day} update`;
  const testNote = "This is a test, sent only to you.";

  const body = `${ctx.test ? `<p ${P}><b>${testNote}</b></p>` : ""}
  <p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">Ticket update</p>
  <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:0 0 14px;letter-spacing:-.01em">${day}</h1>
  <p ${P}>Hello,</p>
  <p ${P}>${l.opening}</p>
  ${factsCard(section("Sold", l.sold) + section("Lately", l.lately) + section("Still available", l.left) + section("The Ball", [l.countdown], true))}
  <p ${P}>Thank you for everything you're doing to make the night a success.</p>
  <p ${P}>The NBCC team</p>`;

  const text = [
    ...(ctx.test ? [testNote, ""] : []),
    `Festive Ball tickets: ${day}`,
    "",
    "Hello,",
    "",
    l.opening,
    "",
    "SOLD",
    ...l.sold,
    "",
    "LATELY",
    ...l.lately,
    "",
    "STILL AVAILABLE",
    ...l.left,
    "",
    `${l.countdown}.`,
    "",
    "Thank you for everything you're doing to make the night a success.",
    "The NBCC team",
    "",
    BALL_TEXT_FOOTER,
  ].join("\n");

  return { subject, html: ballEmailShell(body), text };
}
