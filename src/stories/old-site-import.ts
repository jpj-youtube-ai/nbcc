import { createHash } from "node:crypto";
import { z } from "zod";
import { AGE_BANDS, MAX_ADMIN_NOTES_LENGTH, RECIPIENT_TYPES } from "./schema";

// TASK-461: the old website's My Story form, read from its CSV export and turned into rows for the
// stories database.
//
// Pure and DB-free: the admin route reads and writes, this decides. Nobody's words are edited: the
// old form's answers are mapped onto the new form's columns, and a row that is left out says why in
// a plain sentence, because the person pressing "Add" needs to know. When in doubt it leaves out:
// a damaged row, a date that could mean two things, and an earlier go someone replaced.
//
// The file holds names, emails and phone numbers, so the tests use invented people, and the real
// export never goes near the repository.

// ---- reading the file ----

/** A quotation mark opened and never closed: every row after it would be read wrongly or lost. */
export class DamagedCsvError extends Error {
  constructor(readonly record: number) {
    super(`a quotation mark in record ${record} is never closed`);
  }
}

/**
 * A CSV file as rows of fields (RFC 4180): quoted fields, "" for a quote inside one, line breaks
 * inside quotes kept as \n, a byte order mark from Excel ignored, blank lines dropped. A quotation
 * mark still open at the end throws DamagedCsvError, rather than quietly swallowing the rest.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quotedFrom = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else if (c === "\r") {
        field += "\n";
        if (text[i + 1] === "\n") i++;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
      quotedFrom = rows.length;
    } else if (c === ",") {
      endField();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (quoted) throw new DamagedCsvError(quotedFrom);
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

type Field =
  | "submittedAt"
  | "story"
  | "quote"
  | "sharePublicly"
  | "shareFirstName"
  | "shareTown"
  | "internalUse"
  | "feedback"
  | "firstName"
  | "email"
  | "phone"
  | "age"
  | "gender"
  | "town"
  | "recipient"
  | "heardAbout"
  | "confirmedOver16";

// How each column of the export is recognised: its question lowercased, curly quotes straightened
// and runs of spaces made single. Matched on the start of the question, or a phrase only it has, so
// a small change to the end of one would not lose the column.
const COLUMNS: ReadonlyArray<readonly [Field, (header: string) => boolean]> = [
  ["submittedAt", (h) => h.startsWith("submission date")],
  ["story", (h) => h === "your story"],
  ["quote", (h) => h.startsWith("short quote")],
  ["sharePublicly", (h) => h.startsWith("are you happy for us to share your story publicly")],
  ["shareFirstName", (h) => h.includes("share your first name")],
  ["shareTown", (h) => h.includes("share your town")],
  ["internalUse", (h) => h.includes("internally only")],
  ["feedback", (h) => h.startsWith("is there anything else")],
  ["firstName", (h) => h.startsWith("first name")],
  ["email", (h) => h.startsWith("email")],
  ["phone", (h) => h.startsWith("phone")],
  ["age", (h) => h === "your age"],
  ["gender", (h) => h.startsWith("how do you describe your gender")],
  ["town", (h) => h === "your town/area"],
  ["recipient", (h) => h.startsWith("the red bag went to")],
  ["heardAbout", (h) => h.startsWith("how did you hear")],
  ["confirmedOver16", (h) => h.startsWith("i confirm that i am over 16")],
];

// Without these a row cannot be a story with its consent, so a file missing one is not the export.
const REQUIRED: ReadonlyArray<readonly [Field, string]> = [
  ["submittedAt", "Submission date"],
  ["story", "Your story"],
  ["sharePublicly", "Are you happy for us to share your story publicly?"],
  ["confirmedOver16", "I confirm that I am over 16"],
];

function normaliseHeader(header: string): string {
  return header.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * One submission from the export: every answer as text, trimmed, "" when not given. `damaged`
 * says why the row cannot be trusted (its answers do not line up with the questions), or is "".
 */
export type OldSiteRow = { row: number; damaged: string } & Record<Field, string>;

export type ReadResult = { ok: true; rows: OldSiteRow[] } | { ok: false; error: string };

