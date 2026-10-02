import { z } from "zod";
import { ACCESS, isSafeImageSrc, isWebAddress } from "../events/model";
import { isValidUkPostcode } from "../declarations/fields";
import { containsBlockedWord } from "../donors/display-name-filter";
import type { NewsEntry } from "./news";

// TASK-493: community fundraising, the rules. Pure: no pool, no config, no clock, so every rule is
// unit tested without a database (test/unit/fundraising-model.test.ts). The SQL is in
// src/db/fundraisers.ts and the routes in src/routes/fundraise.ts and admin-fundraising.ts.
//
// See docs/superpowers/specs/2026-10-02-community-fundraising-design.md. In short:
//   - one sign up form, two paths: raising money (gets a page and a meter) or holding an event;
//   - staff approve every one before anything about it is public;
//   - organisers change their page by an emailed link, and every change waits for staff;
//   - raised = paid online gifts, less refunds, plus cash staff record as paid in.
//
// Words people read are plain, friendly English, with no dashes.

export const PATHS = ["raising", "event"] as const;
export type FundraiserPath = (typeof PATHS)[number];

export const KINDS = ["run_walk", "santa_dash", "bake_sale", "quiz_party", "collection", "birthday", "other"] as const;
export type FundraiserKind = (typeof KINDS)[number];

export const KIND_LABELS: Record<FundraiserKind, string> = {
  run_walk: "A run or walk",
  santa_dash: "A Santa dash",
  bake_sale: "A bake sale or coffee morning",
  quiz_party: "A quiz or party",
  collection: "A workplace or school collection",
  birthday: "A birthday",
  other: "Something else",
};

export const STATUSES = ["new", "approved", "declined", "finished"] as const;
export type FundraiserStatus = (typeof STATUSES)[number];

export const TARGET_MIN_PENCE = 1000; // £10
export const TARGET_MAX_PENCE = 10_000_000; // £100,000
export const DESCRIPTION_MAX = 1000;
export const MESSAGE_MAX = 200;
export const GIFT_MIN_PENCE = 200; // £2, as the design asks
export const MAX_LEAFLETS = 1000;
export const MAX_BUCKETS = 20;
/** The line for the front of an event's card: one or two sentences, as the events editor asks. */
export const CARD_LINE_MAX = 140;

// Addresses under /fundraise/ that are pages of their own, so no fundraiser may take them: the manage
// page (TASK-494), the help page (TASK-498), and the logo pack and blank sponsor form (TASK-504).
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["manage", "help", "logos", "sponsor-form"]);

/**
 * What they would like from us, stored as the fundraisers.wants jsonb.
 *
 * TASK-499 split the requests: posters, leaflets, collection buckets and collection tins each have a
 * number of their own (posterCount, leafletCount, bucketCount, tinCount). Sign ups made before then
 * asked for one combined number of "leaflets or posters" (leaflets) and one of "buckets or tins"
 * (buckets). Those two keys keep that old meaning and are still read, and shown in the old words; a
 * new sign up leaves them at 0.
 */
export interface Wants {
  posterCount: number;
  leafletCount: number;
  bucketCount: number;
  tinCount: number;
  /** Before TASK-499: leaflets OR posters, one number. */
  leaflets: number;
  /** Before TASK-499: buckets OR tins, one number. */
  buckets: number;
  shoutOut: boolean;
  attend: boolean;
}

