import { z } from "zod";
import { containsBlockedWord } from "../donors/display-name-filter";
import { isValidUkPostcode } from "../declarations/fields";
import { SINGLE_DONATION_WORDING, type DeclarationWording } from "../declarations/wording";
import { londonToday } from "../events/model";
import { dateParts } from "../events/render";
import { dayCount } from "../fundraising/call-prompts";
import { MESSAGE_MAX, NAME_PART_MAX, shortName, type FundraiserRecord } from "../fundraising/model";
import { isQuietFundraiser } from "../fundraising/touch-rules";

// Sponsor pledges (Jaimie, 2026-10-03): "Sponsor now, pay after" on a sponsorship fundraiser's page.
// The rules, pure: no database, no config, no clock (today is a UK day, YYYY-MM-DD, passed in), so
// they are unit tested (test/unit/sponsor-pledges-model.test.ts).
//
// A pledge is a PROMISE, never money. It is shown on the page apart from the money raised and never
// counts on the meter or towards the target: only the donation made when it is paid does.
//
//   confirm by email  a pledge counts for nothing until its sponsor presses Confirm in the one email
//                     sent when they pledge: until then it is "unconfirmed", shown nowhere, and it
//                     is deleted after 7 days. Only a confirmed ("open") pledge is on the page, in the
//                     organiser's list, and later emailed the pay link.
//   who may pledge    on a public, approved page raising money (a team member's page too), until its
//                     day has gone or it is finished. Never an event (events are not sponsorship),
//                     never a page in memory of someone, never the team page itself.
//   the pay email     the day after the date; with no date, when staff mark it finished. Once.
//   the reminder      once, a week after the pay email, if it is still unpaid. Then nothing.
//   Gift Aid          declared with the pledge, for the payment made later: the declaration names the
//                     amount and says "when I pay it", and ends with HMRC's liability sentence exactly
//                     as on an online gift. Nothing is claimed until the pledge is paid.
//   personal details  an unpaid pledge is anonymised 90 days after its pay email, keeping the amount.

export const PLEDGE_MIN_PENCE = 200; // £2, like a gift on the page
export const PLEDGE_MAX_PENCE = 100_000; // £1,000: more than that is a phone call, not a web form
/** What can be paid at once for a pledge: they may give more than they pledged. */
export const PAY_MAX_PENCE = 1_000_000; // £10,000
export const PLEDGE_TOO_MUCH = "For a pledge over £1,000, please call us on 01292 811 015.";

export const PLEDGE_STATUSES = ["unconfirmed", "open", "paid", "cash", "cancelled", "expired"] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

/** The two emails to a sponsor. Each is new wording an admin signs off before any is sent. */
export const PLEDGE_WORDING_KEYS = ["pledge_pay", "pledge_reminder"] as const;
export type PledgeEmailKind = (typeof PLEDGE_WORDING_KEYS)[number];

/** The email log kinds of the three emails to a sponsor, for forgetting them with the pledge. */
export const PLEDGE_EMAIL_LOG_KINDS: readonly string[] = ["fundraisePledgeConfirm", "fundraisePledgePay", "fundraisePledgeReminder"];

/** The pay email can still go this many days after it was due (a missed run, or wording waiting). */
export const PAY_CATCH_UP_DAYS = 60;
export const REMINDER_AFTER_DAYS = 7;
/** A reminder later than this after it was due would be stale: it is never sent. */
export const REMINDER_CATCH_UP_DAYS = 21;
export const RETENTION_DAYS = 90;
/** A pledge on a page with no date that never finished: its details go this long after it was made. */
export const RETENTION_BACKSTOP_DAYS = 365;
export const UNPAID_AFTER_DAYS = 14;
/** A pledge its sponsor never confirmed by email is deleted this many days after it was made. */
export const CONFIRM_DAYS = 7;

// --- the Gift Aid declaration ----------------------------------------------------------------------

export const PLEDGE_WORDING_VERSION = "nbcc-pledge-single-2026-10";

/** £60, £25.50, £1,234.56: pence only when there are some. */
export function pounds(pence: number): string {
  const p = Math.max(0, Math.round(pence));
  const rest = p % 100;
  const whole = Math.floor(p / 100).toLocaleString("en-GB");
  return rest ? `£${whole}.${String(rest).padStart(2, "0")}` : `£${whole}`;
}