/** The export's submissions, or why the file cannot be read as the old form's export. */
export function readOldSiteExport(text: string): ReadResult {
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (err) {
    if (!(err instanceof DamagedCsvError)) throw err;
    const where = err.record === 0 ? "the first row" : `submission ${err.record}`;
    return {
      ok: false,
      error: `That file looks damaged: a quotation mark in ${where} is never closed, so it can't be read safely. Please export it from the old website again.`,
    };
  }
  if (table.length === 0) return { ok: false, error: "That file is empty." };
  const width = table[0].length;
  const at = new Map<Field, number>();
  table[0].forEach((raw, i) => {
    const header = normaliseHeader(raw);
    const hit = COLUMNS.find(([field, matches]) => !at.has(field) && matches(header));
    if (hit) at.set(hit[0], i);
  });
  const missing = REQUIRED.find(([field]) => !at.has(field));
  if (missing) {
    return {
      ok: false,
      error: `This doesn't look like the old website's My Story export: it has no "${missing[1]}" column.`,
    };
  }
  const rows = table.slice(1).map((cells, n) => {
    const row = { row: n + 1, damaged: "" } as OldSiteRow;
    // A comma in an answer that was not quoted shifts every answer after it into the wrong question,
    // so a row that does not have one answer per question is never read at all.
    if (cells.length !== width) {
      row.damaged = `It has ${cells.length} answers where the form has ${width}, so it may be damaged. It isn't added: check it in the file.`;
    }
    for (const [field] of COLUMNS) {
      const i = at.get(field);
      row[field] = i === undefined ? "" : (cells[i] ?? "").trim();
    }
    return row;
  });
  return { ok: true, rows };
}

// ---- turning a submission into a story ----

/** A story ready for the stories table: the columns this import sets. The rest take their defaults. */
export interface ImportedStory {
  created_at: string;
  consent_captured_at: string;
  story_text: string;
  short_quote: string | null;
  use_scope: "public" | "internal_only";
  consent_share_first_name: boolean;
  consent_share_town: boolean;
  contact_for_more: boolean;
  submitter_first_name: string | null;
  submitter_email: string | null;
  submitter_phone: string | null;
  submitter_town: string | null;
  age_band: (typeof AGE_BANDS)[number] | null;
  gender: string | null;
  recipient_type: (typeof RECIPIENT_TYPES)[number] | null;
  heard_about: string | null;
  confirmed_over_16: boolean;
  admin_notes: string;
}

export const MAX_STORY_LENGTH = 20_000;
const RESENT_WITHIN_MS = 60 * 60 * 1000;
const OPENING_LENGTH = 160;
const DAY_MS = 24 * 60 * 60 * 1000;
const EARLIEST_YEAR = 2000;

const EMAIL = z.string().email();
const yes = (answer: string) => /^(yes|y|true|checked|on|x)$/i.test(answer.trim());
const orNull = (value: string) => (value === "" ? null : value);

const DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "5 July 2026": the day it was where the charity is. */
export function dayInWords(at: Date): string {
  return DAY.format(at);
}

// A full date and time with its time zone, and nothing else: "05/07/2026" could be the 5th of July
// or the 7th of May, and a time with no zone could be an hour out in summer, so neither is guessed.
const EXACT_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

function readDate(value: string): Date | null {
  if (!EXACT_MOMENT.test(value)) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.getUTCFullYear() < EARLIEST_YEAR) return null;
  return at;
}

function ageBand(answer: string): (typeof AGE_BANDS)[number] | null {
  const a = answer.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^16 ?(to|-) ?24$/.test(a)) return "16_24";
  if (/^25 ?(to|-) ?44$/.test(a)) return "25_44";
  if (/^45 ?(to|-) ?64$/.test(a)) return "45_64";
  if (/^65 ?(\+|plus|and over|or over)$/.test(a)) return "65_plus";
  return null;
}

function recipientType(answer: string): (typeof RECIPIENT_TYPES)[number] | null {
  const a = answer.toLowerCase().replace(/\s+/g, " ").trim();
  if (a === "child") return "child";
  if (a === "young person") return "young_person";
  if (a === "vulnerable adult") return "vulnerable_adult";
  return null;
}

/** The same story sent at the same moment: how an import recognises one already here. */
export function storyKey(createdAt: string | Date, storyText: string): string {
  return `${new Date(createdAt).toISOString()}|${storyText}`;
}

/**
 * TASK-475: what an erased story leaves behind. The sha256, in hex, of its storyKey: the same
 * identity the import recognises a story by, so the import can tell an erased story when it meets it
 * again, while the fingerprint itself holds nothing readable. It cannot be turned back into the
 * words; it can only confirm a story someone already holds.
 */
export function erasedFingerprint(createdAt: string | Date, storyText: string): string {
  return createHash("sha256").update(storyKey(createdAt, storyText), "utf8").digest("hex");
}

/** Why a story erased from the admin is not brought back by the same file. */
export const ERASED_EARLIER = "It was erased earlier, so it isn't added again.";

// Who sent a row, as far as the file can tell: the email exactly as typed, whether or not it is a
// whole address, so two goes with the same mistyped address are still one person.
function senderOf(row: OldSiteRow): string | null {
  return row.email.trim().toLowerCase() || null;
}

function minutesInWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "less than a minute" : minutes === 1 ? "a minute" : `${minutes} minutes`;
}

const CONTACT_NOTE = `Marked happy to be contacted: the old form asked for an email or phone number "just in case you're happy for us to contact you about your story", and they gave one.`;

// The notes, within the admin's own limit on notes. Anything someone wrote goes in quoted, and if
// all of it cannot fit, it is shortened and says so, rather than leaving a story staff can never
// save again.
function notesWithin(sentences: string[], quoted: Array<[string, string]>): string {
  let notes = sentences.join(" ");
  for (const [label, text] of quoted) {
    const whole = ` ${label} "${text}"`;
    const room = MAX_ADMIN_NOTES_LENGTH - notes.length;
    if (whole.length <= room) {
      notes += whole;
      continue;
    }
    const ending = `…" (shortened to fit)`;
    const keep = room - ` ${label} "`.length - ending.length;
    if (keep >= 20) notes += ` ${label} "${text.slice(0, keep).trimEnd()}${ending}`;
  }
  return notes;
}

type Reading = { story: Omit<ImportedStory, "admin_notes">; at: Date; sentences: string[]; quoted: Array<[string, string]> };

// Everything about one row that can be decided from the row alone.
function readRow(row: OldSiteRow, importedOn: Date): Reading | { reason: string } {
  if (row.damaged) return { reason: row.damaged };
  const at = readDate(row.submittedAt);
  if (!at || at.getTime() > importedOn.getTime() + DAY_MS) {
    return { reason: "The date it was sent can't be read for certain, so it isn't added." };
  }
  if (row.story === "") return { reason: "There's no story in this row." };
  if (row.story.length > MAX_STORY_LENGTH) {
    return {
      reason: `The story is over ${MAX_STORY_LENGTH.toLocaleString("en-GB")} characters, far longer than the old form allowed, so please check the file.`,
    };
  }
  if (!yes(row.confirmedOver16)) return { reason: "They didn't confirm they're over 16." };
  const isPublic = yes(row.sharePublicly);
  if (!isPublic && !yes(row.internalUse)) {
    return { reason: "They didn't agree to their story being used, publicly or within the charity." };
  }
  const email = EMAIL.safeParse(row.email).success ? row.email : null;
  // The old form asked for these "just in case you're happy for us to contact you about your story".
  const contact = email !== null || row.phone !== "";
  const sentences = [
    `Brought in from the old website's My Story form on ${dayInWords(importedOn)}. They sent it on ${dayInWords(at)}.`,
  ];
  if (contact) sentences.push(CONTACT_NOTE);
  const quoted: Array<[string, string]> = [];
  if (row.email && !email) quoted.push(["The email they gave is not a complete address:", row.email.slice(0, 200)]);
  if (row.feedback) quoted.push(["They also wrote:", row.feedback]);
  return {
    at,
    sentences,
    quoted,
    story: {
      created_at: at.toISOString(),
      consent_captured_at: at.toISOString(),
      story_text: row.story,
      short_quote: orNull(row.quote),
      use_scope: isPublic ? "public" : "internal_only",
      // The name and town questions were for people sharing publicly; they mean nothing otherwise.
      consent_share_first_name: isPublic && yes(row.shareFirstName),
      consent_share_town: isPublic && yes(row.shareTown),
      contact_for_more: contact,
      submitter_first_name: orNull(row.firstName),
      submitter_email: email,
      submitter_phone: orNull(row.phone),
      submitter_town: orNull(row.town),
      age_band: ageBand(row.age),
      gender: orNull(row.gender),
      recipient_type: recipientType(row.recipient),
      heard_about: orNull(row.heardAbout),
      confirmed_over_16: true,
    },
  };
}

export interface ImportPlan {
  add: Array<{ row: OldSiteRow; story: ImportedStory }>;
  skip: Array<{ row: OldSiteRow; reason: string }>;
}

/** The stories to look for in the database: every row that could become one. */
export function lookupsFor(rows: OldSiteRow[]): Array<{ created_at: string; story_text: string }> {
  return rows.flatMap((row) => {
    const at = row.damaged ? null : readDate(row.submittedAt);
    return at && row.story ? [{ created_at: at.toISOString(), story_text: row.story }] : [];
  });
}

/**
 * What to add and what to leave out, in the file's order. `alreadyHere` holds the storyKey of each
 * story already in the database, archived or not, and `erasedEarlier` the storyKey of each one that
 * was erased from the admin (TASK-475), which is never added again.
 *
 * Someone who sent the form again within the hour sent a new version: their later go stands, even
 * when it takes the story back (it is then left out for its own reason, and so is the earlier one).
 * Every go is counted, whatever it said, as long as it is a readable, undamaged row with a story.
 */
