import { z } from "zod";
import { isSafeImageSrc, isWebAddress } from "../events/model";

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

// Addresses under /fundraise/ that are pages of their own, so no fundraiser may take them.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["manage"]);

export interface Wants {
  leaflets: number;
  buckets: number;
  shoutOut: boolean;
  attend: boolean;
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

const wantsSchema = z
  .object({
    leaflets: z.number().int().min(0).max(MAX_LEAFLETS, `We can send up to ${MAX_LEAFLETS} leaflets.`).default(0),
    buckets: z.number().int().min(0).max(MAX_BUCKETS, `We can lend up to ${MAX_BUCKETS} buckets or tins.`).default(0),
    shoutOut: z.boolean().default(false),
    attend: z.boolean().default(false),
  })
  .strict();

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
    postAddress: nullableText(500),
    newsletterOk: z.boolean().default(false),
  })
  .superRefine((b, ctx) => {
    if (b.path === "event" && !b.eventDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eventDate"], message: "Tell us the date of your event." });
    }
    if ((b.wants.leaflets > 0 || b.wants.buckets > 0) && !b.postAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postAddress"],
        message: "Tell us where to send your leaflets or bucket.",
      });
    }
  })
  // Holding an event is listed as an event: it has no page and no meter in stage 1, so no target.
  .transform((b) => (b.path === "event" ? { ...b, targetPence: null } : b));

export type SignUp = z.infer<typeof signUpSchema>;

// --- an organiser's change (POST /api/fundraise/manage/:token) ------------------------------------

export const EDITABLE_FIELDS = ["description", "targetPence", "eventDate", "startTime", "venue", "town", "socialLink"] as const;
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
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "There is nothing to change." });

export type FundraiserEdit = z.infer<typeof editSchema>;

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
    postAddress: nullableText(500),
    newsletterOk: z.boolean(),
    imageSrc: optionalImage,
    slug: z.string().refine(isValidSlug, "Use lower case letters and numbers, joined by single hyphens."),
  })
  .partial()
  .strict()
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

export interface Meter {
  raisedPence: number;
  onlinePence: number;
  cashPence: number;
  targetPence: number | null;
  /** Whole percent of the target, rounded down; can pass 100. Null when there is no target. */
  percent: number | null;
  /** The same, held to 100 for drawing the bar. Null when there is no target. */
  barPercent: number | null;
  overTarget: boolean;
}

export function meter(input: { onlinePence: number; cashPence: number; targetPence: number | null }): Meter {
  const onlinePence = Math.max(0, input.onlinePence);
  const cashPence = Math.max(0, input.cashPence);
  const raisedPence = onlinePence + cashPence;
  const target = input.targetPence && input.targetPence > 0 ? input.targetPence : null;
  const percent = target ? Math.floor((raisedPence * 100) / target) : null;
  return {
    raisedPence,
    onlinePence,
    cashPence,
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
}

export interface WallEntry {
  name: string;
  amountPence: number | null;
  message: string | null;
  createdAt: string;
}

/** The public wall: newest first; hidden messages and gifts refunded in full never show. */
export function wallEntries(rows: WallSourceRow[]): WallEntry[] {
  return rows
    .filter((r) => !r.hidden && giftNetPence(r.amountPence, r.refundedPence) > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.donationId - a.donationId))
    .map((r) => ({
      name: r.showName && !r.anonymous ? shortName(r.fullName) : "Anonymous",
      amountPence: r.showAmount ? giftNetPence(r.amountPence, r.refundedPence) : null,
      message: r.message && r.message.trim() !== "" ? r.message.trim() : null,
      createdAt: r.createdAt,
    }));
}

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
  postAddress: string | null;
  newsletterOk: boolean;
  imageSrc: string | null;
  declinedReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PublicCard {
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
    organisedBy: shortName(f.name),
    url: f.path === "raising" ? `/fundraise/${f.slug}` : null,
    meter: m,
  };
}

export function publicPage(f: FundraiserRecord, m: Meter, wall: WallEntry[]): PublicPage {
  return { ...publicCard(f, m), wall, giving: { fundraiserId: f.id, minimumPence: GIFT_MIN_PENCE } };
}

/** Is it on the public side at all? Approved and public; an event drops off after its day. */
export function isListed(f: Pick<FundraiserRecord, "status" | "public" | "path" | "eventDate">, today: string): boolean {
  if (f.status !== "approved" || !f.public) return false;
  if (f.path === "event" && f.eventDate !== null && f.eventDate < today) return false;
  return true;
}

/** Does it have a page of its own? Approved, public and raising money. */
export function hasPage(f: Pick<FundraiserRecord, "status" | "public" | "path">): boolean {
  return f.status === "approved" && f.public && f.path === "raising";
}