// HMRC's liability sentence, exactly as on an online gift (src/declarations/wording.ts).
const LIABILITY = SINGLE_DONATION_WORDING.wording_snapshot.slice(SINGLE_DONATION_WORDING.wording_snapshot.indexOf("I am a UK taxpayer"));

/** The words before and after the amount, so the page can show them around the amount typed. */
export const PLEDGE_DECLARATION_PARTS = {
  before: "I want to Gift Aid my donation of ",
  after: ` when I pay it, to the Night Before Christmas Campaign. ${LIABILITY}`,
};

/** Beside the Gift Aid tick on the form and on the pay page: Gift Aid is only for the giver's own money. */
export const OWN_MONEY_WORDS = "This gift is my own money.";

/**
 * The declaration a sponsor makes with a pledge of this much: made now, for the payment made later
 * (HMRC lets a declaration cover a donation made after it). Kept with the pledge, word for word, and
 * carried onto the donation's declaration when the pledge is paid.
 */
export function pledgeDeclarationWording(amountPence: number): DeclarationWording {
  return {
    wording_version: PLEDGE_WORDING_VERSION,
    wording_snapshot: `${PLEDGE_DECLARATION_PARTS.before}${pounds(amountPence)}${PLEDGE_DECLARATION_PARTS.after}`,
  };
}

// --- paying ----------------------------------------------------------------------------------------

const AMOUNT_WORDS = "Give the amount in pounds, like 10 or 12.50.";

/**
 * The amount typed on the pay page ("10", "12.50", "£15") in pence, or what is wrong with it. A
 * sponsor may pay MORE than they pledged, never less (Jaimie, 2026-10-03): one who cannot pay uses
 * "I can't pay this after all" instead.
 */
export function parsePayAmount(typed: unknown, pledgedPence: number): { pence: number } | { error: string } {
  const s = String(typed ?? "").trim().replace(/^£/, "").replace(/,/g, "").trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return { error: AMOUNT_WORDS };
  const [whole, pennies = ""] = s.split(".");
  const pence = Number(whole) * 100 + Number(pennies.padEnd(2, "0"));
  if (pence < Math.max(PLEDGE_MIN_PENCE, pledgedPence)) {
    return {
      error: `You pledged ${pounds(pledgedPence)}, so that is the least you can pay here. You can give more. If you can't pay it after all, use the link further down this page.`,
    };
  }
  if (pence > PAY_MAX_PENCE) return { error: "You can pay up to £10,000 here. For more, please call us on 01292 811 015." };
  return { pence };
}

// --- which pages -----------------------------------------------------------------------------------

export type PledgeFundraiser = Pick<FundraiserRecord, "id" | "path" | "public" | "status" | "kind" | "eventDate"> & {
  isTeam?: boolean;
  teamId?: number | null;
  inMemory?: boolean | null;
  /** When staff marked it finished (ISO), or null. */
  finishedAt?: string | null;
};

/** A page pledges belong on at all: public, raising money, approved or finished, never quiet, never a team's own page. */
function pledgePage(f: PledgeFundraiser): boolean {
  if (f.path !== "raising" || !f.public) return false;
  if (f.status !== "approved" && f.status !== "finished") return false;
  if (f.isTeam) return false;
  return !isQuietFundraiser(f);
}

/** May someone pledge on this page today? Until its day has gone, or it is finished. */
export function canPledge(f: PledgeFundraiser, today: string): boolean {
  if (!pledgePage(f) || f.status !== "approved") return false;
  return !f.eventDate || f.eventDate >= today;
}

// --- the form --------------------------------------------------------------------------------------

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number, missing: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string({ required_error: missing, invalid_type_error: missing }).min(1, missing).max(max, `Keep this to ${max} characters or fewer.`),
  );
const optionalText = (max: number) =>
  z.preprocess(blank, z.string().trim().max(max, `Keep this to ${max} characters or fewer.`).optional());

export const PLEDGE_MESSAGE_REFUSED = "Please choose different words for your message.";
export const PLEDGE_NAME_REFUSED = "Please give your own name.";
// A name is shown on the page and to the organiser, so it is checked like a message.
const name = (missing: string) => text(NAME_PART_MAX, missing).refine((v) => typeof v !== "string" || !containsBlockedWord(v), PLEDGE_NAME_REFUSED);

