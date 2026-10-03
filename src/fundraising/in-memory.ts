import { z } from "zod";
import type { FundraiserRecord, Meter, WallSourceRow } from "./model";

// In memory pages (Jaimie, 2026-10-03; master list point 22). A page raising money in memory of
// someone, set up by the family, a friend or a funeral director, each with the family's permission,
// and checked by staff before it goes live like every page. The rules, pure: no pool, no config, no
// clock (test/unit/fundraising-in-memory.test.ts). Only types come from ./model, so ./model can use
// these without a loop.
//
//   - the sign up asks "Is this in memory of someone?" on the raising money path, Yes or No with
//     nothing chosen for them (the form); then the person's name, optional dates in their own words,
//     who is setting it up, and "I have the family's permission". With a target, whether to show it
//     on the page: asked, never chosen for them.
//   - the page is quieter: "In memory of <name>", no countdown or banner wishing luck, and the
//     target and how close it is only if the family said so.
//   - every message a giver leaves waits for staff before it shows (held, read in SQL).
//   - a giver may tick "Let the family know I gave"; the organiser then sees their name and message
//     (once staff have approved it), never the amount and never an email address.
//   - no upbeat automatic emails (isQuietFundraiser in ./touch-rules asks isInMemory), and no
//     automatic anniversary email: a quiet reminder for staff a year on instead.
//
// Plain, gentle words, with no dashes.

export const SETUP_BY = ["family", "friend", "funeral_director"] as const;
export type MemorySetupBy = (typeof SETUP_BY)[number];

/** Who set it up, as the admin and the staff email say it. */
export const SETUP_BY_LABELS: Record<MemorySetupBy, string> = {
  family: "A family member",
  friend: "A friend",
  funeral_director: "A funeral director",
};

export const MEMORY_NAME_MAX = 100;
export const MEMORY_DATES_MAX = 60;
/** A year on from the page going live, staff are reminded to decide whether to get in touch. */
export const YEAR_ON_DAYS = 365;

export const IN_MEMORY_NAME_MISSING = "Tell us the name of the person you are remembering.";
export const SETUP_BY_MISSING = "Tell us who is setting up the page.";
export const PERMISSION_MISSING = "Please tick to say you have the family's permission.";
export const SHOW_TARGET_MISSING = "Tell us whether to show the target on the page.";
/** Team pages: an in memory page is always just the one page, never a team. */
export const IN_MEMORY_NOT_TEAM = "A page in memory of someone is just for you, not a team. Choose Just me, or let us know if a team would like to help.";

// One plain line: line breaks, tabs and other control characters become spaces (review fix), so a
// name or dates can never break a heading, an email subject or a printed envelope.
const isControl = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return c < 32 || (c >= 127 && c <= 159) || c === 0x2028 || c === 0x2029;
};
const plainLine = (v: unknown) =>
  v == null
    ? ""
    : typeof v === "string"
      ? Array.from(v, (ch) => (isControl(ch) ? " " : ch)).join("").replace(/\s+/g, " ").trim()
      : v;
const blankable = plainLine;
const optionalText = (max: number) =>
  z
    .preprocess(blankable, z.string().max(max, `Keep this to ${max} characters or fewer.`))
    .transform((v) => (v === "" ? null : v));
const yesNo = z.preprocess((v) => (typeof v === "boolean" ? v : undefined), z.boolean().optional());

/** The in memory questions, as the sign up sends them. Checked in checkMemory, kept by memoryOf. */
export const memoryFields = {
  inMemory: yesNo,
  memoryName: optionalText(MEMORY_NAME_MAX),
  memoryDates: optionalText(MEMORY_DATES_MAX),
  memorySetupBy: z.unknown(),
  memoryPermission: z.unknown(),
  memoryShowTarget: yesNo,
  // Team pages' "Just me, or a team?" (team = "me" or "team"), read here only to keep an in memory
  // page off a team. Checked in full by the team pages' own rules.
  team: z.unknown(),
};

export interface MemoryIn {
  path?: string;
  targetPence?: number | null;
  inMemory?: boolean;
  memoryName?: string | null;
  memoryDates?: string | null;
  memorySetupBy?: unknown;
  memoryPermission?: unknown;
  memoryShowTarget?: boolean;
  team?: unknown;
}

/** In memory, as the sign up answered it: only a Yes, and only when raising money. */
function memoryChosen(b: MemoryIn): boolean {
  return b.path === "raising" && b.inMemory === true;
}

const isSetupBy = (v: unknown): v is MemorySetupBy => typeof v === "string" && (SETUP_BY as readonly string[]).includes(v);

