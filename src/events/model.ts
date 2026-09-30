import { z } from "zod";

// TASK-453: what an event on the /events page may contain, and when it is on the page.
//
// Pure and DB-free, so the admin API, the database layer and the page all share one set of rules
// and every rule is unit-tested directly. The rules that matter most are the ones that keep things
// OFF a public page: no picture linked from somewhere else on the internet, no booking link that
// could run script, and no corner note that is not one of a fixed list of plain, true statements
// (the Code of Fundraising Practice does not allow invented urgency).

// The corner note. A fixed list rather than free text: "Only 2 left!" typed on a whim is exactly
// the kind of claim the Code rules out, and a list is also what keeps it short enough to fit.
export const FLAGS = [
  "",
  "Spaces limited",
  "Selling fast",
  "Last few tickets",
  "Sold out",
  "Free entry",
  "Family friendly",
] as const;

// How an organiser is credited: briefly on the front, in full in their own band on the back.
export const FRONT_CREDITS = ["Organised by", "Hosted by", "In partnership with"] as const;
export const BACK_CREDITS = [
  "Organised by",
  "Organised and sponsored by",
  "Organised and paid for by",
  "Hosted by",
] as const;

// Access features, printed on the back so a disabled guest can decide without having to ask.
// Worded to read naturally in a list: "Access: step free entry, accessible toilets and a hearing loop."
export const ACCESS = ["step free entry", "accessible toilets", "a hearing loop", "blue badge parking"] as const;

export const IMAGE_FITS = ["cover", "whole"] as const;
export const IMAGE_GROUNDS = ["night", "cream", "crimson", "holly"] as const;
export const COVERS = ["crimson", "holly", "maroon"] as const;
export const RUN_BY = ["nbcc", "partner"] as const;
export const BOOKING = ["site", "away", "none"] as const;
export const STATUSES = ["draft", "live", "scheduled"] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UPLOADED_SRC = new RegExp(`^/media/events/${UUID}$`);
// One of the site's own images. The first character cannot be a dot and there is no slash after
// img/, so "../" can never climb out of the folder.
const SITE_IMAGE_SRC = /^\/assets\/img\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(?:png|jpe?g|webp|gif|svg)$/;

export function isSafeImageSrc(src: string): boolean {
  return UPLOADED_SRC.test(src) || SITE_IMAGE_SRC.test(src);
}