export const pledgeSchema = z
  .object({
    amountPence: z
      .number({ required_error: "Tell us how much you would like to pledge.", invalid_type_error: "Give the amount in pounds, like 10 or 12.50." })
      .int("Give the amount in pounds and pence, like 12.50.")
      .min(PLEDGE_MIN_PENCE, "The smallest pledge is £2.")
      .max(PLEDGE_MAX_PENCE, PLEDGE_TOO_MUCH),
    firstName: name("Please tell us your first name."),
    surname: name("Please tell us your surname."),
    email: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
      z
        .string({ required_error: "Please give your email address.", invalid_type_error: "Please give your email address." })
        .max(254, "That email address is too long.")
        .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please give an email address, like you@example.com."),
    ),
    message: z
      .preprocess(blank, z.string().trim().max(MESSAGE_MAX, `Keep your message to ${MESSAGE_MAX} characters or fewer.`).optional())
      .refine((v) => !v || !containsBlockedWord(v), PLEDGE_MESSAGE_REFUSED),
    // Like a gift: a name stays off the wall unless they choose to show it.
    showName: z.boolean().default(false),
    showAmount: z.boolean().default(true),
    giftAid: z.boolean().default(false),
    house: optionalText(100),
    address: optionalText(300),
    postcode: optionalText(12),
    nonUk: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    if (!p.giftAid) return;
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!p.address) issue("address", "Please give your street and town.");
    if (p.nonUk) return;
    if (!p.house) issue("house", "Please give your house name or number.");
    if (!p.postcode || !isValidUkPostcode(p.postcode)) issue("postcode", "Please give a UK postcode, like KA1 1AA.");
  })
  .transform((p) => ({
    amountPence: p.amountPence,
    firstName: p.firstName,
    surname: p.surname,
    email: p.email,
    message: p.message ?? null,
    showName: p.showName,
    showAmount: p.showAmount,
    giftAid: p.giftAid,
    // The address is only ever kept for Gift Aid.
    house: p.giftAid ? (p.house ?? null) : null,
    address: p.giftAid ? (p.address ?? null) : null,
    postcode: p.giftAid && !p.nonUk ? (p.postcode ?? null) : null,
    nonUk: p.giftAid && p.nonUk,
  }));

export type PledgeInput = z.infer<typeof pledgeSchema>;

// --- a stored pledge -------------------------------------------------------------------------------

export interface PledgeRow {
  id: number;
  fundraiserId: number;
  firstName: string | null;
  surname: string | null;
  email: string | null;
  amountPence: number;
  message: string | null;
  messageHidden: boolean;
  showName: boolean;
  showAmount: boolean;
  giftAid: boolean;
  status: PledgeStatus;
  createdAt: string;
  payEmailClaimedAt: string | null;
  payEmailSentAt: string | null;
  reminderClaimedAt: string | null;
  reminderSentAt: string | null;
  paidAt: string | null;
  paidAmountPence: number | null;
  cashMarkedAt: string | null;
  cancelledAt: string | null;
  anonymisedAt: string | null;
  /** Paid online, and that donation has since been refunded in full. */
  refunded: boolean;
  /** When the sponsor confirmed it by email. */
  confirmedAt?: string | null;
  /** Its organiser took it off their page. */
  hiddenAt?: string | null;
  /** Paid twice, or paid online after being marked as cash: for staff to check and refund. */
  doublePaidAt?: string | null;
  doublePaidCheckedAt?: string | null;
  /** The latest pay link, counting any staff sent by hand. */
  payEmailLastSentAt?: string | null;
}