/**
 * The checks for one in memory: the name, who set it up, the family's permission (a tick, so only
 * true), and with a target, whether to show it. Nothing is asked of any other sign up. A missing
 * answer to "Is this in memory of someone?" is not in memory: the form asks it, with nothing chosen,
 * and a page opened before it was asked carries on as it always did.
 */
export function checkMemory(b: MemoryIn, missing: (path: string, message: string) => void): void {
  if (!memoryChosen(b)) return;
  if (!b.memoryName) missing("memoryName", IN_MEMORY_NAME_MISSING);
  if (!isSetupBy(b.memorySetupBy)) missing("memorySetupBy", SETUP_BY_MISSING);
  if (b.memoryPermission !== true) missing("memoryPermission", PERMISSION_MISSING);
  if (b.targetPence && b.memoryShowTarget === undefined) missing("memoryShowTarget", SHOW_TARGET_MISSING);
  if (b.team === "team") missing("team", IN_MEMORY_NOT_TEAM);
}

export interface MemoryStored {
  inMemory: boolean;
  memoryName: string | null;
  memoryDates: string | null;
  memorySetupBy: MemorySetupBy | null;
  memoryPermission: boolean | null;
  memoryShowTarget: boolean | null;
}

/** What is kept: the answers only for one in memory, and the target choice only with a target. */
export function memoryOf(b: MemoryIn): MemoryStored {
  if (!memoryChosen(b)) {
    return { inMemory: false, memoryName: null, memoryDates: null, memorySetupBy: null, memoryPermission: null, memoryShowTarget: null };
  }
  return {
    inMemory: true,
    memoryName: b.memoryName ?? null,
    memoryDates: b.memoryDates ?? null,
    memorySetupBy: isSetupBy(b.memorySetupBy) ? b.memorySetupBy : null,
    memoryPermission: b.memoryPermission === true,
    memoryShowTarget: b.targetPence ? b.memoryShowTarget === true : null,
  };
}

/** "In memory of Margaret Exampleton": the page's name when they give it none. */
export function memoryTitle(name: string): string {
  return `In memory of ${name.trim()}`;
}

/** May the name for it be left empty? Only in memory, where it is named for them. */
export function titleOptional(b: MemoryIn): boolean {
  return memoryChosen(b);
}

/** The name for it: theirs, or "In memory of <name>". */
export function titleFor(b: MemoryIn & { title?: string | null }): string {
  if (b.title) return b.title;
  return memoryChosen(b) && b.memoryName ? memoryTitle(b.memoryName) : "";
}

// --- the record ----------------------------------------------------------------------------------

type MemoryRecord = Partial<
  Pick<FundraiserRecord, "inMemory" | "memoryName" | "memoryDates" | "memorySetupBy" | "memoryShowTarget" | "memoryReminderDoneAt">
>;

/** Is this page in memory of someone? The one place that says so. */
export function isInMemory(f: { inMemory?: boolean | null }): boolean {
  return f.inMemory === true;
}

export interface PublicMemory {
  name: string;
  /** In their own words ("1948 to 2026"), or null. */
  dates: string | null;
  /** The family chose to show the target and how close it is. */
  showTarget: boolean;
}

/** What the public sees of who it remembers, or null for any other page. */
export function publicMemory(f: MemoryRecord): PublicMemory | null {
  if (!isInMemory(f) || !f.memoryName) return null;
  return { name: f.memoryName.trim(), dates: f.memoryDates?.trim() || null, showTarget: f.memoryShowTarget === true };
}

/**
 * The meter the public sees: for a page in memory, the target and how close it is only when the
 * family chose to show them. What has been raised always shows. Every other page: as it is.
 */
export function memoryMeter(f: MemoryRecord, m: Meter): Meter {
  if (!isInMemory(f) || f.memoryShowTarget === true) return m;
  return { ...m, targetPence: null, percent: null, barPercent: null, overTarget: false };
}

/** "A friend, with the family's permission", for the admin and the staff email. */
export function memorySetupWords(f: { memorySetupBy?: string | null }): string {
  const who = isSetupBy(f.memorySetupBy) ? SETUP_BY_LABELS[f.memorySetupBy] : "Not given";
  return `${who}, with the family's permission`;
}

// --- the family's list of who gave ---------------------------------------------------------------

export interface FamilyGift {
  donationId: number;
  /** The name they gave: they asked for the family to know. */
  name: string;
  /** Their message, once staff have approved it; otherwise null. */
  message: string | null;
  createdAt: string;
  /** Already in a thank you (waiting, sent or skipped). */
  thanked: boolean;
}