// Booking somewhere else: a real http(s) address and nothing that could break out of an attribute.
export function isWebAddress(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\s"'<>]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

// Booking on nbcc.scot: a path on this site. A second slash or a backslash straight after the
// first would make browsers treat it as another website ("//evil.example", "/\evil.example").
export function isSitePath(value: string): boolean {
  return /^\/(?![/\\])[^\s"'<>]*$/.test(value);
}

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const blankable = (v: unknown) => (v == null ? "" : typeof v === "string" ? v.trim() : v);

const text = (max: number) =>
  z.preprocess(blankable, z.string().max(max, `Keep this to ${max} characters or fewer.`));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-07.")
  .refine(isRealDate, "That date does not exist.");

const optionalDate = z
  .preprocess(blankable, z.union([z.literal(""), isoDate]))
  .transform((v) => (v === "" ? null : v));

const optionalTime = z
  .preprocess(
    blankable,
    z.union([
      z.literal(""),
      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use a time like 19:30."),
    ]),
  )
  .transform((v) => (v === "" ? null : v.slice(0, 5)));

const optionalSrc = z
  .preprocess(
    blankable,
    z.union([
      z.literal(""),
      z.string().refine(isSafeImageSrc, "Pictures have to be uploaded here, not linked from another website."),
    ]),
  )
  .transform((v) => (v === "" ? null : v));

const choice = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((v) => (v == null ? fallback : v), z.enum(values as unknown as [T[number], ...T[number][]]));

export const eventInputSchema = z
  .object({
    name: text(60).pipe(z.string().min(1, "Give the event a name.")),
    subtitle: text(60),
    gist: text(200),
    date: z.preprocess(blankable, isoDate),
    start: optionalTime,
    end: optionalTime,
    timeTbc: z.boolean().default(false),
    venue: text(80),
    town: text(60),
    address: text(300),
    access: z
      .array(z.enum(ACCESS))
      .max(ACCESS.length)
      .default([])
      .transform((list) => ACCESS.filter((a) => list.includes(a))),
    imageSrc: optionalSrc,
    imageFit: choice(IMAGE_FITS, "cover"),
    imageGround: choice(IMAGE_GROUNDS, "night"),
    imageAlt: text(200),
    cover: choice(COVERS, "crimson"),
    costFront: text(60),
    costBack: text(200),
    flag: choice(FLAGS, ""),
    listHeading: text(40),
    whatsOn: text(1500),
    note: text(600),
    runBy: choice(RUN_BY, "nbcc"),
    partnerName: text(80),
    partnerFront: choice(FRONT_CREDITS, "Organised by"),
    partnerCredit: choice(BACK_CREDITS, "Organised by"),
    partnerLogoSrc: optionalSrc,
    partnerLine: text(400),
    bookingHow: choice(BOOKING, "site"),
    bookingUrl: text(500),
    bookingLabel: text(40),
    bookingNote: text(120),
    status: choice(STATUSES, "draft"),
    showFrom: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.start && v.end && v.end <= v.start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "The finish time is before the start." });
    }
    if (v.status === "scheduled" && !v.showFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["showFrom"], message: "Pick the date it should go up on the website." });
    }
    if (v.bookingHow === "away" && v.bookingUrl && !isWebAddress(v.bookingUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bookingUrl"],
        message: "Paste the full web address, starting https://",
      });
    }
    if (v.bookingHow === "site" && v.bookingUrl && !isSitePath(v.bookingUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bookingUrl"],
        message: "For a page on nbcc.scot, start with a slash, for example /ball",
      });
    }
  })
  // A link kept for "no booking needed" would never show and could never be checked, so it goes.
  .transform((v) => (v.bookingHow === "none" ? { ...v, bookingUrl: "" } : v));

export type EventInput = z.output<typeof eventInputSchema>;
export type EventRecord = EventInput & { id: number; slug: string };
export type EventStatus = (typeof STATUSES)[number];

/**
 * What still stands between a saved event and the page. A draft may be saved half finished; it
 * may not go live until this is empty. Plain English, because a volunteer reads it.
 */
export function publishProblems(ev: EventInput): string[] {
  const problems: string[] = [];
  if (!ev.gist) problems.push("Add the gist for the front of the card.");
  if (!ev.venue) problems.push("Add the venue.");
  if (ev.bookingHow !== "none" && !ev.bookingUrl) problems.push("Add the booking link.");
  if (ev.bookingHow !== "none" && !ev.bookingLabel) problems.push("Add the words for the booking button.");
  if (ev.runBy === "partner" && !ev.partnerName) problems.push("Add the name of whoever is running it.");
  return problems;
}

/** A card's web address fragment: lowercase words and hyphens, stable once the event exists. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "event";
}

const LONDON_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date where the charity is, as YYYY-MM-DD. */
export function londonToday(now: Date): string {
  return LONDON_DATE.format(now);
}

/**
 * Is this event on the page today? A live event shows up to and including its own day, and drops
 * off the day after. A scheduled one also waits for its date to go up. A draft never shows.
 */
export function isOnPage(ev: { status: string; showFrom: string | null; date: string }, today: string): boolean {
  if (ev.date < today) return false;
  if (ev.status === "live") return true;
  if (ev.status === "scheduled") return ev.showFrom !== null && ev.showFrom <= today;
  return false;
}

/** Soonest first; on the same day the earlier start, then anything without a time, then by name. */
export function sortForPage<T extends { date: string; start: string | null; name: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.start !== b.start) {
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start < b.start ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "en-GB");
  });
}
