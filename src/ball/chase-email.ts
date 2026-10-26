import { escapeHtml } from "./page";
import { ballEmailShell, contactPanel, BALL_TEXT_FOOTER } from "./email-shell";
import type { ChaseList, ChaseRow, ReminderGroup } from "./chase";
import { emailDate, raiseOrdinals } from "../email/dates";
import { button, subheading, CRIMSON, MAROON, SLATE, SLATE_SOFT, TAN_SOFT, CREAM, HEAD, BODY_FONT } from "../email/brand";

// TASK-576: the two emails of the last-week chase for guest names and meal choices.
//
//   reminder    to the person who booked: what is still missing, by when, and a button to fix it
//   chase list  to the volunteers who phone people: everyone still to chase, with a number and a link
//
// Pure: no pool, no config, no clock (the deadline and the day count are passed in), so both are
// unit-tested without a database, like every other Ball email. Who gets what, and when, is decided
// by ./chase.ts; the sending is the daily script's job.
//
// The date words are the house style (src/email/dates.ts): a plain "4th" in a subject and in the
// text part, the ending raised in the HTML. The older Ball emails keep their own date wording until
// after the Ball; these are new, so they use the house one.

// The Ball's own day. The code that decides when to send (./sales-report-runner.ts) cannot be imported
// here without dragging in the database, so the day is written out, as ./donate-page.ts does.
const BALL_DAY = "2026-11-07";

export interface ChaseEmail {
  subject: string;
  html: string;
  text: string;
}

const P = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px"`;
const SMALL = `style="color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;line-height:1.55;margin:0 0 10px"`;
const CARD = `style="background:${CREAM};border:1px solid ${TAN_SOFT};border-radius:10px;padding:14px 16px;margin:0 0 12px"`;
const LINE = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.5;margin:0"`;
// Links in the volunteers' list are tapped with a thumb: a block at least 44px tall.
// Padding rather than a tall line, so a long address that wraps stays tidy; it wraps rather than
// pushing the page sideways.
const TAP = `style="display:inline-block;padding:11px 0;line-height:22px;color:${MAROON};font-weight:700;word-break:break-word;overflow-wrap:anywhere"`;

/** "10am", "10.30am", "4pm": the time a person would say, in London. */
export function timeWords(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const clock = hour % 12 === 0 ? 12 : hour % 12;
  return `${clock}${minute === 0 ? "" : `.${String(minute).padStart(2, "0")}`}${hour < 12 ? "am" : "pm"}`;
}

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const daysToGo = (days: number) => `${plural(days, "day")} to go`;

// "by 10am on Wednesday 4th November", and on the last day "by 10am tomorrow, Wednesday 4th November".
function deadlineWords(deadline: Date, days: number): { by: string; plain: string } {
  const time = timeWords(deadline);
  const date = emailDate(deadline);
  const plain = days === 1 ? `${time} tomorrow, ${date}` : days === 0 ? `${time} today, ${date}` : `${time} on ${date}`;
  return { by: `by ${plain}`, plain };
}

// What one booking is still missing, as the lines an email shows.
function missingLines(r: ChaseRow): string[] {
  const lines: string[] = [];
  if (r.unnamed > 0) {
    lines.push(
      r.seats === 1
        ? "Your seat still needs a name"
        : r.unnamed === 1
          ? `1 of your ${r.seats} seats still needs a name`
          : `${r.unnamed} of your ${r.seats} seats still need a name`,
    );
  }
  if (r.unchosen > 0) {
    lines.push(
      r.unchosen === 1
        ? "1 of your guests still needs to choose their meal"
        : `${r.unchosen} of your guests still need to choose their meals`,
    );
  }
  return lines;
}

// --- the reminder to the person who booked --------------------------------------------------

