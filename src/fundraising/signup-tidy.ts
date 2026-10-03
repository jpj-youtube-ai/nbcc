import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

// The sign up tidy (Jaimie, 2026-10-03): what the welcome pack needs, and the split check.
//
//   - An address for the welcome pack, on every new sign up (the four boxes the form already had for
//     posting materials, now always asked). In memory of someone, the welcome pack is not offered:
//     the address is asked only when something is to be posted, as before.
//   - Someone raising money says whether it is a sporting event. A Yes asks their T-shirt size, from
//     the list below, for their NBCC T-shirt. Never asked for an event, or in memory of someone.
//     A sign up from a page cached before this (no answer at all) is taken without one.
//   - Someone sharing with another cause ticks "Yes, that's right" to the split as it will be shown.
//
// Pure: no pool, no clock. Wired into signUpSchema in ./model.ts; stored by src/db/fundraisers.ts
// (is_sporting, tshirt_size: migrations/1791200000210_signup-tidy.js).

export interface TshirtSize {
  key: string;
  label: string;
}

/** The T-shirt sizes, kids' then adults', smallest first. The keys are what is stored. */
export const TSHIRT_SIZES: readonly TshirtSize[] = [
  { key: "kids_3_4", label: "Kids 3 to 4" },
  { key: "kids_5_6", label: "Kids 5 to 6" },
  { key: "kids_7_8", label: "Kids 7 to 8" },
  { key: "kids_9_10", label: "Kids 9 to 10" },
  { key: "kids_11_12", label: "Kids 11 to 12" },
  { key: "kids_13_14", label: "Kids 13 to 14" },
  { key: "adult_xs", label: "Adult XS" },
  { key: "adult_s", label: "Adult S" },
  { key: "adult_m", label: "Adult M" },
  { key: "adult_l", label: "Adult L" },
  { key: "adult_xl", label: "Adult XL" },
  { key: "adult_xxl", label: "Adult XXL" },
];

const SIZE_KEYS: ReadonlySet<string> = new Set(TSHIRT_SIZES.map((s) => s.key));

export function isTshirtSize(v: unknown): v is string {
  return typeof v === "string" && SIZE_KEYS.has(v);
}

/** "Kids 9 to 10" for kids_9_10; empty for none, or one not on the list. */
export function tshirtLabel(key: string | null | undefined): string {
  return TSHIRT_SIZES.find((s) => s.key === key)?.label ?? "";
}

export const SPORTING_MISSING = "Please tell us whether it is a sporting event.";
export const TSHIRT_MISSING = "Please choose a T-shirt size.";
export const TSHIRT_UNKNOWN = "Please choose one of the sizes on the list.";
export const SPLIT_CONFIRM_MISSING = "Please tick to say the split is right.";
export const ADDRESS_LINE1_MISSING = "Please add the first line of your address, so we can post your welcome pack.";
export const ADDRESS_TOWN_MISSING = "Please add your town.";
export const ADDRESS_POSTCODE_MISSING = "Please add your postcode.";

const yesNo = z.preprocess((v) => (typeof v === "boolean" ? v : undefined), z.boolean().optional());

/** The sign up's new answers, spread into signUpSchema's object. */
export const welcomePackFields = {
  isSporting: yesNo,
  tshirtSize: z.unknown(),
  splitConfirmed: z.unknown(),
};

export interface WelcomePackIn {
  path?: string;
  inMemory?: boolean;
  isSporting?: boolean;
  tshirtSize?: unknown;
  sharesWithOther?: boolean;
  splitConfirmed?: unknown;
}

/** Sport and the T-shirt are asked only of someone raising money, and never in memory of someone. */
export function sportAsked(b: WelcomePackIn): boolean {
  return b.path === "raising" && b.inMemory !== true;
}

/** The checks, each missing answer named by its field. */
export function checkWelcomePack(b: WelcomePackIn, missing: (path: string, message: string) => void): void {
  if (sportAsked(b) && b.isSporting === true) {
    if (b.tshirtSize == null || b.tshirtSize === "") missing("tshirtSize", TSHIRT_MISSING);
    else if (!isTshirtSize(b.tshirtSize)) missing("tshirtSize", TSHIRT_UNKNOWN);
  }
  if (b.sharesWithOther === true && b.splitConfirmed !== true) missing("splitConfirmed", SPLIT_CONFIRM_MISSING);
}

