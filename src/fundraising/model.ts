import { z } from "zod";
import { ACCESS, isSafeImageSrc, isWebAddress } from "../events/model";
import { isValidUkPostcode } from "../declarations/fields";
import { containsBlockedWord } from "../donors/display-name-filter";
import type { NewsEntry } from "./news";
import { facebookLink, instagramLink, type SocialResult } from "./social";
import { categoryLabel, isActiveCategory, isKnownCategory, isMemoryCategory, OTHER_KIND } from "./categories";
import { CHARITY_NAME, OSCR_NUMBER } from "../legal/registration";
import {
  checkPaths,
  checkWelcomePack,
  organisedByFor,
  pathFields,
  pathsOf,
  welcomePackFields,
  welcomePackOf,
  ADDRESS_LINE1_MISSING,
  ADDRESS_POSTCODE_MISSING,
  ADDRESS_TOWN_MISSING,
  ATTEND_WHEN_SOMETHING_ON,
  DATE_OR_TBC_MISSING,
  MEMORY_GIVING_MISSING,
  type EmployerMatch,
} from "./signup-tidy";
import { checkMemory, isInMemory, memoryDay, memoryFields, memoryMeter, memoryOf, publicMemory, titleFor, titleOptional, type MemorySetupBy, type PublicMemory } from "./in-memory";

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

/**
 * A fundraising category's key (src/fundraising/categories.ts). The list is in the database, so any
 * string: the sign up form takes only the ones on offer (isActiveCategory), and categoryLabel(key)
 * names any of them, old ones included.
 */
export type FundraiserKind = string;

export const STATUSES = ["new", "approved", "declined", "finished"] as const;
export type FundraiserStatus = (typeof STATUSES)[number];

export const TARGET_MIN_PENCE = 1000; // £10
export const TARGET_MAX_PENCE = 10_000_000; // £100,000
export const DESCRIPTION_MAX = 1000;
export const MESSAGE_MAX = 200;
export const GIFT_MIN_PENCE = 200; // £2, as the design asks
export const MAX_LEAFLETS = 1000;
export const MAX_BUCKETS = 20;
/** TASK-511: printed QR codes, cards or stickers with their page's QR code. */
export const MAX_QR_CODES = 200;
/** The sign up tidy: collection envelopes for a funeral or service, in memory of someone. */
export const MAX_ENVELOPES = 500;
/** TASK-511: the first name and the surname, each. */
export const NAME_PART_MAX = 50;
/** TASK-511: what "Other" (once "Something else") is, in their words. */
export const KIND_OTHER_MAX = 80;
/** The line for the front of an event's card: one or two sentences, as the events editor asks. */
export const CARD_LINE_MAX = 140;

// Addresses under /fundraise/ that are pages of their own, so no fundraiser may take them: the manage
// page (TASK-494), the help page (TASK-498), and the logo pack and blank sponsor form (TASK-504).
// The sign up tidy: "t-shirt" is the page to choose a t-shirt size.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["manage", "help", "logos", "sponsor-form", "t-shirt"]);

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
  /** TASK-511: printed QR codes, cards or stickers with their page's QR code. None before then. */
  qrCount?: number;
  /** The sign up tidy: collection envelopes for a funeral or service, in memory of someone only. */
  envelopeCount?: number;
  shoutOut: boolean;
  attend: boolean;
}