const ukDay = (iso: string): string => londonToday(new Date(iso));
const dayPlus = (day: string, n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// --- the two emails --------------------------------------------------------------------------------

/**
 * The UK day the pay email is due: the day after the date; with no date, the day staff marked it
 * finished. One finished before its date is over, so it is due when it was finished. Null while
 * neither has happened.
 */
export function payDueDay(f: PledgeFundraiser): string | null {
  const afterDate = f.eventDate ? dayPlus(f.eventDate, 1) : null;
  const finished = f.status === "finished" && f.finishedAt ? ukDay(f.finishedAt) : null;
  if (afterDate && finished) return finished < afterDate ? finished : afterDate;
  return afterDate ?? finished;
}

/**
 * Which of the two emails is due today for this pledge, or null. Only for a pledge still open with
 * an address to write to, on a page pledges belong on. Each goes once: one already claimed (sent, or
 * part way) is never due again.
 */
export function pledgeEmailDue(p: PledgeRow, f: PledgeFundraiser, today: string): PledgeEmailKind | null {
  if (p.status !== "open" || p.anonymisedAt || !p.email || !pledgePage(f)) return null;
  if (!p.payEmailClaimedAt && !p.payEmailSentAt) {
    const due = payDueDay(f);
    if (!due) return null;
    const late = dayCount(due, today);
    return late >= 0 && late <= PAY_CATCH_UP_DAYS ? "pledge_pay" : null;
  }
  if (p.payEmailSentAt && !p.reminderClaimedAt && !p.reminderSentAt) {
    const since = dayCount(ukDay(p.payEmailSentAt), today);
    return since >= REMINDER_AFTER_DAYS && since <= REMINDER_AFTER_DAYS + REMINDER_CATCH_UP_DAYS ? "pledge_reminder" : null;
  }
  return null;
}

/**
 * Why staff may not send this pledge its pay link by hand today, or null when they may. It obeys
 * every rule the daily task does except the time window: the pledge is still open with an address,
 * its page still has pledges on it, and the link is due (the day after the event, or once a page
 * with no date is marked finished). Never early.
 */
export function payLinkRefusal(p: PledgeRow, f: PledgeFundraiser, today: string): "not_open" | "page" | "early" | null {
  if (p.status !== "open" || p.anonymisedAt || !p.email) return "not_open";
  if (!pledgePage(f)) return "page";
  const due = payDueDay(f);
  return due && dayCount(due, today) >= 0 ? null : "early";
}

// --- removing personal details ---------------------------------------------------------------------

/**
 * What the daily tidy up does to this pledge today. "anonymise": an unpaid pledge (open, cancelled or
 * paid in cash) loses its name, email, message and address 90 days after its pay email (or, never
 * emailed, after the day that email was due or the day it was cancelled or marked; with nothing to
 * count from, a year after it was made), keeping the amount. "trim": a paid pledge keeps its name (its
 * donation has it too) and loses its email after the same wait. "delete": a pledge its sponsor never
 * confirmed by email is deleted outright, 7 days after it was made.
 */
export function retentionAction(p: PledgeRow, f: PledgeFundraiser, today: string): "anonymise" | "trim" | "delete" | null {
  if (p.status === "unconfirmed") return dayCount(ukDay(p.createdAt), today) >= CONFIRM_DAYS ? "delete" : null;
  if (p.anonymisedAt || p.status === "expired") return null;
  if (p.status === "paid") {
    if (!p.email || !p.paidAt) return null;
    return dayCount(ukDay(p.paidAt), today) >= RETENTION_DAYS ? "trim" : null;
  }
  const marked = p.status === "cancelled" ? p.cancelledAt : p.status === "cash" ? p.cashMarkedAt : null;
  const from = p.payEmailSentAt ? ukDay(p.payEmailSentAt) : marked ? ukDay(marked) : payDueDay(f);
  if (from) return dayCount(from, today) >= RETENTION_DAYS ? "anonymise" : null;
  return dayCount(ukDay(p.createdAt), today) >= RETENTION_BACKSTOP_DAYS ? "anonymise" : null;
}

// --- on the page -----------------------------------------------------------------------------------

export interface PledgeWallEntry {
  name: string;
  amountPence: number | null;
  message: string | null;
  createdAt: string;
}

/**
 * The pledges the page shows: only those still to be paid, newest first, under the same name and
 * amount rules as a gift (a first name and an initial, or Anonymous; the amount unless hidden; a
 * message staff have hidden does not show).
 */
export function publicPledges(rows: PledgeRow[]): PledgeWallEntry[] {
  return rows
    .filter((p) => p.status === "open" && !p.anonymisedAt && !p.hiddenAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id))
    .map((p) => ({
      name: p.showName && p.firstName ? shortName(`${p.firstName} ${p.surname ?? ""}`) : "Anonymous",
      amountPence: p.showAmount ? p.amountPence : null,
      message: !p.messageHidden && p.message && p.message.trim() !== "" ? p.message.trim() : null,
      createdAt: p.createdAt,
    }));
}