/** Is anything to be posted? Then we need an address. Old combined requests count too. */
export function wantsPosted(w: Wants): boolean {
  return w.posterCount + w.leafletCount + w.bucketCount + w.tinCount + w.leaflets + w.buckets > 0;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Each thing to be posted, in words: "50 leaflets", and an old combined one as it was asked for. */
export function wantsLines(w: Wants): string[] {
  const lines: string[] = [];
  if (w.posterCount > 0) lines.push(count(w.posterCount, "poster", "posters"));
  if (w.leafletCount > 0) lines.push(count(w.leafletCount, "leaflet", "leaflets"));
  if (w.bucketCount > 0) lines.push(count(w.bucketCount, "collection bucket", "collection buckets"));
  if (w.tinCount > 0) lines.push(count(w.tinCount, "collection tin", "collection tins"));
  if (w.leaflets > 0) lines.push(count(w.leaflets, "leaflet or poster", "leaflets or posters"));
  if (w.buckets > 0) lines.push(count(w.buckets, "bucket or tin", "buckets or tins"));
  return lines;
}

// --- the event questions (TASK-499), worded like the admin's events editor ------------------------

export type AccessFeature = (typeof ACCESS)[number];

/** The access ticks, as the events editor labels them. The stored values are the events model's. */
export const ACCESS_LABELS: Record<AccessFeature, string> = {
  "step free entry": "Step free entry",
  "accessible toilets": "Accessible toilets",
  "a hearing loop": "Hearing loop",
  "blue badge parking": "Blue badge parking",
};

/** How people get in. NBCC selling the tickets comes with the ticketing stage, not here. */
export const BOOKINGS = ["away", "door", "free"] as const;
export type FundraiserBooking = (typeof BOOKINGS)[number];
export const BOOKING_LABELS: Record<FundraiserBooking, string> = {
  away: "Tickets are sold on another website",
  door: "Pay on the door, no booking needed",
  free: "Free, just come along",
};

/** "ka11aa" -> "KA1 1AA": upper case, one space before the last three. Check it is valid first. */
export function normalisePostcode(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** A ticket link: a real web address, and https only, as it goes on a public button. */
export function isTicketLink(value: string): boolean {
  return /^https:\/\//i.test(value) && isWebAddress(value);
}

// --- small shared pieces ---------------------------------------------------------------------------

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const blankable = (v: unknown) => (v == null ? "" : typeof v === "string" ? v.trim() : v);

const requiredText = (max: number, missing: string) =>
  z.preprocess(blankable, z.string().min(1, missing).max(max, `Keep this to ${max} characters or fewer.`));

const optionalText = (max: number) =>
  z.preprocess(blankable, z.string().max(max, `Keep this to ${max} characters or fewer.`));

const nullableText = (max: number) => optionalText(max).transform((v) => (v === "" ? null : v));

const optionalDate = z
  .preprocess(
    blankable,
    z.union([
      z.literal(""),
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-05.")
        .refine(isRealDate, "That date does not exist."),
    ]),
  )
  .transform((v) => (v === "" ? null : v));

const optionalTime = z
  .preprocess(
    blankable,
    z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use a time like 10:30.")]),
  )
  .transform((v) => (v === "" ? null : v.slice(0, 5)));

const optionalTarget = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z
    .number()
    .int("Give the target in whole pounds and pence.")
    .min(TARGET_MIN_PENCE, "A target needs to be at least £10.")
    .max(TARGET_MAX_PENCE, "A target can be up to £100,000.")
    .nullable(),
);

const optionalWebLink = z
  .preprocess(
    blankable,
    z.union([
      z.literal(""),
      z.string().max(300, "That link is too long.").refine(isWebAddress, "Paste the full link, starting https://"),
    ]),
  )
  .transform((v) => (v === "" ? null : v));

const phone = z.preprocess(
  blankable,
  z
    .string()
    .min(1, "Please give us a phone number, so we can call you.")
    .max(20, "That phone number is too long.")
    .refine((v) => /^[+0-9 ()-]+$/.test(v) && v.replace(/\D/g, "").length >= 7, "That does not look like a phone number."),
);

const email = z.preprocess(blankable, z.string().email("Please check your email address.").max(254));

const howMany = (max: number, tooMany: string) =>
  z
    .number({ invalid_type_error: "Give a whole number, or 0 for none." })
    .int("Give a whole number, or 0 for none.")
    .min(0, "Give a whole number, or 0 for none.")
    .max(max, tooMany)
    .default(0);

const wantsSchema = z
  .object({
    posterCount: howMany(MAX_LEAFLETS, "We can send up to 1,000 posters."),
    leafletCount: howMany(MAX_LEAFLETS, "We can send up to 1,000 leaflets."),
    bucketCount: howMany(MAX_BUCKETS, `We can lend up to ${MAX_BUCKETS} buckets.`),
    tinCount: howMany(MAX_BUCKETS, `We can lend up to ${MAX_BUCKETS} tins.`),
    // Before TASK-499, one number each: still taken, so a sign up from then can be saved as it is.
    leaflets: howMany(MAX_LEAFLETS, `We can send up to ${MAX_LEAFLETS} leaflets.`),
    buckets: howMany(MAX_BUCKETS, `We can lend up to ${MAX_BUCKETS} buckets or tins.`),
    shoutOut: z.boolean().default(false),
    attend: z.boolean().default(false),
  })
  .strict();

const optionalPostcode = z
  .preprocess(
    blankable,
    z.union([z.literal(""), z.string().refine(isValidUkPostcode, "That does not look like a UK postcode, like KA1 1AA.")]),
  )
  .transform((v) => (v === "" ? null : normalisePostcode(v)));

const optionalTicketLink = z
  .preprocess(
    blankable,
    z.union([
      z.literal(""),
      z.string().max(500, "That link is too long.").refine(isTicketLink, "Paste the full web address, starting https://"),
    ]),
  )
  .transform((v) => (v === "" ? null : v));

const optionalBooking = z.preprocess(
  (v) => (v == null || v === "" ? null : v),
  z.enum(BOOKINGS, { errorMap: () => ({ message: "Choose how people get in." }) }).nullable(),
);

const accessList = z
  .array(z.enum(ACCESS, { errorMap: () => ({ message: "Tick only the access listed." }) }))
  .max(ACCESS.length)
  .transform((list) => ACCESS.filter((a) => list.includes(a)));

const cardLine = z
  .preprocess(blankable, z.string().max(CARD_LINE_MAX, `Keep this to ${CARD_LINE_MAX} characters or fewer, so it fits on the card.`))
  .transform((v) => (v === "" ? null : v));

// The finish time, when both are given, has to be after the start (the events editor's words).
export const FINISH_BEFORE_START = "The finish time is before the start.";

function finishAfterStart(b: { startTime?: string | null; endTime?: string | null }, ctx: z.RefinementCtx) {
  if (b.startTime && b.endTime && b.endTime <= b.startTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: FINISH_BEFORE_START });
  }
}