// What a donor's name becomes when their details are redacted at the end of the retention period.
const REDACTED_NAME = "redacted";

/**
 * Who gave and asked to let the family know, newest first: the name they gave and their message
 * once staff have approved it. Never the amount, never an email address, never money the organiser
 * paid in, never a gift refunded in full. `held` are the gifts already in a thank you.
 */
export function familyGifts(rows: WallSourceRow[], held: Set<number>): FamilyGift[] {
  return rows
    .filter((r) => r.familyNotify === true && !r.paidIn && Math.max(0, r.amountPence - Math.max(0, r.refundedPence)) > 0)
    .filter((r) => r.fullName.trim() !== "" && r.fullName.trim().toLowerCase() !== REDACTED_NAME)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.donationId - a.donationId))
    .map((r) => ({
      donationId: r.donationId,
      name: r.fullName.trim().replace(/\s+/g, " "),
      message: !r.hidden && !r.held && r.message && r.message.trim() !== "" ? r.message.trim() : null,
      // Review fix: the day only, never the time, so a gift cannot be matched to its amount by when.
      createdAt: memoryDay(r.createdAt),
      thanked: held.has(r.donationId),
    }));
}

// --- a year on -----------------------------------------------------------------------------------

const ukDayOf = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** The UK day of a moment, YYYY-MM-DD: how an in memory page's gifts are dated, never by the time. */
export function memoryDay(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : ukDayOf(iso);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * A year after an in memory page went live, staff are reminded (in Admin > Fundraising and the
 * Monday summary) to decide whether to get in touch. No email goes by itself. Until someone marks it
 * dealt with. `today` is a UK day, YYYY-MM-DD.
 */
export function memoryYearOnDue(
  f: MemoryRecord & Pick<FundraiserRecord, "status" | "approvedAt">,
  today: string,
): boolean {
  if (!isInMemory(f) || f.memoryReminderDoneAt) return false;
  if (f.status !== "approved" && f.status !== "finished") return false;
  if (!f.approvedAt) return false;
  return daysBetween(ukDayOf(f.approvedAt), today) >= YEAR_ON_DAYS;
}

// --- for staff -----------------------------------------------------------------------------------

/** The lines the events inbox and the admin show about who it remembers; none for any other. */
export function memoryStaffFacts(f: MemoryRecord & { targetPence?: number | null }): Array<[string, string]> {
  if (!isInMemory(f)) return [];
  const facts: Array<[string, string]> = [
    ["In memory of", `${(f.memoryName ?? "").trim()}${f.memoryDates?.trim() ? ` (${f.memoryDates.trim()})` : ""}`],
    ["Set up by", memorySetupWords(f)],
  ];
  if (f.targetPence) facts.push(["Show the target on the page", f.memoryShowTarget === true ? "Yes" : "No, keep it hidden"]);
  return facts;
}

/** What the admin's list and sign up show about an in memory page; nothing for any other. */
export function memoryAdminFacts(
  f: MemoryRecord & Pick<FundraiserRecord, "status" | "approvedAt">,
  today: string,
): { memorySetupWords?: string; memoryYearOnDue?: boolean } {
  if (!isInMemory(f)) return {};
  return { memorySetupWords: memorySetupWords(f), memoryYearOnDue: memoryYearOnDue(f, today) };
}

// --- staff correcting the details (an admin, in Admin > Fundraising) ---------------------------------

/**
 * What an admin may correct: the name, the dates, who set it up, and the target choice (null when
 * there is no target). Never the permission: it stays as the person who set it up gave it. The
 * organiser asks staff for a change; there is no self service edit.
 */
export const memoryEditSchema = z
  .object({
    memoryName: z.preprocess(
      blankable,
      z.string({ required_error: IN_MEMORY_NAME_MISSING }).min(1, IN_MEMORY_NAME_MISSING).max(MEMORY_NAME_MAX, `Keep this to ${MEMORY_NAME_MAX} characters or fewer.`),
    ),
    memoryDates: optionalText(MEMORY_DATES_MAX).optional().transform((v) => v ?? null),
    memorySetupBy: z.enum(SETUP_BY, { errorMap: () => ({ message: SETUP_BY_MISSING }) }),
    memoryShowTarget: z.boolean({ invalid_type_error: SHOW_TARGET_MISSING }).nullable(),
  })
  .strict();

export type MemoryEdit = z.infer<typeof memoryEditSchema>;