export function planImport(
  rows: OldSiteRow[],
  alreadyHere: Set<string>,
  importedOn: Date,
  erasedEarlier: Set<string> = new Set(),
): ImportPlan {
  const sends = new Map<string, number[]>();
  for (const row of rows) {
    const sender = senderOf(row);
    const at = row.damaged || !row.story ? null : readDate(row.submittedAt);
    if (!sender || !at) continue;
    const times = sends.get(sender) ?? [];
    times.push(at.getTime());
    sends.set(sender, times);
  }
  for (const times of sends.values()) times.sort((a, b) => a - b);
  const sameSender = (row: OldSiteRow) => sends.get(senderOf(row) ?? "") ?? [];

  const planned = new Set<string>();
  const plan: ImportPlan = { add: [], skip: [] };
  for (const row of rows) {
    const reading = readRow(row, importedOn);
    const at = "at" in reading ? reading.at.getTime() : row.damaged ? null : readDate(row.submittedAt)?.getTime() ?? null;
    const next = at === null ? undefined : sameSender(row).find((t) => t > at);
    if (!row.damaged && next !== undefined && at !== null && next - at <= RESENT_WITHIN_MS) {
      plan.skip.push({ row, reason: `They sent it again ${minutesInWords(next - at)} later, so this earlier one is left out.` });
      continue;
    }
    if (!("at" in reading)) {
      plan.skip.push({ row, reason: reading.reason });
      continue;
    }
    const key = storyKey(reading.story.created_at, reading.story.story_text);
    if (alreadyHere.has(key)) {
      plan.skip.push({ row, reason: "It's already in the stories list." });
      continue;
    }
    if (erasedEarlier.has(key)) {
      plan.skip.push({ row, reason: ERASED_EARLIER });
      continue;
    }
    if (planned.has(key)) {
      plan.skip.push({ row, reason: "It appears twice in the file." });
      continue;
    }
    planned.add(key);
    // The words can differ between someone's goes, so whoever reads the kept story later is told
    // that an earlier version existed and was left out.
    const earlier = sameSender(row).filter((t) => t < reading.at.getTime() && reading.at.getTime() - t <= RESENT_WITHIN_MS);
    const sentences = [...reading.sentences];
    if (earlier.length === 1) {
      sentences.push(`They sent an earlier version ${minutesInWords(reading.at.getTime() - earlier[0])} before this one, which isn't added.`);
    } else if (earlier.length > 1) {
      sentences.push(`They sent ${earlier.length} earlier versions in the hour before this one, which aren't added.`);
    }
    plan.add.push({ row, story: { ...reading.story, admin_notes: notesWithin(sentences, reading.quoted) } });
  }
  return plan;
}

// ---- what the admin shows before anything is saved ----

export interface PreviewAdd {
  row: number;
  sentOn: string;
  firstName: string;
  town: string;
  opening: string;
  scope: "public" | "internal_only";
  shareFirstName: boolean;
  shareTown: boolean;
  contact: boolean;
}

export interface PreviewSkip {
  row: number;
  sentOn: string;
  firstName: string;
  town: string;
  reason: string;
}

export interface ImportPreview {
  adding: PreviewAdd[];
  skipping: PreviewSkip[];
}

/** The start of a story on one line, cut at a word. */
export function openingOf(story: string): string {
  const flat = story.replace(/\s+/g, " ").trim();
  if (flat.length <= OPENING_LENGTH) return flat;
  const cut = flat.slice(0, OPENING_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > OPENING_LENGTH / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?]+$/, "")}…`;
}

export function previewOf(plan: ImportPlan): ImportPreview {
  const sentOn = (row: OldSiteRow) => {
    const at = row.damaged ? null : readDate(row.submittedAt);
    return at ? dayInWords(at) : "";
  };
  return {
    adding: plan.add.map(({ row, story }) => ({
      row: row.row,
      sentOn: sentOn(row),
      firstName: row.firstName,
      town: row.town,
      opening: openingOf(story.story_text),
      scope: story.use_scope,
      shareFirstName: story.consent_share_first_name,
      shareTown: story.consent_share_town,
      contact: story.contact_for_more,
    })),
    skipping: plan.skip.map(({ row, reason }) => ({
      row: row.row,
      sentOn: sentOn(row),
      firstName: row.damaged ? "" : row.firstName,
      town: row.damaged ? "" : row.town,
      reason,
    })),
  };
}