type Times = { startTime?: string | null; endTime?: string | null };

/**
 * A change to one of the times, checked against the other as it is stored: would the finish end up
 * at or before the start? Returns the time to name (the one that was changed; the finish when both
 * were), or null when all is well. A sign up with no finish time, as every one from before TASK-499
 * is, is never refused. Used under the row's lock for staff changes and for approving an organiser's.
 */
export function finishTimeProblem(stored: Times, change: Record<string, unknown>): "startTime" | "endTime" | null {
  const has = (k: "startTime" | "endTime") => Object.prototype.hasOwnProperty.call(change, k) && change[k] !== undefined;
  const start = has("startTime") ? (change.startTime as string | null) : stored.startTime ?? null;
  const end = has("endTime") ? (change.endTime as string | null) : stored.endTime ?? null;
  if (!start || !end || end > start) return null;
  return has("endTime") ? "endTime" : has("startTime") ? "startTime" : null;
}



const wants = z.preprocess((v) => (v == null ? {} : v), wantsSchema);

const optionalImage = z
  .preprocess(
    blankable,
    z.union([
      z.literal(""),
      z.string().refine(isSafeImageSrc, "Pictures have to be uploaded here, not linked from another website."),
    ]),
  )
  .transform((v) => (v === "" ? null : v));

// --- the sign up form (POST /api/fundraise) ---------------------------------------------------------