export interface PledgeTotals {
  openCount: number;
  openPence: number;
  paidCount: number;
  /** What was actually paid online for pledges (a sponsor may pay more than they pledged). */
  paidPence: number;
  cashCount: number;
  cashPence: number;
  cancelledCount: number;
  expiredCount: number;
  /** Paid online and since refunded in full: counted in neither paid nor pledged. */
  refundedCount: number;
  /** Everything promised that was not cancelled, refunded or left unpaid: open, paid and cash, as pledged. */
  pledgedPence: number;
}

/** The totals. A pledge its sponsor has not confirmed by email counts for nothing. */
export function pledgeTotals(rows: PledgeRow[]): PledgeTotals {
  const t: PledgeTotals = {
    openCount: 0,
    openPence: 0,
    paidCount: 0,
    paidPence: 0,
    cashCount: 0,
    cashPence: 0,
    cancelledCount: 0,
    expiredCount: 0,
    refundedCount: 0,
    pledgedPence: 0,
  };
  for (const p of rows) {
    if (p.status === "unconfirmed") continue;
    if (p.status === "paid" && p.refunded) {
      t.refundedCount += 1;
      continue;
    }
    if (p.status === "open") {
      t.openCount += 1;
      t.openPence += p.amountPence;
    } else if (p.status === "paid") {
      t.paidCount += 1;
      t.paidPence += p.paidAmountPence ?? p.amountPence;
    } else if (p.status === "cash") {
      t.cashCount += 1;
      t.cashPence += p.amountPence;
    } else if (p.status === "cancelled") t.cancelledCount += 1;
    else t.expiredCount += 1;
    if (p.status === "open" || p.status === "paid" || p.status === "cash") t.pledgedPence += p.amountPence;
  }
  return t;
}

/** "Saturday 5 December 2026". */
export function longDate(day: string): string {
  const d = dateParts(day);
  return `${d.dayName} ${d.day} ${d.month} ${d.year}`;
}

/** When the pledges on a page are to be paid, for the line beside them. */
export function payWhenWords(f: Pick<PledgeFundraiser, "eventDate">, organiserFirstName: string, today: string): string {
  if (!f.eventDate) return `to be paid once ${organiserFirstName} has finished`;
  return f.eventDate >= today ? `to be paid after ${longDate(f.eventDate)}` : "still to be paid";
}

// --- for the organiser and staff -------------------------------------------------------------------

/** The sponsor's name as the organiser and staff see it; "A sponsor" once the details are gone. */
export function fullName(p: Pick<PledgeRow, "firstName" | "surname">): string {
  const name = [p.firstName, p.surname].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return name || "A sponsor";
}

export function statusWords(p: Pick<PledgeRow, "status" | "payEmailSentAt" | "refunded">): string {
  switch (p.status) {
    case "paid":
      return p.refunded ? "Paid online, then refunded" : "Paid online";
    case "cash":
      return "Paid you in cash";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Not paid";
    case "unconfirmed":
      return "Waiting for the sponsor to confirm by email";
    default:
      return p.payEmailSentAt ? "Not paid yet, pay link sent" : "Not paid yet";
  }
}

/** How many pledges were paid twice (or paid online after cash) and nobody has checked yet. */
export function doublePaidCount(rows: Array<Pick<PledgeRow, "doublePaidAt" | "doublePaidCheckedAt">>): number {
  return rows.filter((p) => p.doublePaidAt && !p.doublePaidCheckedAt).length;
}

/** How many pledges are still unpaid two weeks after their event, for the Monday summary. */
export function unpaidTwoWeeksOn(rows: Array<{ p: PledgeRow; f: PledgeFundraiser }>, today: string): number {
  return rows.filter(({ p, f }) => {
    if (p.status !== "open") return false;
    const due = payDueDay(f);
    // The email is due the day after the event, so two weeks after the event is 13 days after that.
    return due !== null && dayCount(due, today) >= UNPAID_AFTER_DAYS - (f.eventDate && due > f.eventDate ? 1 : 0);
  }).length;
}