/** What is stored: null where it was not asked (or not answered, from an old page). */
export function welcomePackOf(b: WelcomePackIn): { isSporting: boolean | null; tshirtSize: string | null; splitConfirmed: boolean } {
  const asked = sportAsked(b) && typeof b.isSporting === "boolean";
  const sporting = asked ? (b.isSporting as boolean) : null;
  return {
    isSporting: sporting,
    tshirtSize: sporting === true && isTshirtSize(b.tshirtSize) ? b.tshirtSize : null,
    splitConfirmed: b.sharesWithOther === true && b.splitConfirmed === true,
  };
}

/**
 * Staff correcting "Sporting event?" and the T-shirt size before approving (PUT
 * /api/admin/fundraisers/:id/welcome-pack). A Yes may wait for a size (they are then asked for it); a
 * No keeps none.
 */
export const welcomePackSchema = z
  .object({
    isSporting: z.boolean({ required_error: "Choose Yes or No.", invalid_type_error: "Choose Yes or No." }),
    tshirtSize: z
      .preprocess((v) => (v === "" || v === undefined ? null : v), z.string().refine(isTshirtSize, TSHIRT_UNKNOWN).nullable()),
  })
  .strict()
  .transform((b) => ({ isSporting: b.isSporting, tshirtSize: b.isSporting ? b.tshirtSize : null }));

export type WelcomePackChange = z.infer<typeof welcomePackSchema>;

// --- the private link to choose a size ------------------------------------------------------------

/** How long a link to choose a T-shirt size works for. */
export const TSHIRT_LINK_DAYS = 60;
const TSHIRT_TOKEN_DOMAIN = "fundraisetshirt.v1:";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newTshirtToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this is kept: the sha256, with its own prefix, so no other link's token can open it. */
export function hashTshirtToken(token: string): string {
  return createHash("sha256").update(TSHIRT_TOKEN_DOMAIN + token).digest("hex");
}

export function readTshirtToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return TOKEN_SHAPE.test(t) ? t : null;
}

export function tshirtUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/fundraise/t-shirt#${encodeURIComponent(token)}`;
}

/** Sent, and not more than 60 days ago. */
export function tshirtLinkLive(askedAt: string | null, now: Date): boolean {
  if (!askedAt) return false;
  const at = new Date(askedAt).getTime();
  return Number.isFinite(at) && now.getTime() - at <= TSHIRT_LINK_DAYS * 24 * 60 * 60 * 1000;
}

