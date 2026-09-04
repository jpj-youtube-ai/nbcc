// TASK-416: turning a pasted list into businesses.
//
// Pure - no pool, no config - so every parsing decision is unit-tested without a database
// (golden rule 5).
//
// This exists because there will eventually be hundreds of these and typing them one at a time is
// how a volunteer stops doing it. But it ONLY adds drafts: it never sends, never picks a source,
// and never records a consent basis. Each business still has to be opened and sent individually
// with its own personal message, so there is no moment where somebody could wonder which message
// went to whom - which was the whole worry about doing this at all.
//
// What comes in is whatever a person pasted: a column from a spreadsheet, a list off a website,
// something typed with inconsistent commas. So the parser guesses field by field rather than
// insisting on an order, and reports what it made of each line so nothing lands unseen.

export interface ParsedLine {
  line: number;
  raw: string;
  businessName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Why this line cannot be used, or null when it can. */
  problem: string | null;
}

/** Anything with an @ and a dot after it. Deliberately loose: the schema validates properly. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Six or more digits, allowing the spaces, brackets and +44 people actually type. */
const LOOKS_LIKE_PHONE = /^[+()\d][\d\s()+-]{5,}$/;

/**
 * One pasted block into one row per line.
 *
 * Fields are split on tabs OR commas, because a paste from a spreadsheet gives tabs and a paste
 * from an email gives commas, and a volunteer should not have to know which they have.
 *
 * The order is not fixed. Whichever field looks like an email is the email, whichever looks like a
 * phone number is the phone, and what is left is the name. Insisting on "name, email, phone" would
 * mean rejecting a perfectly good list for being in the wrong order, which is not a reason.
 */
export function parsePastedBusinesses(text: string): ParsedLine[] {
  const rows: ParsedLine[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue; // blank lines are just spacing

    const fields = raw
      .split(/\t|,/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    let email: string | null = null;
    let phone: string | null = null;
    const rest: string[] = [];

    for (const field of fields) {
      if (!email && LOOKS_LIKE_EMAIL.test(field)) email = field.toLowerCase();
      else if (!phone && LOOKS_LIKE_PHONE.test(field)) phone = field;
      else rest.push(field);
    }

    const businessName = rest.join(", ").trim();
    let problem: string | null = null;
    if (!businessName) problem = "No business name on this line";
    else if (businessName.length < 2) problem = "That name is too short to be a business";
    else if (businessName.length > 200) problem = "That name is too long";

    rows.push({ line: i + 1, raw: raw.trim(), businessName, contactEmail: email, contactPhone: phone, problem });
  }

  return rows;
}

export interface PasteSummary {
  usable: ParsedLine[];
  problems: ParsedLine[];
  /** Names appearing more than once in the paste itself, before anything touches the database. */
  duplicatedInPaste: string[];
}

/**
 * What the volunteer is shown before anything is written.
 *
 * The duplicate check here is only about the PASTE — the same firm listed twice in the block
 * somebody copied. Duplicates against businesses we already know are the matcher's job, and it
 * runs server side on each add, so a paste cannot smuggle a business past the do-not-contact rule.
 */
export function summarisePaste(rows: ParsedLine[]): PasteSummary {
  const usable = rows.filter((r) => !r.problem);
  const seen = new Map<string, number>();
  for (const row of usable) {
    const key = row.businessName.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return {
    usable,
    problems: rows.filter((r) => r.problem),
    duplicatedInPaste: [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name),
  };
}

/**
 * Tags, from what somebody typed into a box.
 *
 * Lower-cased and de-duplicated so "Chamber" and "chamber" are one tag rather than two that look
 * identical in a filter list. Capped because a tag field is not a notes field, and somebody will
 * one day paste a paragraph into it.
 */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(/[,;]/)) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag && tag.length <= 40) seen.add(tag);
    if (seen.size >= 10) break;
  }
  return [...seen];
}