export const signUpSchema = z
  .object({
    path: z.enum(PATHS, { errorMap: () => ({ message: "Tell us whether you are raising money or holding an event." }) }),
    kind: z.enum(KINDS, { errorMap: () => ({ message: "Choose what kind of fundraiser it is." }) }),
    title: requiredText(100, "Give it a name, like Sam's Santa Dash."),
    description: requiredText(DESCRIPTION_MAX, "Tell us a little about it."),
    eventDate: optionalDate,
    startTime: optionalTime,
    venue: optionalText(120),
    town: optionalText(80),
    targetPence: optionalTarget.optional().transform((v) => v ?? null),
    public: z.boolean({ errorMap: () => ({ message: "Tell us whether to show it on our website." }) }),
    name: requiredText(100, "Please tell us your name."),
    email,
    phone,
    socialLink: optionalWebLink,
    socialOk: z.boolean().default(false),
    wants,
    // TASK-499: where to post things, in separate boxes. The old single box (postAddress) is no
    // longer on the form; one sent anyway is dropped, never stored.
    postLine1: nullableText(120),
    postLine2: nullableText(120),
    postTown: nullableText(80),
    postPostcode: optionalPostcode,
    newsletterOk: z.boolean().default(false),
    // TASK-499: the event questions, asked only when holding an event.
    cardLine,
    endTime: optionalTime,
    timeTbc: z.boolean().default(false),
    venueAddress: nullableText(300),
    venuePostcode: optionalPostcode,
    access: z.preprocess((v) => (v == null ? [] : v), accessList),
    price: nullableText(60),
    booking: optionalBooking.optional().transform((v) => v ?? null),
    ticketUrl: optionalTicketLink,
    ageLimit: nullableText(60),
    dressCode: nullableText(60),
    included: nullableText(300),
    creditName: nullableText(80),
  })
  .superRefine((b, ctx) => {
    const missing = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (b.path === "event") {
      if (!b.eventDate) missing("eventDate", "Tell us the date of your event.");
      if (!b.cardLine) missing("cardLine", "Add a line for the front of the card.");
      if (!b.venue) missing("venue", "Tell us the venue.");
      if (!b.booking) missing("booking", "Tell us how people get in.");
      if (b.booking === "away" && !b.ticketUrl) missing("ticketUrl", "Paste the link to where the tickets are sold, starting https://");
      finishAfterStart(b, ctx);
    }
    if (wantsPosted(b.wants)) {
      if (!b.postLine1) missing("postLine1", "Tell us the first line of the address.");
      if (!b.postTown) missing("postTown", "Tell us the town.");
      if (!b.postPostcode) missing("postPostcode", "Tell us the postcode.");
    }
  })
  .transform((b) => {
    // Nothing to post, no address kept.
    const posted = wantsPosted(b.wants);
    // Holding an event is listed as an event: it has no page and no meter in stage 1, so no target.
    // Raising money gets a page, never an event card, so none of the event answers are kept.
    const event = b.path === "event";
    const only = <T>(keep: boolean, value: T) => (keep ? value : null);
    return {
      ...b,
      targetPence: event ? null : b.targetPence,
      postLine1: only(posted, b.postLine1),
      postLine2: only(posted, b.postLine2),
      postTown: only(posted, b.postTown),
      postPostcode: only(posted, b.postPostcode),
      cardLine: only(event, b.cardLine),
      endTime: only(event, b.endTime),
      timeTbc: event && b.timeTbc,
      venueAddress: only(event, b.venueAddress),
      venuePostcode: only(event, b.venuePostcode),
      access: event ? b.access : [],
      price: only(event, b.price),
      booking: only(event, b.booking),
      // A ticket link for the door or for free would never show and could never be checked.
      ticketUrl: only(event && b.booking === "away", b.ticketUrl),
      ageLimit: only(event, b.ageLimit),
      dressCode: only(event, b.dressCode),
      included: only(event, b.included),
      creditName: only(event, b.creditName),
    };
  });

export type SignUp = z.infer<typeof signUpSchema>;

// --- an organiser's change, from the private area (TASK-501) -------------------------------------

// TASK-501: everything an organiser could ask to change before, plus the event details TASK-499
// added (in the sign up's shapes). Every change still waits for staff (fundraiser_edits).
export const EVENT_ONLY_FIELDS = [
  "cardLine",
  "endTime",
  "timeTbc",
  "venueAddress",
  "venuePostcode",
  "access",
  "price",
  "booking",
  "ticketUrl",
  "ageLimit",
  "dressCode",
  "included",
] as const;