export function buildChaseReminderEmail(i: {
  group: ReminderGroup;
  daysToDeadline: number;
  deadline: Date;
  guestLink: (token: string) => string;
}): ChaseEmail {
  const { group, daysToDeadline: days } = i;
  const last = days <= 1;
  const when = deadlineWords(i.deadline, days);
  const time = timeWords(i.deadline);
  const date = emailDate(i.deadline);
  const several = group.bookings.length > 1;

  const heading = last ? `Last chance: please do this ${when.by}` : `Please do this ${when.by}`;
  const countdown = daysToGo(days);
  const label = "Add your guests and meals";

  const blocks = group.bookings
    .map((r, n) => {
      const lines = missingLines(r)
        .map((l) => `<p style="margin:0 0 6px;color:${SLATE};font-family:${BODY_FONT};font-size:16px;font-weight:700;line-height:1.5">${escapeHtml(l)}</p>`)
        .join("");
      const tag = several
        ? `<p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">Booking ${escapeHtml(r.reference)}</p>`
        : "";
      const rule = n > 0 ? `border-top:1px solid ${TAN_SOFT};margin-top:18px;padding-top:18px;` : "";
      return `<div style="${rule}">${tag}${lines}${button(i.guestLink(r.guestToken ?? ""), label)}</div>`;
    })
    .join("");

  const box = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#FFFFFF;border:2px solid ${CRIMSON};border-radius:12px;margin:0 0 22px">
    <tr><td style="padding:20px 22px 4px;text-align:center">
      <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:22px;font-weight:800;line-height:1.25;margin:0 0 6px">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 14px;color:${MAROON};font-family:${BODY_FONT};font-size:15px;font-weight:700">${countdown}</p>
      ${blocks}
    </td></tr>
  </table>`;

  const why = `The Park Hotel needs our final guest names and meal choices for the Festive Ball on ${emailDate(BALL_DAY)}, so that every guest gets the right dinner. It takes a couple of minutes, and you can save what you know and come back.`;
  const choose = `If we haven't heard from you by ${time} on ${date}, we'll choose for you.`;
  const where = several
    ? ""
    : `<p ${SMALL}>Booking ${escapeHtml(group.bookings[0]?.reference ?? "")}. If someone else in your party is filling this in, just pass them the link.</p>`;

  const body = `${box}
  <p ${P}>Hello ${escapeHtml(group.firstName)}.</p>
  <p ${P}>${why}</p>
  <p ${P}>${choose}</p>
  ${where}
  ${contactPanel("Stuck, or easier to just tell us?")}`;

  const textBlocks = group.bookings
    .map((r) => {
      const lines = missingLines(r).map((l) => `- ${l}`).join("\n");
      return `${several ? `Booking ${r.reference}\n` : ""}${lines}\n${label}: ${i.guestLink(r.guestToken ?? "")}`;
    })
    .join("\n\n");

  const text = `${heading}
${countdown}

${textBlocks}

Hello ${group.firstName}.

${why}

${choose}

${several ? "" : `Booking ${group.bookings[0]?.reference ?? ""}. If someone else in your party is filling this in, just pass them the link.\n\n`}${BALL_TEXT_FOOTER}`;

  return {
    subject: last
      ? `Last chance: your Festive Ball guests and meals by ${time} ${days === 0 ? "today" : "tomorrow"}`
      : `${countdown}: your Festive Ball guests and meals`,
    html: ballEmailShell(raiseOrdinals(body)),
    text,
  };
}

// --- the chase list for the volunteers ------------------------------------------------------

type Section = { title: string; rows: ChaseRow[]; note?: string };

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

// "4 of 6 meals chosen": the meals are for the guests who have a name.
const mealsChosen = (r: ChaseRow) => `${r.choices.length - r.unchosen} of ${r.choices.length} ${r.choices.length === 1 ? "meal" : "meals"} chosen`;

function rowHtml(r: ChaseRow, guestLink: (token: string) => string): string {
  const typed = r.buyerPhone?.trim() ?? "";
  // Something typed with no digits in it ("n/a") is shown as it was typed, but is not a link.
  const phone = !typed
    ? `<span style="color:${SLATE_SOFT}">no phone given</span>`
    : /\d/.test(typed)
      ? `<a href="${escapeHtml(telHref(typed))}" ${TAP}>${escapeHtml(typed)}</a>`
      : `<span style="word-break:break-word;overflow-wrap:anywhere">${escapeHtml(typed)}</span>`;
  const email = r.buyerEmail.trim()
    ? `<a href="mailto:${escapeHtml(r.buyerEmail)}" ${TAP}>${escapeHtml(r.buyerEmail)}</a>`
    : `<span style="color:${SLATE_SOFT}">no email address</span>`;
  const named = `${r.choices.length} of ${r.seats}`;
  const meals = r.choices.length > 0 ? `<p ${LINE}>${mealsChosen(r)}</p>` : "";
  const link = r.guestToken
    ? `<p style="margin:4px 0 0"><a href="${escapeHtml(guestLink(r.guestToken))}" ${TAP}>their link</a></p>`
    : `<p ${LINE}><span style="color:${SLATE_SOFT}">no guest link yet</span></p>`;
  const waiting = r.status === "pending" ? ` <span style="color:${SLATE_SOFT};font-weight:400">(awaiting payment)</span>` : "";
  return `<div ${CARD}>
    <p style="margin:0 0 2px;color:${SLATE};font-family:${BODY_FONT};font-size:16px;font-weight:700;line-height:1.4">${escapeHtml(r.buyerName)}${waiting}</p>
    <p ${LINE}>${phone}</p>
    <p ${LINE}>${email}</p>
    <p ${LINE}>Booking ${escapeHtml(r.reference)}</p>
    <p ${LINE}>${named} seats named</p>
    ${meals}
    ${link}
  </div>`;
}

function rowText(r: ChaseRow, guestLink: (token: string) => string): string {
  const out = [
    `${r.buyerName}${r.status === "pending" ? " (awaiting payment)" : ""}`,
    `  Phone: ${r.buyerPhone?.trim() ? r.buyerPhone : "no phone given"}`,
    `  Email: ${r.buyerEmail.trim() ? r.buyerEmail : "no email address"}`,
    `  Booking ${r.reference}`,
    `  ${r.choices.length} of ${r.seats} seats named`,
  ];
  if (r.choices.length > 0) out.push(`  ${mealsChosen(r)}`);
  out.push(`  Link: ${r.guestToken ? guestLink(r.guestToken) : "no guest link yet"}`);
  return out.join("\n");
}

export function buildChaseListEmail(i: {
  list: ChaseList;
  daysToDeadline: number;
  deadline: Date;
  guestLink: (token: string) => string;
  test?: boolean;
}): ChaseEmail {
  const { list, daysToDeadline: days } = i;
  const time = timeWords(i.deadline);
  const date = emailDate(i.deadline);
  const toPhone = list.toChase.length + list.cannotEmail.length;
  const countdown = daysToGo(days);

  const subject =
    days === 0
      ? `Festive Ball chase list: ${plural(toPhone, "booking")} to chase before ${time} today`
      : `Festive Ball chase list: ${plural(toPhone, "booking")} to chase, ${countdown}`;

  const intro =
    days === 0
      ? `This is the last list before ${time} on ${date}, when the guest details close.`
      : `The guest details close at ${time} on ${date} (${countdown}).`;
  const ask = "Please phone the people below, most missing first. Each has their own link, so you can type in what they tell you while you talk.";
  const privacy = "This list has people's names and phone numbers, so please keep it to yourselves and do not forward it.";
  const testNote = "This is a test with made-up bookings. Nobody on it is real.";

  const totals = [
    plural(list.complete, "booking") + " complete",
    plural(toPhone, "booking") + " still to chase",
    `${plural(list.unnamed, "seat")} still without a name`,
    `${plural(list.unchosen, "guest")} still to choose their ${list.unchosen === 1 ? "meal" : "meals"}`,
  ];

  const sections: Section[] = [
    { title: "To chase", rows: list.toChase },
    {
      title: "Paid, but we cannot email them",
      rows: list.cannotEmail,
      note: "Only a phone call reaches these: they have no email address, or no guest link yet.",
    },
    {
      title: "Waiting for their bank transfer",
      rows: list.awaitingPayment,
      note: "Not paid yet, so they have had no reminder. Their guest link starts working once the money arrives.",
    },
  ].filter((s) => s.rows.length > 0);

  const body = `${
    i.test
      ? `<p style="background:${TAN_SOFT};border-radius:10px;padding:12px 16px;margin:0 0 16px;color:${MAROON};font-family:${BODY_FONT};font-size:14px;font-weight:700">${testNote}</p>`
      : ""
  }<h1 style="color:${CRIMSON};font-family:${HEAD};font-size:24px;font-weight:800;margin:0 0 14px;letter-spacing:-.01em">Festive Ball chase list</h1>
  <p ${P}><b>${intro}</b></p>
  <p ${P}>${ask}</p>
  <p ${SMALL}>${privacy}</p>
  <div ${CARD}>${totals.map((t) => `<p ${LINE}>${t}</p>`).join("")}</div>
  ${sections
    .map(
      (s) =>
        `${subheading(`${s.title} (${s.rows.length})`)}${s.note ? `<p ${SMALL}>${s.note}</p>` : ""}${s.rows.map((r) => rowHtml(r, i.guestLink)).join("")}`,
    )
    .join("\n  ")}`;

  const text = `${i.test ? `${testNote}\n\n` : ""}FESTIVE BALL CHASE LIST

${intro}

${ask}
${privacy}

${totals.join("\n")}

${sections
  .map((s) => `${s.title} (${s.rows.length})\n${s.note ? `${s.note}\n` : ""}\n${s.rows.map((r) => rowText(r, i.guestLink)).join("\n\n")}`)
  .join("\n\n")}

${BALL_TEXT_FOOTER}`;

  return { subject, html: ballEmailShell(raiseOrdinals(body)), text };
}

// --- invented examples, for All emails and the admin's test buttons -------------------------

const FULL = "Starter: Example soup\nMain: Example roast\nDessert: Example pudding";

function example(over: Partial<ChaseRow>): ChaseRow {
  return {
    id: 0,
    reference: "BALL-0001",
    status: "paid",
    paymentMethod: "card",
    buyerName: "Alex Example",
    buyerFirstName: "Alex",
    buyerEmail: "alex@example.com",
    buyerPhone: "07000 000001",
    guestToken: "example",
    seats: 10,
    choices: [],
    reminderSentOn: null,
    unnamed: 0,
    unchosen: 0,
    ...over,
  };
}

/** One made-up booker with ten seats, three named and two of those still to choose. */
export function exampleReminderGroup(): ReminderGroup {
  return {
    email: "alex@example.com",
    firstName: "Alex",
    bookings: [example({ choices: [FULL, null, null], unnamed: 7, unchosen: 2 })],
  };
}

/** A made-up list with every section: people to chase, people only a call reaches, and a bank transfer. */
export function exampleChaseList(): ChaseList {
  const toChase = [
    example({ id: 1, reference: "BALL-0001", buyerName: "Morag Example", buyerFirstName: "Morag", buyerEmail: "morag@example.com", buyerPhone: "07000 000001", guestToken: "example-1", seats: 10, choices: [FULL, FULL, FULL, FULL, null, null], unnamed: 4, unchosen: 2 }),
    example({ id: 2, reference: "BALL-0002", buyerName: "Callum Madeup", buyerFirstName: "Callum", buyerEmail: "callum@example.com", buyerPhone: "07000 000002", guestToken: "example-2", seats: 6, choices: [FULL, FULL, null, null, null, null], unnamed: 0, unchosen: 4 }),
    example({ id: 3, reference: "BALL-0003", buyerName: "Jo Example", buyerFirstName: "Jo", buyerEmail: "jo@example.com", buyerPhone: null, guestToken: "example-3", seats: 2, choices: [FULL], unnamed: 1, unchosen: 0 }),
  ];
  const cannotEmail = [
    example({ id: 4, reference: "BALL-0004", buyerName: "Robin Madeup", buyerFirstName: "Robin", buyerEmail: "", buyerPhone: "07000 000004", guestToken: null, seats: 4, choices: [], unnamed: 4, unchosen: 0 }),
  ];
  const awaitingPayment = [
    example({ id: 5, reference: "BALL-0005", status: "pending", paymentMethod: "transfer", buyerName: "Sam Example", buyerFirstName: "Sam", buyerEmail: "sam@example.com", buyerPhone: "07000 000005", guestToken: "example-5", seats: 8, choices: [], unnamed: 8, unchosen: 0 }),
  ];
  const open = [...toChase, ...cannotEmail];
  return {
    toChase,
    cannotEmail,
    awaitingPayment,
    complete: 12,
    unnamed: open.reduce((n, r) => n + r.unnamed, 0),
    unchosen: open.reduce((n, r) => n + r.unchosen, 0),
  };
}