/** Is anything to be posted? Then we need an address. Old combined requests count too. */
export function wantsPosted(w: Wants): boolean {
  return w.posterCount + w.leafletCount + w.bucketCount + w.tinCount + w.leaflets + w.buckets + (w.qrCount ?? 0) + (w.envelopeCount ?? 0) > 0;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Each thing to be posted, in words: "50 leaflets", and an old combined one as it was asked for. */
export function wantsLines(w: Wants): string[] {
  const lines: string[] = [];
  if (w.posterCount > 0) lines.push(count(w.posterCount, "poster", "posters"));
  if (w.leafletCount > 0) lines.push(count(w.leafletCount, "leaflet", "leaflets"));
  if (w.bucketCount > 0) lines.push(count(w.bucketCount, "collection bucket", "collection buckets"));
  if (w.tinCount > 0) lines.push(count(w.tinCount, "collection tin", "collection tins"));
  if ((w.qrCount ?? 0) > 0) lines.push(count(w.qrCount ?? 0, "printed QR code", "printed QR codes"));
  if ((w.envelopeCount ?? 0) > 0) lines.push(count(w.envelopeCount ?? 0, "collection envelope", "collection envelopes"));
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
export const BOOKINGS = ["away", "door", "free", "donations"] as const;
export type FundraiserBooking = (typeof BOOKINGS)[number];
export const BOOKING_LABELS: Record<FundraiserBooking, string> = {
  away: "Tickets are sold on another website",
  door: "Pay on the door, no booking needed",
  free: "Free, just come along",
  // The sign up tidy (the appropriateness audit).
  donations: "Free entry, donations welcome",
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

const wantsCounts = {
  posterCount: howMany(MAX_LEAFLETS, "We can send up to 1,000 posters."),
  leafletCount: howMany(MAX_LEAFLETS, "We can send up to 1,000 leaflets."),
  bucketCount: howMany(MAX_BUCKETS, `We can lend up to ${MAX_BUCKETS} buckets.`),
  tinCount: howMany(MAX_BUCKETS, `We can lend up to ${MAX_BUCKETS} tins.`),
  // Before TASK-499, one number each: still taken, so a sign up from then can be saved as it is.
  leaflets: howMany(MAX_LEAFLETS, `We can send up to ${MAX_LEAFLETS} leaflets.`),
  buckets: howMany(MAX_BUCKETS, `We can lend up to ${MAX_BUCKETS} buckets or tins.`),
  // TASK-511: printed QR codes, cards or stickers with their page's QR code.
  qrCount: howMany(MAX_QR_CODES, `We can print up to ${MAX_QR_CODES} QR codes.`),
  // The sign up tidy: collection envelopes for a funeral or service (in memory of someone).
  envelopeCount: howMany(MAX_ENVELOPES, `We can send up to ${MAX_ENVELOPES} envelopes.`),
};

// What staff save: a yes or no not given is No, as it always was. Printed QR codes not given are left
// as they are (patchFundraiser keeps the stored number), so an admin page opened before they were
// asked can never wipe them.
const wantsSchema = z
  .object({
    ...wantsCounts,
    qrCount: wantsCounts.qrCount.removeDefault().optional(),
    envelopeCount: wantsCounts.envelopeCount.removeDefault().optional(),
    shoutOut: z.boolean().default(false),
    attend: z.boolean().default(false),
  })
  .strict();

// TASK-511: a yes or no question on the sign up form. Nothing is chosen for them, so an answer not
// given is asked for (in the refinements below, so every missing answer is named at once), never
// taken as No.
const yesNo = z.preprocess((v) => (typeof v === "boolean" ? v : undefined), z.boolean().optional());

export const SHOUT_OUT_MISSING = "Tell us whether you would like a shout out from us.";
export const ATTEND_MISSING = "Tell us whether you would like someone from NBCC to come along.";
export const SOCIAL_OK_MISSING = "Tell us whether we can post about it on NBCC’s social media.";

// The sign up tidy: whether each is needed depends on the path (in memory asks neither, and come
// along only when there is something to come along to), so the sign up's own checks ask for them.
const signUpWantsSchema = z
  .object({
    ...wantsCounts,
    shoutOut: yesNo,
    attend: yesNo,
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
const signUpWants = z.preprocess((v) => (v == null ? {} : v), signUpWantsSchema);

// TASK-511: their Instagram or Facebook, a handle or a link, tidied to a full link (./social.ts).
const socialBox = (tidy: (raw: unknown) => SocialResult) =>
  z.unknown().transform((v, ctx) => {
    const r = tidy(v);
    if (!r.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.message });
      return z.NEVER;
    }
    return r.link;
  });

const firstNameText = requiredText(NAME_PART_MAX, "Please tell us your first name.");
const lastNameText = requiredText(NAME_PART_MAX, "Please tell us your surname.");

export const TITLE_MISSING = "Give it a name, like Sam's Santa Dash.";

/** TASK-511: the kind question's words follow their answer to the first question. */
export function kindMissing(path: FundraiserPath | undefined): string {
  return path === "event" ? "Choose what kind of event it is." : "Choose what you are doing to raise money.";
}
/** A category hidden (or an old one) since their page loaded. */
export const KIND_GONE = "That choice is no longer on the form. Please choose another.";
export function kindOtherMissing(path: FundraiserPath | undefined): string {
  return path === "event" ? "Tell us what kind of event it is, in a few words." : "Tell us what you are doing, in a few words.";
}

const optionalImage = z
  .preprocess(
    blankable,
    z.union([
      z.literal(""),
      z.string().refine(isSafeImageSrc, "Pictures have to be uploaded here, not linked from another website."),
    ]),
  )
  .transform((v) => (v === "" ? null : v));

// --- 18 or over, and sharing with another cause (Jaimie, 2026-10-03) ------------------------------
//
// Both asked on both paths, each a yes or no with nothing chosen for them. Someone under 18 cannot
// set up a page: a grown up sets it up for them. Sharing what is raised with another cause needs
// NBCC's whole percentage (1 to 99) and the other cause's name, for the statement the Charities and
// Benevolent Fundraising (Scotland) Regulations 2009 ask for (splitStatement, below). Organisers can
// never change the split (editSchema does not take it); staff correct it only while there are no
// gifts (src/db/fundraisers.ts setFundraiserSplit).

export const OVER_18_MISSING = "Tell us whether you are 18 or over.";
// The sign up tidy (Jaimie, 2026-10-03): the same words on every form, with no example to copy.
export const UNDER_18 =
  "You need to be 18 or over to sign up. A parent, carer or another adult you trust can do it for you and name you on the page. If you'd like to talk it through, call 01292 811 015 or email events@nbcc.scot.";
export const SHARES_MISSING = "Tell us whether you are sharing what you raise with another cause.";
export const SHARE_PERCENT_MISSING = "Tell us what percentage of what you raise comes to NBCC.";
export const SHARE_PERCENT_RANGE = "Give a whole number from 1 to 99.";
export const OTHER_CAUSE_MISSING = "Tell us the name of the other cause.";
export const OTHER_CAUSE_MAX = 120;

/** NBCC's share as sent: a whole number from 1 to 99 (digits typed in a box count), null if not given. */
function readPercent(v: unknown): number | null | "bad" {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 99 ? n : "bad";
}

type SplitIn = { sharesWithOther?: boolean; nbccSharePercent?: unknown; otherCauseName?: string };

function checkSplit(b: SplitIn, missing: (path: string, message: string) => void): void {
  if (b.sharesWithOther === undefined) missing("sharesWithOther", SHARES_MISSING);
  if (b.sharesWithOther !== true) return;
  const p = readPercent(b.nbccSharePercent);
  if (p === null) missing("nbccSharePercent", SHARE_PERCENT_MISSING);
  else if (p === "bad") missing("nbccSharePercent", SHARE_PERCENT_RANGE);
  if (!b.otherCauseName) missing("otherCauseName", OTHER_CAUSE_MISSING);
}

/** The split as stored: the percentage and the name only when sharing. */
function splitOf(b: SplitIn): { sharesWithOther: boolean; nbccSharePercent: number | null; otherCauseName: string | null } {
  const shares = b.sharesWithOther === true;
  const p = readPercent(b.nbccSharePercent);
  return {
    sharesWithOther: shares,
    nbccSharePercent: shares && typeof p === "number" ? p : null,
    otherCauseName: shares && b.otherCauseName ? b.otherCauseName : null,
  };
}

const splitFields = {
  sharesWithOther: yesNo,
  nbccSharePercent: z.unknown(),
  otherCauseName: optionalText(OTHER_CAUSE_MAX),
};

/** A staff correction of the split (PUT /api/admin/fundraisers/:id/split): the form's own rules. */
export const splitSchema = z
  .object(splitFields)
  .strict()
  .superRefine((b, ctx) => checkSplit(b, (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })))
  .transform(splitOf);

export type FundraiserSplit = z.infer<typeof splitSchema>;

/**
 * The statement the Charities and Benevolent Fundraising (Scotland) Regulations 2009 ask for when
 * what is raised is shared: NBCC's share, the charity's name and number, and who has the rest. Null
 * when it is not shared, or for a sign up from before it was asked.
 */
export function splitStatement(f: { sharesWithOther?: boolean | null; nbccSharePercent?: number | null; otherCauseName?: string | null }): string | null {
  if (f.sharesWithOther !== true || !f.nbccSharePercent || !f.otherCauseName) return null;
  const other = f.otherCauseName.trim();
  return `${f.nbccSharePercent}% of what we raise goes to the ${CHARITY_NAME}, Scottish Charity ${OSCR_NUMBER}. The rest goes to ${other}${/[.!?]$/.test(other) ? "" : "."}`;
}

// --- the sign up form (POST /api/fundraise) ---------------------------------------------------------

export const signUpSchema = z
  .object({
    path: z.enum(PATHS, { errorMap: () => ({ message: "Tell us whether you are raising money or holding an event." }) }),
    // TASK-511: checked below, so the message can follow what they chose first.
    // Only a category on offer now (the list as last read from the database), checked below: one
    // no longer on the form (hidden, or an old one) is asked for again, saying so.
    kind: z.unknown(),
    kindOther: nullableText(KIND_OTHER_MAX),
    // In memory (Jaimie, 2026-10-03): may be left empty, and is named for them. Checked below.
    title: optionalText(100),
    // The sign up tidy: optional in memory of someone (staff write it with the family); asked below.
    description: optionalText(DESCRIPTION_MAX),
    eventDate: optionalDate,
    startTime: optionalTime,
    venue: optionalText(120),
    town: optionalText(80),
    targetPence: optionalTarget.optional().transform((v) => v ?? null),
    public: z.boolean({ errorMap: () => ({ message: "Tell us whether to show it on the NBCC website." }) }),
    // TASK-511: the name in two boxes; the whole name (name) is made from them below.
    firstName: firstNameText,
    lastName: lastNameText,
    email,
    phone,
    // TASK-511: Instagram and Facebook in boxes of their own. The old single link is no longer asked
    // for; it is filled from these below, for anything that still reads it.
    instagram: socialBox(instagramLink),
    facebook: socialBox(facebookLink),
    socialOk: yesNo,
    // Jaimie, 2026-10-03: both paths. Checked below, so every missing answer is named at once.
    over18: yesNo,
    ...splitFields,
    wants: signUpWants,
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
    // In memory of someone (Jaimie, 2026-10-03): src/fundraising/in-memory.ts.
    ...memoryFields,
    // The sign up tidy (Jaimie, 2026-10-03): sport, the t-shirt and the split check (./welcome-pack.ts).
    ...welcomePackFields,
    // Who is fundraising, and for whom; and whether to list it on Get involved (./signup-tidy.ts).
    ...pathFields,
  })
  .superRefine((b, ctx) => {
    const missing = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!b.title && !titleOptional(b)) missing("title", TITLE_MISSING);
    checkMemory(b, missing);
    // The sign up tidy: in memory of someone is its own path, asked only what fits it.
    const memory = b.path === "raising" && b.inMemory === true;
    if (!memory && !b.description) missing("description", "Tell us a little about it.");
    if (memory) {
      if (!isActiveCategory(b.kind) || !(isMemoryCategory(b.kind) || b.kind === OTHER_KIND)) missing("kind", MEMORY_GIVING_MISSING);
    } else if (!isActiveCategory(b.kind) || isMemoryCategory(b.kind)) {
      missing("kind", isKnownCategory(b.kind) && !isMemoryCategory(b.kind) ? KIND_GONE : kindMissing(b.path));
    }
    if (!memory) {
      if (b.wants.shoutOut === undefined) missing("wants.shoutOut", SHOUT_OUT_MISSING);
      // Come along: for an event, and for anything else with a day or a place to come along to.
      if (b.wants.attend === undefined && (b.path === "event" || b.eventDate || b.venue)) {
        missing("wants.attend", b.path === "event" ? ATTEND_MISSING : ATTEND_WHEN_SOMETHING_ON);
      }
    }
    checkPaths(b, missing);
    if (b.kind === OTHER_KIND && !b.kindOther) missing("kindOther", kindOtherMissing(b.path));
    if (b.socialOk === undefined) missing("socialOk", SOCIAL_OK_MISSING);
    if (b.over18 === undefined) missing("over18", OVER_18_MISSING);
    else if (b.over18 !== true) missing("over18", UNDER_18);
    checkSplit(b, missing);
    if (b.path === "event") {
      // Jaimie, 2026-10-03: "Not decided yet" makes the date optional.
      if (!b.eventDate && b.dateTbc !== true) missing("eventDate", DATE_OR_TBC_MISSING);
      if (!b.cardLine) missing("cardLine", "Add a line for the front of the card.");
      if (!b.venue) missing("venue", "Tell us the venue.");
      if (!b.booking) missing("booking", "Tell us how people get in.");
      if (b.booking === "away" && !b.ticketUrl) missing("ticketUrl", "Paste the link to where the tickets are sold, starting https://");
      finishAfterStart(b, ctx);
    }
    // The sign up tidy: every new sign up gives an address for the welcome pack. In memory of
    // someone there is no welcome pack, so only something to be posted needs one, as before.
    // Event pages have a QR code now, so an event may ask for printed ones too.
    if (!memory || wantsPosted({ ...b.wants, shoutOut: false, attend: false })) {
      if (!b.postLine1) missing("postLine1", ADDRESS_LINE1_MISSING);
      if (!b.postTown) missing("postTown", ADDRESS_TOWN_MISSING);
      if (!b.postPostcode) missing("postPostcode", ADDRESS_POSTCODE_MISSING);
    }
    checkWelcomePack(b, missing);
  })
  .transform((b) => {
    // Holding an event is listed as an event: it has no page and no meter in stage 1, so no target.
    // Raising money gets a page, never an event card, so none of the event answers are kept.
    const event = b.path === "event";
    const memory = b.path === "raising" && b.inMemory === true;
    // The sign up tidy: in memory asks for no shout out and no come along; envelopes only in memory.
    const wanted = {
      ...b.wants,
      envelopeCount: memory ? b.wants.envelopeCount : 0,
      shoutOut: !memory && b.wants.shoutOut === true,
      attend: !memory && b.wants.attend === true,
    };
    // The welcome pack's address is always kept; in memory, only when something is to be posted.
    const posted = wantsPosted(wanted) || !memory;
    // "Shall we list it on our Get involved page?": every new sign up gets a page (public), and a No
    // keeps it off the list. A page cached from before sends only public, read as it always was. A
    // team is always listed, so the team can find it.
    const listed = b.team === "team" || b.listed !== false;
    const only = <T>(keep: boolean, value: T) => (keep ? value : null);
    return {
      ...b,
      // Checked above: a sign up without a kind never gets this far.
      kind: b.kind as FundraiserKind,
      // In memory: named for them when they give it no name (src/fundraising/in-memory.ts).
      title: titleFor(b),
      ...memoryOf(b),
      ...welcomePackOf(b),
      ...pathsOf(b),
      // Not decided yet: only while there is no date.
      dateTbc: b.dateTbc === true && !b.eventDate,
      public: b.listed === undefined ? b.public : true,
      listed,
      // In memory: no newsletter tick is offered.
      newsletterOk: !memory && b.newsletterOk,
      kindOther: only(b.kind === OTHER_KIND, b.kindOther),
      // TASK-511: the whole name, for everything that reads it (emails, the admin, the page).
      name: `${b.firstName} ${b.lastName}`,
      socialOk: b.socialOk === true,
      // Checked above: only a Yes gets this far.
      over18: true as const,
      ...splitOf(b),
      // The old single link, filled for anything that still reads it: Facebook first.
      socialLink: b.facebook ?? b.instagram,
      wants: wanted,
      // The sign up tidy: an event may give an amount it hopes to raise (its page has a meter).
      targetPence: b.targetPence,
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
  // TASK-511 review: a sign up made since asks for these instead of the one link; still approved by staff.
  "instagram",
  "facebook",
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
    instagram: socialBox(instagramLink).optional(),
    facebook: socialBox(facebookLink).optional(),
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
    // Any category on offer. A sign up keeps an old one until staff change it, as this only checks a
    // change (the form sends only what changed).
    kind: z.string().refine(isActiveCategory, "Choose one of the categories on the list."),
    title: requiredText(100, "Give it a name."),
    description: optionalText(DESCRIPTION_MAX),
    eventDate: optionalDate,
    startTime: optionalTime,
    venue: optionalText(120),
    town: optionalText(80),
    targetPence: optionalTarget,
    public: z.boolean(),
    name: requiredText(100, "The organiser needs a name."),
    // TASK-511: a sign up made since has its name in two parts; changing either changes the whole
    // name with it (organiserNameFor). One from before keeps its single name.
    firstName: firstNameText,
    lastName: lastNameText,
    kindOther: nullableText(KIND_OTHER_MAX),
    email,
    phone,
    socialLink: optionalWebLink,
    instagram: socialBox(instagramLink),
    facebook: socialBox(facebookLink),
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

type LinkParts = { instagram?: string | null; facebook?: string | null; socialLink: string | null; firstName?: string | null };

/**
 * TASK-511 review: the old single link (social_link) a change leaves, when it changes Instagram or
 * Facebook: Facebook first, then Instagram. A sign up from before (no name parts, no links of its
 * own) keeps its one link when both are left empty. Undefined when neither link changes.
 */
export function socialLinkFor(before: LinkParts, change: { instagram?: string | null; facebook?: string | null }): string | null | undefined {
  if (change.instagram === undefined && change.facebook === undefined) return undefined;
  const facebook = change.facebook !== undefined ? change.facebook : before.facebook ?? null;
  const instagram = change.instagram !== undefined ? change.instagram : before.instagram ?? null;
  const roundTwo = Boolean(before.firstName || before.instagram || before.facebook);
  return facebook ?? instagram ?? (roundTwo ? null : before.socialLink);
}

type NameParts = { firstName?: string | null; lastName?: string | null; name: string };

/**
 * TASK-511: the whole name ("first last") a staff change leaves, when it changes the first name or the
 * surname of a sign up that has both; undefined when the whole name stays as it is. A sign up from
 * before the split has no parts, and keeps its single name.
 */
export function organiserNameFor(before: NameParts, patch: { firstName?: string | null; lastName?: string | null }): string | undefined {
  if (patch.firstName === undefined && patch.lastName === undefined) return undefined;
  const first = (patch.firstName ?? before.firstName ?? "").trim();
  const last = (patch.lastName ?? before.lastName ?? "").trim();
  return first && last ? `${first} ${last}` : undefined;
}

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
  /** In memory: its message is still waiting for staff to check it, so it does not show yet. */
  held?: boolean;
  /** In memory: the giver ticked "Let the family know I gave". */
  familyNotify?: boolean;
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
        // In memory: a message waiting for staff (held) does not show until they approve it.
        message: !r.hidden && !r.held && r.message && r.message.trim() !== "" ? r.message.trim() : null,
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
  // In memory: "Let the family know I gave", unticked unless they tick it (left out, it is No).
  familyNotify: z.boolean().optional(),
});

export type WallMessage = z.infer<typeof wallMessageSchema>;

// --- the record, and what the public sees of it --------------------------------------------------

export interface FundraiserRecord {
  id: number;
  slug: string;
  path: FundraiserPath;
  kind: FundraiserKind;
  /** The category's name, as the database had it when the row was read (src/db/fundraisers.ts). */
  kindLabel?: string | null;
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
  // TASK-511: the sign up form, round two. A sign up from before has them all null: one name (name),
  // and its one social link (socialLink).
  firstName?: string | null;
  lastName?: string | null;
  /** What "Other" is, in their words. */
  kindOther?: string | null;
  /** Their Instagram and Facebook, each a full https link. */
  instagram?: string | null;
  facebook?: string | null;
  // Jaimie, 2026-10-03. All null on a sign up from before they were asked.
  /** They said they are 18 or over (every sign up since must). */
  over18?: boolean | null;
  /** Sharing what is raised with another cause, NBCC's whole percentage, and the other cause. */
  sharesWithOther?: boolean | null;
  nbccSharePercent?: number | null;
  otherCauseName?: string | null;
  /**
   * Event pages: when staff last set its short name (the slug) in the admin. An event cannot be
   * approved until they have (approveProblem): its short name is its web address, /event/<slug>.
   * Null on a sign up staff have not looked at yet, and on a raising one, which never needs it.
   */
  slugSetAt?: string | null;
  // Team pages (Jaimie, 2026-10-03; src/fundraising/teams.ts). False or null on everything else.
  /** A team page: its organiser is the team organiser. */
  isTeam?: boolean;
  /** A member page of this team. */
  teamId?: number | null;
  /** A team sharing with another cause: the whole team's split, or just the organiser's. */
  teamShareMode?: "team" | "organiser" | null;
  // The sign up tidy (Jaimie, 2026-10-03; ./signup-tidy.ts). Null on a sign up from before, and
  // wherever the path does not ask it.
  /** A sporting event? Asked of someone raising money, never in memory of someone. */
  isSporting?: boolean | null;
  /** Their t-shirt size (TSHIRT_SIZES), for a sporting event. */
  tshirtSize?: string | null;
  /** When staff last emailed them the link to choose a size, and who. */
  tshirtAskedAt?: string | null;
  tshirtAskedBy?: string | null;
  /** Raising money for their child: the child's first name (on the page), and the parent's tick. */
  childFirstName?: string | null;
  childConsent?: boolean | null;
  /** For a business, school or group: its name (on the page), and whether the employer will match. */
  orgName?: string | null;
  employerMatch?: EmployerMatch | null;
  /** In memory, set up by a funeral director: the business, and the family's contact for givers' names. */
  memoryDirectorBusiness?: string | null;
  memoryFamilyContactName?: string | null;
  memoryFamilyContactEmail?: string | null;
  /** A good time to call them. */
  callTime?: string | null;
  /** They ticked "Not decided yet" beside the date: the date is to be confirmed. */
  dateTbc?: boolean;
  /** A member page for someone under 18: their parent's or guardian's first name, to greet in emails. */
  guardianFirstName?: string | null;
  /** A member taken off the team: the page carries on as their own. */
  teamLeftAt?: string | null;
  /** When the two "did you send the invite to your team?" emails went. */
  teamNudge1At?: string | null;
  teamNudge2At?: string | null;
  // In memory of someone (Jaimie, 2026-10-03; src/fundraising/in-memory.ts). False or null on
  // every other sign up, and on one from before it was asked.
  inMemory?: boolean | null;
  memoryName?: string | null;
  memoryDates?: string | null;
  memorySetupBy?: MemorySetupBy | null;
  memoryPermission?: boolean | null;
  /** The family's answer to showing the target and how close it is; null with no target. */
  memoryShowTarget?: boolean | null;
  /** A year on, staff are reminded to decide whether to get in touch: when someone dealt with it. */
  memoryReminderDoneAt?: string | null;
  memoryReminderDoneBy?: string | null;
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
  /** Its own page: /fundraise/<slug>, or /event/<short name> for an event (pagePath). */
  url: string | null;
  meter: Meter;
  /**
   * Jaimie, 2026-10-03: shared with another cause, with the statement the 2009 regulations ask for;
   * null when it is not shared (or a sign up from before it was asked). On every card (an event has no
   * page, so its card is where the public sees it) and on the page.
   */
  split?: PublicSplit | null;
  /** In memory of someone: who, the dates, and whether the target shows. Null on any other page. */
  memory?: PublicMemory | null;
}

export interface PublicPage extends PublicCard {
  wall: WallEntry[];
  giving: { fundraiserId: number; minimumPence: number };
  /** TASK-502: finished, so the page says so and still takes gifts under "You can still give". */
  finished?: boolean;
  /** TASK-506: the news updates staff approved, newest first (src/fundraising/news.ts publicNews). */
  news?: NewsEntry[];
  /** Team pages: a team page's own name, so the page speaks of the team, not its organiser. */
  teamName?: string | null;
}

export interface PublicSplit {
  nbccSharePercent: number;
  otherCauseName: string;
  statement: string;
}

/** The split as the public sees it, or null. */
export function publicSplit(f: Pick<FundraiserRecord, "sharesWithOther" | "nbccSharePercent" | "otherCauseName">): PublicSplit | null {
  const statement = splitStatement(f);
  return statement ? { nbccSharePercent: f.nbccSharePercent as number, otherCauseName: (f.otherCauseName as string).trim(), statement } : null;
}

/** A sign up's category, by name: as read with the row, else as the list has it (old ones included). */
export function kindLabelOf(f: Pick<FundraiserRecord, "kind" | "kindLabel">): string {
  return f.kindLabel || categoryLabel(f.kind);
}

/** Built field by field, so nothing private (email, phone, address, notes) can reach the public. */
export function publicCard(f: FundraiserRecord, m: Meter): PublicCard {
  return {
    id: f.id,
    slug: f.slug,
    path: f.path,
    kind: f.kind,
    kindLabel: kindLabelOf(f),
    title: f.title,
    description: f.description,
    eventDate: f.eventDate,
    startTime: f.startTime,
    venue: f.venue,
    town: f.town,
    imageSrc: f.imageSrc,
    // An event may be credited to the name they gave (their group or business); a page never is.
    // The sign up tidy: a funeral director for the family, a child, or a business, school or group.
    organisedBy: organisedByFor(f) ?? shortName(f.name),
    url: pagePath(f),
    // In memory: the target and how close it is only if the family chose to show them.
    meter: memoryMeter(f, m),
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
    split: publicSplit(f),
    memory: publicMemory(f),
  };
}

export function publicPage(f: FundraiserRecord, m: Meter, wall: WallEntry[]): PublicPage {
  return {
    ...publicCard(f, m),
    // In memory (review fix): each gift dated by its day only, so a gift cannot be matched by its time.
    wall: isInMemory(f) ? wall.map((w) => ({ ...w, createdAt: memoryDay(w.createdAt) })) : wall,
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
 * Does it have a page of its own? Public, and approved, or finished: TASK-502 keeps a finished
 * fundraiser's page at the same address for good, so the giving link on a poster or a social media
 * post still works. A finished one is no longer listed on Get involved (isListed).
 * Event pages: an event has one too now, at /event/<short name> (pagePath), as well as its card.
 */
export function hasPage(f: Pick<FundraiserRecord, "status" | "public" | "path">): boolean {
  return (f.status === "approved" || f.status === "finished") && f.public && (f.path === "raising" || f.path === "event");
}

// --- event pages ---------------------------------------------------------------------------------

/** Where an event's page lives: nbcc.scot/event/<short name>. */
export const EVENT_PAGE_PREFIX = "/event";

/**
 * The page's path on the site: /event/<short name> for an event, /fundraise/<slug> for raising
 * money. Both are the one stored slug, unique across the two kinds, so the two can never clash; each
 * address answers only for its own kind (src/routes/fundraise-pages.ts sends the other on).
 */
export function pagePath(f: Pick<FundraiserRecord, "path" | "slug">): string {
  return f.path === "event" ? `${EVENT_PAGE_PREFIX}/${f.slug}` : `/fundraise/${f.slug}`;
}

export const EVENT_SHORT_NAME_NEEDED = "Give this event a short name first, for its web address.";

/**
 * Why it cannot be approved yet, or null. Event pages: an event needs a short name set by staff
 * first, as that is its web address for good (posters and QR codes carry it). A sign up raising money
 * keeps its suggested address as before.
 */
export function approveProblem(f: Pick<FundraiserRecord, "path" | "slugSetAt">): string | null {
  return f.path === "event" && !f.slugSetAt ? EVENT_SHORT_NAME_NEEDED : null;
}