/** An organiser choosing their size from the link staff sent them. */
export const tshirtChoiceSchema = z
  .object({ token: z.string(), tshirtSize: z.unknown() })
  .strict()
  .superRefine((b, ctx) => {
    if (b.tshirtSize == null || b.tshirtSize === "") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tshirtSize"], message: TSHIRT_MISSING });
    else if (!isTshirtSize(b.tshirtSize)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tshirtSize"], message: TSHIRT_UNKNOWN });
  })
  .transform((b) => ({ token: b.token, tshirtSize: b.tshirtSize as string }));

// --- who is fundraising, and for whom (Jaimie and the appropriateness audit, 2026-10-03) -----------
//
//   - Someone raising money for their child, or a young person they look after: the child's first
//     name (shown on the page) and the parent's or guardian's tick to show it and any photo.
//   - A business, school or group: its name, shown on the page ("Organised by ..."), and whether
//     the employer will match what is raised (yes, no or not sure). Not in memory of someone.
//   - In memory of someone: a funeral director gives the business name ("Set up by ... for the
//     family"), and may give the family's contact, for the names of people who gave. Anyone may give
//     a good time to call.
//   - "Shall we list it on our Get involved page?": No still gets a page, kept off the list.

export const CHILD_NAME_MAX = 50;
export const ORG_NAME_MAX = 100;
export const CALL_TIME_MAX = 80;
export const EMPLOYER_MATCH = ["yes", "no", "not_sure"] as const;
export type EmployerMatch = (typeof EMPLOYER_MATCH)[number];
export const EMPLOYER_MATCH_LABELS: Record<EmployerMatch, string> = { yes: "Yes", no: "No", not_sure: "Not sure yet" };

export const CHILD_NAME_MISSING = "Please add their first name.";
export const CHILD_CONSENT_MISSING = "Please tick to say you are their parent or guardian, and happy for their first name to be shown.";
export const ORG_NAME_MISSING = "Please add the name of the business, school or group.";
export const EMPLOYER_MATCH_UNKNOWN = "Please choose Yes, No or Not sure yet.";
export const MEMORY_BUSINESS_MISSING = "Please add the name of the funeral director's business.";
export const MEMORY_GIVING_MISSING = "Please choose how people will be giving.";
export const FAMILY_EMAIL_BAD = "Please check this email address.";
/** The come along question, asked only when there is somewhere or a day to come along to. */
export const ATTEND_WHEN_SOMETHING_ON = "Tell us whether you would like someone from NBCC to come along.";

const tidy = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Jaimie, 2026-10-03: "Not decided yet" beside the date makes it optional, on an event too. */
export const DATE_OR_TBC_MISSING = "Please add the date, or tick Not decided yet.";
/** The join form, for someone under 18: their parent's or guardian's first name, and their tick. */
export const GUARDIAN_NAME_MISSING = "Please add your first name, as their parent or guardian.";
export const GUARDIAN_CONSENT_MISSING = "Please tick to say you are their parent or guardian, and happy for their first name to be shown.";
export const GUARDIAN_NAME_MAX = 50;

/** The join form's answers about someone under 18. A page cached from before sends none: an adult. */
export function checkGuardian(
  b: { memberUnder18?: unknown; guardianFirstName?: unknown; guardianConsent?: unknown },
  missing: (path: string, message: string) => void,
): { guardianFirstName: string | null; guardianConsent: boolean | null } {
  if (b.memberUnder18 !== true) return { guardianFirstName: null, guardianConsent: null };
  const name = tidy(b.guardianFirstName, GUARDIAN_NAME_MAX);
  if (!name) missing("guardianFirstName", GUARDIAN_NAME_MISSING);
  if (b.guardianConsent !== true) missing("guardianConsent", GUARDIAN_CONSENT_MISSING);
  return { guardianFirstName: name, guardianConsent: b.guardianConsent === true };
}

/** The hidden box a person never sees was filled in: under its name now ("nbccCheck"), or its old one. */
export function trapFilled(body: unknown): boolean {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return ["nbccCheck", "company"].some((k) => typeof b[k] === "string" && (b[k] as string).trim() !== "");
}

export const SPORTING_KIND_MISMATCH = "Please choose one from the list.";

/**
 * The form as rebuilt by the sign up tidy says so (formVersion 2). Anything else is a page left open
 * from before the deploy, sending the old shape: it is taken by the old rules for what it never asked.
 */
export function isOldForm(b: { formVersion?: unknown }): boolean {
  return b.formVersion !== 2;
}

export const pathFields = {
  formVersion: z.unknown(),
  dateTbc: z.unknown(),
  childFundraiser: z.unknown(),
  childFirstName: z.unknown(),
  childConsent: z.unknown(),
  forOrganisation: yesNo,
  orgName: z.unknown(),
  employerMatch: z.unknown(),
  memoryDirectorBusiness: z.unknown(),
  memoryFamilyContactName: z.unknown(),
  memoryFamilyContactEmail: z.unknown(),
  callTime: z.unknown(),
  listed: yesNo,
};

export interface PathIn {
  path?: string;
  inMemory?: boolean;
  memorySetupBy?: unknown;
  childFundraiser?: unknown;
  childFirstName?: unknown;
  childConsent?: unknown;
  forOrganisation?: boolean;
  orgName?: unknown;
  employerMatch?: unknown;
  memoryDirectorBusiness?: unknown;
  memoryFamilyContactName?: unknown;
  memoryFamilyContactEmail?: unknown;
  callTime?: unknown;
}

const memoryPath = (b: PathIn) => b.path === "raising" && b.inMemory === true;
const forChild = (b: PathIn) => b.path === "raising" && !memoryPath(b) && b.childFundraiser === "child";
const forOrg = (b: PathIn) => !memoryPath(b) && b.forOrganisation === true;
const byDirector = (b: PathIn) => memoryPath(b) && b.memorySetupBy === "funeral_director";

export function checkPaths(b: PathIn, missing: (path: string, message: string) => void): void {
  if (forChild(b)) {
    if (!tidy(b.childFirstName, CHILD_NAME_MAX)) missing("childFirstName", CHILD_NAME_MISSING);
    if (b.childConsent !== true) missing("childConsent", CHILD_CONSENT_MISSING);
  }
  if (forOrg(b)) {
    if (!tidy(b.orgName, ORG_NAME_MAX)) missing("orgName", ORG_NAME_MISSING);
    if (b.employerMatch != null && b.employerMatch !== "" && !(EMPLOYER_MATCH as readonly unknown[]).includes(b.employerMatch)) {
      missing("employerMatch", EMPLOYER_MATCH_UNKNOWN);
    }
  }
  if (byDirector(b)) {
    if (!tidy(b.memoryDirectorBusiness, ORG_NAME_MAX)) missing("memoryDirectorBusiness", MEMORY_BUSINESS_MISSING);
    const email = tidy(b.memoryFamilyContactEmail, 254);
    if (email && !EMAIL_SHAPE.test(email)) missing("memoryFamilyContactEmail", FAMILY_EMAIL_BAD);
  }
}

export interface PathStored {
  childFirstName: string | null;
  childConsent: boolean | null;
  orgName: string | null;
  employerMatch: EmployerMatch | null;
  memoryDirectorBusiness: string | null;
  memoryFamilyContactName: string | null;
  memoryFamilyContactEmail: string | null;
  callTime: string | null;
  /** A member page for someone under 18 (the join form): their parent's or guardian's first name. */
  guardianFirstName: string | null;
}

export function pathsOf(b: PathIn): PathStored {
  const child = forChild(b);
  const org = forOrg(b);
  const director = byDirector(b);
  return {
    childFirstName: child ? tidy(b.childFirstName, CHILD_NAME_MAX) : null,
    childConsent: child ? b.childConsent === true : null,
    orgName: org ? tidy(b.orgName, ORG_NAME_MAX) : null,
    employerMatch: org && (EMPLOYER_MATCH as readonly unknown[]).includes(b.employerMatch) ? (b.employerMatch as EmployerMatch) : null,
    memoryDirectorBusiness: director ? tidy(b.memoryDirectorBusiness, ORG_NAME_MAX) : null,
    memoryFamilyContactName: director ? tidy(b.memoryFamilyContactName, 100) : null,
    memoryFamilyContactEmail: director ? tidy(b.memoryFamilyContactEmail, 254)?.toLowerCase() ?? null : null,
    callTime: tidy(b.callTime, CALL_TIME_MAX),
    guardianFirstName: null,
  };
}

/** "Jack" from "jack sample": the first word, with a capital. */
export function firstWord(name: string): string {
  const w = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
}

/**
 * Who the page and card say organised it. An event keeps the name it is credited to; then a funeral
 * director "for the family", a child's first name (with their business, school or group if there is
 * one), the business, school or group. Null otherwise: the page shows the organiser's short name,
 * as always (shortName in ./model.ts).
 */
export function organisedByFor(f: {
  name: string;
  path: string;
  creditName?: string | null;
  inMemory?: boolean | null;
  memorySetupBy?: string | null;
  memoryDirectorBusiness?: string | null;
  childFirstName?: string | null;
  orgName?: string | null;
  firstName?: string | null;
  guardianFirstName?: string | null;
}): string | null {
  if (f.path === "event" && f.creditName) return f.creditName;
  if (f.inMemory === true && f.memorySetupBy === "funeral_director" && f.memoryDirectorBusiness) return `${f.memoryDirectorBusiness}, for the family`;
  if (f.childFirstName) return f.orgName ? `${f.childFirstName}, with ${f.orgName}` : f.childFirstName;
  // A team member page for someone under 18: their first name only, never the surname's first letter.
  if (f.guardianFirstName) return firstWord(f.firstName ?? f.name);
  if (f.orgName) return f.orgName;
  return null;
}