export const EDITABLE_FIELDS = [
  "description",
  "targetPence",
  "eventDate",
  "startTime",
  "venue",
  "town",
  "socialLink",
  ...EVENT_ONLY_FIELDS,
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const editSchema = z
  .object({
    description: requiredText(DESCRIPTION_MAX, "Tell us a little about it.").optional(),
    targetPence: optionalTarget.optional(),
    eventDate: optionalDate.optional(),
    startTime: optionalTime.optional(),
    venue: optionalText(120).optional(),
    town: optionalText(80).optional(),
    socialLink: optionalWebLink.optional(),
    cardLine: cardLine.optional(),
    endTime: optionalTime.optional(),
    timeTbc: z.boolean().optional(),
    venueAddress: nullableText(300).optional(),
    venuePostcode: optionalPostcode.optional(),
    access: accessList.optional(),
    price: nullableText(60).optional(),
    booking: optionalBooking.optional(),
    ticketUrl: optionalTicketLink.optional(),
    ageLimit: nullableText(60).optional(),
    dressCode: nullableText(60).optional(),
    included: nullableText(300).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "There is nothing to change." });

export type FundraiserEdit = z.infer<typeof editSchema>;

export const TICKET_LINK_NEEDED = "Paste the link to where the tickets are sold, starting https://";
export const TICKET_LINK_ONLY_AWAY = "A ticket link is only for tickets sold on another website.";

/**
 * TASK-501: an organiser's change checked as it would land: what is stored, with the change on
 * top. The sign up's cross checks, so a change to one field can never leave another wrong: the
 * finish after the start (finishTimeProblem), a ticket link only (and always) for tickets sold on
 * another website, and what an event's card cannot do without. A field an event card needs is only
 * held to that when it is the one being changed, so a sign up from before the event questions is
 * never refused for an answer it was never asked. Event details are refused for a page raising
 * money, and a target for an event. Returns the change to store (a ticket link that no longer
 * applies is cleared with it) and any field messages.
 */
export function checkOrganiserEdit(
  stored: FundraiserRecord,
  change: FundraiserEdit,
): { change: FundraiserEdit; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const c = change as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(c, k) && c[k] !== undefined;
  const out: FundraiserEdit = { ...change };

  if (stored.path !== "event") {
    for (const k of EVENT_ONLY_FIELDS) if (has(k)) fields[k] = "This is only for events.";
  } else {
    if (has("targetPence") && change.targetPence !== null) fields.targetPence = "An event does not have a target.";
    if (has("eventDate") && !change.eventDate) fields.eventDate = "Tell us the date of your event.";
    if (has("cardLine") && !change.cardLine) fields.cardLine = "Add a line for the front of the card.";
    if (has("venue") && !change.venue) fields.venue = "Tell us the venue.";
    if (has("booking") && !change.booking) fields.booking = "Tell us how people get in.";
    const booking = has("booking") ? change.booking : stored.booking;
    const ticket = has("ticketUrl") ? change.ticketUrl : stored.ticketUrl;
    if (booking === "away") {
      if (!ticket && (has("booking") || has("ticketUrl"))) fields.ticketUrl = TICKET_LINK_NEEDED;
    } else if (has("ticketUrl") && change.ticketUrl) {
      fields.ticketUrl = TICKET_LINK_ONLY_AWAY;
    } else if (has("booking") && stored.ticketUrl) {
      out.ticketUrl = null;
    }
  }
  const clash = finishTimeProblem(stored, c);
  if (clash && !fields[clash]) fields[clash] = FINISH_BEFORE_START;
  return { change: out, fields };
}

// --- a staff edit (PATCH /api/admin/fundraisers/:id) ----------------------------------------------

export function isValidSlug(slug: string): boolean {
  return slug.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

export const adminPatchSchema = z
  .object({
    path: z.enum(PATHS),
    kind: z.enum(KINDS),
    title: requiredText(100, "Give it a name."),
    description: optionalText(DESCRIPTION_MAX),
    eventDate: optionalDate,
    startTime: optionalTime,
    venue: optionalText(120),
    town: optionalText(80),
    targetPence: optionalTarget,
    public: z.boolean(),
    name: requiredText(100, "The organiser needs a name."),
    email,
    phone,
    socialLink: optionalWebLink,
    socialOk: z.boolean(),
    wants,
    // The single address box of a sign up made before TASK-499, still there to correct.
    postAddress: nullableText(500),
    postLine1: nullableText(120),
    postLine2: nullableText(120),
    postTown: nullableText(80),
    postPostcode: optionalPostcode,
    newsletterOk: z.boolean(),
    imageSrc: optionalImage,
    slug: z.string().refine(isValidSlug, "Use lower case letters and numbers, joined by single hyphens."),
    // TASK-499: the event questions. Staff may set any of them on any sign up, including one from
    // before they were asked; each is checked on its own, as a change may carry only one.
    cardLine,
    endTime: optionalTime,
    timeTbc: z.boolean(),
    venueAddress: nullableText(300),
    venuePostcode: optionalPostcode,
    access: accessList,
    price: nullableText(60),
    booking: optionalBooking,
    ticketUrl: optionalTicketLink,
    ageLimit: nullableText(60),
    dressCode: nullableText(60),
    included: nullableText(300),
    creditName: nullableText(80),
  })
  .partial()
  .strict()
  .superRefine(finishAfterStart)
  .refine((b) => Object.keys(b).length > 0, { message: "There is nothing to change." });

export type AdminPatch = z.infer<typeof adminPatchSchema>;

// --- slugs ---------------------------------------------------------------------------------------

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return slug || "fundraiser";
}

// --- the meter -----------------------------------------------------------------------------------

/** What is left of one online gift after any refund: never below nothing. */
export function giftNetPence(amountPence: number, refundedPence: number): number {
  return Math.max(0, amountPence - Math.max(0, refundedPence));
}

/**
 * TASK-502: the Gift Aid on one gift, shown beside it and under the meter: a quarter of the gift (the
 * basic rate value HMRC adds to every pound), rounded DOWN to whole pence so it is never overstated.
 * Shown only: Gift Aid never counts towards the raised figure, the target or the percentage.
 */
export function giftAidPence(netPence: number): number {
  return Math.floor(Math.max(0, netPence) / 4);
}

/**
 * TASK-502: the Gift Aid under the meter: every paid online gift that claimed it, each on what is
 * left after any refund, rounded per gift. Money the organiser paid in never counts (it is not their
 * own gift, and never claims it). A gift whose amount is hidden on the wall still counts, as it does
 * in the raised figure. src/db/fundraisers.ts (GIFT_AID_SQL) sums exactly this in SQL.
 */
export function giftAidOnGifts(rows: Array<Pick<WallSourceRow, "amountPence" | "refundedPence" | "giftAid" | "paidIn">>): number {
  return rows
    .filter((r) => r.giftAid && !r.paidIn)
    .reduce((sum, r) => sum + giftAidPence(giftNetPence(r.amountPence, r.refundedPence)), 0);
}

export interface Meter {
  raisedPence: number;
  onlinePence: number;
  cashPence: number;
  /** TASK-502: the Gift Aid on the gifts, shown under the total. Never part of raisedPence. */
  giftAidPence: number;
  targetPence: number | null;
  /** Whole percent of the target, rounded down; can pass 100. Null when there is no target. */
  percent: number | null;
  /** The same, held to 100 for drawing the bar. Null when there is no target. */
  barPercent: number | null;
  overTarget: boolean;
}

export function meter(input: { onlinePence: number; cashPence: number; targetPence: number | null; giftAidPence?: number }): Meter {
  const onlinePence = Math.max(0, input.onlinePence);
  const cashPence = Math.max(0, input.cashPence);
  const raisedPence = onlinePence + cashPence;
  const target = input.targetPence && input.targetPence > 0 ? input.targetPence : null;
  const percent = target ? Math.floor((raisedPence * 100) / target) : null;
  return {
    raisedPence,
    onlinePence,
    cashPence,
    giftAidPence: Math.max(0, Math.floor(input.giftAidPence ?? 0)),
    targetPence: target,
    percent,
    barPercent: percent === null ? null : Math.min(100, percent),
    overTarget: target !== null && raisedPence > target,
  };
}

// --- names ---------------------------------------------------------------------------------------

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A first name and a last initial ("Robin T."), as the page shows organisers and supporters. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Anonymous";
  const first = capital(parts[0]);
  if (parts.length === 1) return first;
  return `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

// --- the supporter wall --------------------------------------------------------------------------

export interface WallSourceRow {
  donationId: number;
  fullName: string;
  anonymous: boolean;
  showName: boolean;
  showAmount: boolean;
  amountPence: number;
  refundedPence: number;
  message: string | null;
  hidden: boolean;
  createdAt: string;
  /** TASK-501: money the organiser collected and paid in. On the meter, never on the wall. */
  paidIn?: boolean;
  /** TASK-502: the gift claimed Gift Aid. */
  giftAid?: boolean;
}

export interface WallEntry {
  name: string;
  amountPence: number | null;
  /** TASK-502: the Gift Aid on it, only when the amount shows and it claimed Gift Aid. */
  giftAidPence?: number | null;
  message: string | null;
  createdAt: string;
}

// What a donor's name becomes when their details are redacted at the end of the retention period
// (src/db/admin.ts). Such a giver shows as Anonymous, never as "Redacted R.".
const REDACTED_NAME = "redacted";

/**
 * The public wall: newest first. Staff hiding a message hides only the message: the gift stays,
 * under the same name and amount rules. A gift refunded in full never shows, and nor does money the
 * organiser paid in (TASK-501): that is theirs to collect, not a supporter's gift.
 */
export function wallEntries(rows: WallSourceRow[]): WallEntry[] {
  return rows
    .filter((r) => !r.paidIn && giftNetPence(r.amountPence, r.refundedPence) > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.donationId - a.donationId))
    .map((r) => {
      const net = giftNetPence(r.amountPence, r.refundedPence);
      const aid = r.showAmount && r.giftAid ? giftAidPence(net) : 0;
      return {
        name: r.showName && !r.anonymous && r.fullName.trim().toLowerCase() !== REDACTED_NAME ? shortName(r.fullName) : "Anonymous",
        amountPence: r.showAmount ? net : null,
        giftAidPence: aid > 0 ? aid : null,
        message: !r.hidden && r.message && r.message.trim() !== "" ? r.message.trim() : null,
        createdAt: r.createdAt,
      };
    });
}

// --- the message after paying (TASK-502) ---------------------------------------------------------

/**
 * A Stripe Checkout Session id, as Stripe puts it in the address it sends a giver back to:
 * cs_test_..., cs_live_..., or the offline stub's cs_preview_N. Letters, digits and underscores only,
 * so it is safe in an attribute, and never Stripe's unfilled placeholder.
 */
export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && /^cs_[A-Za-z0-9_]{1,250}$/.test(value);
}

/** The gift a checkout session paid for, as the wall step needs to judge it. */
export interface GiftForSession {
  donationId: number;
  fundraiserId: number | null;
  paidIn: boolean;
  paymentStatus: string;
  message: string | null;
  wallAddedAt: string | null;
}

export type WallStepVerdict = "ok" | "not_recorded" | "not_found" | "paid_in" | "unpaid" | "already";

/**
 * May the giver behind this checkout session add a message and their choices to this fundraiser's
 * wall? Only for a gift on THIS fundraiser, never money the organiser paid in, only once the payment
 * has gone through (or while a Direct Debit is settling: the wall shows a gift only once it is paid),
 * and only once: never a second time, and never over a message left on the give form before TASK-502.
 * Null (the webhook has not recorded the payment yet) is "not_recorded": the caller asks Stripe.
 */
export function wallStepVerdict(gift: GiftForSession | null, fundraiserId: number): WallStepVerdict {
  if (!gift) return "not_recorded";
  if (gift.fundraiserId !== fundraiserId) return "not_found";
  if (gift.paidIn) return "paid_in";
  if (gift.paymentStatus !== "paid" && gift.paymentStatus !== "pending") return "unpaid";
  if (gift.wallAddedAt || (gift.message !== null && gift.message.trim() !== "")) return "already";
  return "ok";
}

export const WALL_MESSAGE_REFUSED = "Please choose different words for your message on the supporter wall.";

/** What the thank you's optional step sends: the session, the words, and the two wall choices. */
export const wallMessageSchema = z.object({
  sessionId: z.string({ required_error: "We could not find your payment." }).refine(isCheckoutSessionId, "We could not find your payment."),
  message: z
    .preprocess(blankable, z.string().max(MESSAGE_MAX, `Keep your message to ${MESSAGE_MAX} characters or fewer.`))
    .refine((v) => !containsBlockedWord(v), WALL_MESSAGE_REFUSED),
  // Matches checkout: a giver's name stays off the wall unless they choose to show it (Jaimie, 2026-10-02).
  showName: z.boolean().default(false),
  showAmount: z.boolean().default(true),
});

export type WallMessage = z.infer<typeof wallMessageSchema>;

// --- the record, and what the public sees of it --------------------------------------------------

export interface FundraiserRecord {
  id: number;
  slug: string;
  path: FundraiserPath;
  kind: FundraiserKind;
  title: string;
  description: string;
  eventDate: string | null;
  startTime: string | null;
  venue: string;
  town: string;
  targetPence: number | null;
  public: boolean;
  status: FundraiserStatus;
  name: string;
  email: string;
  phone: string;
  socialLink: string | null;
  socialOk: boolean;
  wants: Wants;
  /** The single address box of a sign up made before TASK-499; null for one made since. */
  postAddress: string | null;
  postLine1: string | null;
  postLine2: string | null;
  postTown: string | null;
  postPostcode: string | null;
  newsletterOk: boolean;
  imageSrc: string | null;
  declinedReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  // TASK-499: the event questions. A sign up from before they were asked has them all empty
  // (null, false or []), and its card is drawn as it always was.
  cardLine: string | null;
  endTime: string | null;
  timeTbc: boolean;
  venueAddress: string | null;
  venuePostcode: string | null;
  access: AccessFeature[];
  price: string | null;
  booking: FundraiserBooking | null;
  ticketUrl: string | null;
  ageLimit: string | null;
  dressCode: string | null;
  included: string | null;
  creditName: string | null;
  /** TASK-501: when the organiser pressed "I've finished" (it finishes nothing by itself). */
  finishedRequestedAt?: string | null;
  /**
   * TASK-503: when staff took it off the Get involved list. Its page and giving link keep working;
   * it is only no longer listed.
   */
  offListAt?: string | null;
  offListBy?: string | null;
}

/** The event answers a card shows. All of them are meant for the public; none is private. */
export interface PublicEventAnswers {
  cardLine: string | null;
  endTime: string | null;
  timeTbc: boolean;
  venueAddress: string | null;
  venuePostcode: string | null;
  access: AccessFeature[];
  price: string | null;
  booking: FundraiserBooking | null;
  ticketUrl: string | null;
  ageLimit: string | null;
  dressCode: string | null;
  included: string | null;
}

export interface PublicCard extends Partial<PublicEventAnswers> {
  id: number;
  slug: string;
  path: FundraiserPath;
  kind: FundraiserKind;
  kindLabel: string;
  title: string;
  description: string;
  eventDate: string | null;
  startTime: string | null;
  venue: string;
  town: string;
  imageSrc: string | null;
  organisedBy: string;
  /** The fundraiser's own page, or null for an event sign up (listed as an event, no page). */
  url: string | null;
  meter: Meter;
}

export interface PublicPage extends PublicCard {
  wall: WallEntry[];
  giving: { fundraiserId: number; minimumPence: number };
  /** TASK-502: finished, so the page says so and still takes gifts under "You can still give". */
  finished?: boolean;
  /** TASK-506: the news updates staff approved, newest first (src/fundraising/news.ts publicNews). */
  news?: NewsEntry[];
}

/** Built field by field, so nothing private (email, phone, address, notes) can reach the public. */
export function publicCard(f: FundraiserRecord, m: Meter): PublicCard {
  return {
    id: f.id,
    slug: f.slug,
    path: f.path,
    kind: f.kind,
    kindLabel: KIND_LABELS[f.kind],
    title: f.title,
    description: f.description,
    eventDate: f.eventDate,
    startTime: f.startTime,
    venue: f.venue,
    town: f.town,
    imageSrc: f.imageSrc,
    // An event may be credited to the name they gave (their group or business); a page never is.
    organisedBy: f.path === "event" && f.creditName ? f.creditName : shortName(f.name),
    url: f.path === "raising" ? `/fundraise/${f.slug}` : null,
    meter: m,
    cardLine: f.cardLine,
    endTime: f.endTime,
    timeTbc: f.timeTbc,
    venueAddress: f.venueAddress,
    venuePostcode: f.venuePostcode,
    access: f.access,
    price: f.price,
    booking: f.booking,
    ticketUrl: f.ticketUrl,
    ageLimit: f.ageLimit,
    dressCode: f.dressCode,
    included: f.included,
  };
}

export function publicPage(f: FundraiserRecord, m: Meter, wall: WallEntry[]): PublicPage {
  return {
    ...publicCard(f, m),
    wall,
    giving: { fundraiserId: f.id, minimumPence: GIFT_MIN_PENCE },
    finished: f.status === "finished",
  };
}

/**
 * Is it on the public side at all? Approved and public; an event drops off after its day. TASK-503:
 * one staff have taken off Get involved is not listed (its page, if it has one, still works).
 */
export function isListed(
  f: Pick<FundraiserRecord, "status" | "public" | "path" | "eventDate" | "offListAt">,
  today: string,
): boolean {
  if (f.status !== "approved" || !f.public) return false;
  if (f.offListAt) return false;
  if (f.path === "event" && f.eventDate !== null && f.eventDate < today) return false;
  return true;
}

/**
 * Does it have a page of its own? Public and raising money, and approved, or finished: TASK-502 keeps
 * a finished fundraiser's page at the same address for good, so the giving link on a poster or a
 * social media post still works. A finished one is no longer listed on Get involved (isListed).
 */
export function hasPage(f: Pick<FundraiserRecord, "status" | "public" | "path">): boolean {
  return (f.status === "approved" || f.status === "finished") && f.public && f.path === "raising";
}
