# Old website stories import: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An editor brings the old website's My Story submissions into Admin → Stories from its CSV export: preview first, then add, never twice.

**Architecture:** A pure module (`src/stories/old-site-import.ts`) reads the CSV, maps each answer onto the stories table and plans what to add or leave out. Two functions in `src/db/stories.ts` look up what is already there and insert inside one locked transaction. One admin route (`POST /api/admin/stories/import`, `stories:edit`) plans or commits. A closed panel on the Stories view drives it.

**Tech Stack:** Express + TypeScript, zod, node-postgres (the separate stories pool), Vitest (jsdom), Cucumber against the CI stories database, the admin's plain JS.

Spec: `docs/superpowers/specs/2026-09-30-old-site-stories-import-design.md`.

**Privacy rule for every task:** the real export (names, emails, phones) never enters the repository. Tests and scenarios use invented people at example.com.

---

## File map

- Create `src/stories/old-site-import.ts`: parse, recognise columns, map, plan, preview. Pure.
- Create `test/unit/stories-old-site-import.test.ts`: all of the above, on invented data.
- Modify `src/db/stories.ts`: add `storiesAlreadyHere` and `insertImportedStories`.
- Create `src/routes/admin-stories-import.ts`: the route, its path and body limit.
- Modify `src/app.ts`: the route's own JSON limit before the global parser; mount the router.
- Create `features/stories-import.feature` and `features/steps/stories-import.steps.js`.
- Modify `admin.html` (the panel), `assets/js/admin/app.js` (read, preview, add), `assets/css/admin.css` (the panel's look).
- Modify `test/unit/admin-shell.test.ts`: the panel's markup.
- Modify `README.md`: a paragraph beside the Stories admin notes.

---

### Task 1: Reading the file

**Files:** Create `src/stories/old-site-import.ts`; Test `test/unit/stories-old-site-import.test.ts`.

- [ ] **Step 1: Write the failing tests** (the fixture helpers are shared by every later test)

```ts
import { describe, it, expect } from "vitest";
import {
  parseCsv,
  readOldSiteExport,
  planImport,
  previewOf,
  lookupsFor,
  storyKey,
  openingOf,
  dayInWords,
  MAX_STORY_LENGTH,
  type OldSiteRow,
} from "../../src/stories/old-site-import";

// TASK-461: the old website's My Story export. Every person here is invented: the real export
// holds names, emails and phone numbers and never comes near this repository.

// The export's header row exactly as the old form wrote it: its questions, not anyone's answers.
const HEADER = [
  "Submission date",
  "Your story",
  "Short quote. This is a  short sentence we could use as a quote if you are happy for your story to be shared",
  "Are you happy for us to share your story publicly?",
  "If you selected 'Yes' above, are you happy for us to share your first name?",
  "If you selected 'Yes' above, are you happy for us to share your Town/Area?",
  "If you select ‘No’ above, are you happy for us to use your story internally only (for volunteer training, impact reporting or service improvement?",
  "Is there anything else you'd like to share with us, such as feedback, ideas or things we could do better?",
  "First name (leave this blank if you wish to be anonymous)",
  "Email (optional, just in case you're happy for us to contact you about your story). ",
  "Phone (optional, just in case you're happy for us to contact you about your story). ",
  "Your age",
  "How do you describe your gender?",
  "Your Town/Area",
  "The Red Bag went to a:",
  "How did you hear about us?",
  "I confirm that I am over 16 and that the information I’ve provided is accurate.",
];

type Answers = Partial<Record<
  "sent" | "story" | "quote" | "isPublic" | "name" | "town" | "internal" | "feedback" | "first" |
  "email" | "phone" | "age" | "gender" | "place" | "bag" | "heard" | "over16",
  string
>>;

// One invented submission, answered the way the old form answered.
function answers(a: Answers = {}): string[] {
  return [
    a.sent ?? "2026-07-06T19:30:12.345Z",
    a.story ?? "The Red Bag made our Christmas.",
    a.quote ?? "",
    a.isPublic ?? "Yes",
    a.name ?? "Yes",
    a.town ?? "Yes",
    a.internal ?? "",
    a.feedback ?? "",
    a.first ?? "Morag",
    a.email ?? "morag@example.com",
    a.phone ?? "",
    a.age ?? "45 to 64",
    a.gender ?? "Female",
    a.place ?? "Irvine",
    a.bag ?? "Child",
    a.heard ?? "Facebook",
    a.over16 ?? "Checked",
  ];
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (...rows: string[][]) => [HEADER, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

function read(text: string): OldSiteRow[] {
  const result = readOldSiteExport(text);
  if (!result.ok) throw new Error(result.error);
  return result.rows;
}
const ON = new Date("2026-09-30T12:00:00Z");
const plan = (text: string, here = new Set<string>()) => planImport(read(text), here, ON);

describe("reading a CSV file", () => {
  it("reads quoted fields, doubled quotes and line breaks inside a story", () => {
    expect(parseCsv('a,"b ""c""",d\r\n"line one\r\nline two",x,y\r\n')).toEqual([
      ["a", 'b "c"', "d"],
      ["line one\nline two", "x", "y"],
    ]);
  });

  it("ignores a byte order mark and blank lines, and needs no line break at the end", () => {
    expect(parseCsv("﻿a,b\r\n\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps an empty field empty", () => {
    expect(parseCsv('a,,""\n')).toEqual([["a", "", ""]]);
  });
});

describe("recognising the old form's export", () => {
  it("knows the export by its questions and numbers the submissions from 1", () => {
    const rows = read(csv(answers(), answers({ first: "Callum" })));
    expect(rows.map((r) => [r.row, r.firstName])).toEqual([
      [1, "Morag"],
      [2, "Callum"],
    ]);
    expect(rows[0].submittedAt).toBe("2026-07-06T19:30:12.345Z");
    expect(rows[0].sharePublicly).toBe("Yes");
    expect(rows[0].confirmedOver16).toBe("Checked");
  });

  it("refuses a file that is not the export, naming the first column it lacks", () => {
    expect(readOldSiteExport("Name,Email\r\nA,a@example.com\r\n")).toEqual({
      ok: false,
      error: `This doesn't look like the old website's My Story export: it has no "Submission date" column.`,
    });
    const noStory = HEADER.filter((h) => h !== "Your story").join(",");
    const result = readOldSiteExport(`${noStory}\r\n`);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/no "Your story" column/);
  });

  it("refuses an empty file", () => {
    expect(readOldSiteExport("")).toEqual({ ok: false, error: "That file is empty." });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/unit/stories-old-site-import.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/stories/old-site-import".

- [ ] **Step 3: Write the reading half of the module** (Task 2 appends the rest; the full file is shown there)

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/stories-old-site-import.test.ts` → the Task 1 tests PASS.

### Task 2: Mapping, planning and the preview

**Files:** `src/stories/old-site-import.ts`, `test/unit/stories-old-site-import.test.ts`.

- [ ] **Step 1: Append the failing tests**

```ts
describe("each answer, mapped", () => {
  it("keeps a public story's words exactly, with the date it was sent as when consent was given", () => {
    const [{ story }] = plan(csv(answers({ story: "Line one.\r\nLine two.  ", quote: "Christmas Eve felt like magic again " }))).add;
    expect(story).toMatchObject({
      created_at: "2026-07-06T19:30:12.345Z",
      consent_captured_at: "2026-07-06T19:30:12.345Z",
      story_text: "Line one.\nLine two.",
      short_quote: "Christmas Eve felt like magic again",
      use_scope: "public",
      consent_share_first_name: true,
      consent_share_town: true,
      submitter_first_name: "Morag",
      submitter_email: "morag@example.com",
      submitter_phone: null,
      submitter_town: "Irvine",
      gender: "Female",
      heard_about: "Facebook",
      recipient_type: "child",
      age_band: "45_64",
      confirmed_over_16: true,
    });
  });

  it("reads every age band the old form offered", () => {
    for (const [age, band] of [["16 to 24", "16_24"], ["25 to 44", "25_44"], ["45 to 64", "45_64"], ["65+", "65_plus"], ["Prefer not to say", null]]) {
      expect(plan(csv(answers({ age: age as string }))).add[0].story.age_band, String(age)).toBe(band);
    }
  });

  it("reads who the Red Bag went to", () => {
    for (const [bag, type] of [["Child", "child"], ["Young person", "young_person"], ["Vulnerable adult", "vulnerable_adult"], ["", null]]) {
      expect(plan(csv(answers({ bag: bag as string }))).add[0].story.recipient_type, String(bag)).toBe(type);
    }
  });

  it("marks someone happy to be contacted when they left an email or a phone number, as the old form asked", () => {
    const contact = (a: Answers) => plan(csv(answers(a))).add[0].story.contact_for_more;
    expect(contact({})).toBe(true);
    expect(contact({ email: "", phone: "07700 900123" })).toBe(true);
    expect(contact({ email: "", phone: "" })).toBe(false);
  });

  it("keeps an email only if it is a whole address, and notes what they typed", () => {
    const [{ story }] = plan(csv(answers({ email: "morag at example" }))).add;
    expect(story.submitter_email).toBeNull();
    expect(story.contact_for_more).toBe(false);
    expect(story.admin_notes).toContain('The email they gave is not a complete address: "morag at example"');
  });

  it("shares no name or town for a story kept within the charity, whatever those answers said", () => {
    const [{ story }] = plan(csv(answers({ isPublic: "No", internal: "Yes", name: "Yes", town: "Yes" }))).add;
    expect(story.use_scope).toBe("internal_only");
    expect(story.consent_share_first_name).toBe(false);
    expect(story.consent_share_town).toBe(false);
  });

  it("notes where it came from, with both dates in words, and anything else they wrote", () => {
    const [{ story }] = plan(csv(answers({ feedback: "Keep it up" }))).add;
    expect(story.admin_notes).toBe(
      `Brought in from the old website's My Story form on 30 September 2026. They sent it on 6 July 2026. They also wrote: "Keep it up"`,
    );
  });

  it("keeps a quote too long to be a short quote in the notes instead", () => {
    const long = "word ".repeat(70).trim();
    const [{ story }] = plan(csv(answers({ quote: long }))).add;
    expect(story.short_quote).toBeNull();
    expect(story.admin_notes).toContain(long);
  });
});

describe("rows that are not added, and why", () => {
  const reasons = (text: string, here?: Set<string>) => plan(text, here).skip.map((s) => s.reason);

  it("keeps only the later of two sent by the same email within the hour, saying how soon", () => {
    const p = plan(csv(
      answers({ sent: "2026-07-02T10:02:20.000Z", story: "Second go." }),
      answers({ sent: "2026-07-02T10:00:00.000Z", story: "First go." }),
    ));
    expect(p.add.map((a) => a.story.story_text)).toEqual(["Second go."]);
    expect(p.skip.map((s) => s.reason)).toEqual(["They sent it again 2 minutes later, so only their later version is added."]);
  });

  it("adds both when the same email wrote twice a day apart", () => {
    expect(plan(csv(answers({ sent: "2026-07-02T10:00:00Z", story: "Two." }), answers({ sent: "2026-07-01T10:00:00Z", story: "One." }))).add).toHaveLength(2);
  });

  it("never merges rows with no email", () => {
    expect(plan(csv(answers({ email: "", first: "A", sent: "2026-07-01T10:01:00Z" }), answers({ email: "", first: "B", sent: "2026-07-01T10:00:00Z" }))).add).toHaveLength(2);
  });

  it("adds a row that appears twice in the file once", () => {
    expect(reasons(csv(answers(), answers()))).toEqual(["It appears twice in the file."]);
  });

  it("leaves out a story already in the list", () => {
    const here = new Set([storyKey("2026-07-06T19:30:12.345Z", "The Red Bag made our Christmas.")]);
    expect(reasons(csv(answers()), here)).toEqual(["It's already in the stories list."]);
  });

  it("leaves out rows without consent, confirmation, a story or a clear date", () => {
    expect(reasons(csv(answers({ isPublic: "No", internal: "No" })))).toEqual([
      "They didn't agree to their story being used, publicly or within the charity.",
    ]);
    expect(reasons(csv(answers({ over16: "" })))).toEqual(["They didn't confirm they're over 16."]);
    expect(reasons(csv(answers({ story: "" })))).toEqual(["There's no story in this row."]);
    // 05/07 could be the 5th of July or the 7th of May, so it is never guessed.
    expect(reasons(csv(answers({ sent: "05/07/2026 14:10" })))).toEqual(["The date it was sent can't be read, so it isn't added."]);
    expect(reasons(csv(answers({ story: "x".repeat(MAX_STORY_LENGTH + 1) })))[0]).toMatch(/over 20,000 characters/);
  });
});

describe("the preview", () => {
  it("says who, when, how it opens and what they agreed to, and why anything is left out", () => {
    const preview = previewOf(plan(csv(answers(), answers({ over16: "", first: "Callum", place: "Troon" }))));
    expect(preview.adding).toEqual([
      {
        row: 1,
        sentOn: "6 July 2026",
        firstName: "Morag",
        town: "Irvine",
        opening: "The Red Bag made our Christmas.",
        scope: "public",
        shareFirstName: true,
        shareTown: true,
        contact: true,
      },
    ]);
    expect(preview.skipping).toEqual([
      { row: 2, sentOn: "6 July 2026", firstName: "Callum", town: "Troon", reason: "They didn't confirm they're over 16." },
    ]);
  });

  it("cuts a long opening at a word, and flattens its line breaks", () => {
    const opening = openingOf(`${"The hall was full of wrapping paper. ".repeat(10)}\n\nEnd.`);
    expect(opening.length).toBeLessThanOrEqual(161);
    expect(opening.endsWith("…")).toBe(true);
    expect(opening).not.toMatch(/\n| …$/);
    expect(openingOf("Short\nand sweet.")).toBe("Short and sweet.");
  });

  it("gives dates as the day it was in Scotland", () => {
    expect(dayInWords(new Date("2026-07-05T23:30:00Z"))).toBe("6 July 2026");
  });

  it("looks up only rows that could be stories", () => {
    expect(lookupsFor(read(csv(answers(), answers({ sent: "not a date" }), answers({ story: "" }))))).toEqual([
      { created_at: "2026-07-06T19:30:12.345Z", story_text: "The Red Bag made our Christmas." },
    ]);
  });

  it("recognises the same story from a date or its text", () => {
    expect(storyKey(new Date("2026-07-06T19:30:12.345Z"), "A")).toBe(storyKey("2026-07-06T19:30:12.345Z", "A"));
  });
});
```

- [ ] **Step 2: Run them to see them fail** (missing exports)

- [ ] **Step 3: Write the whole module**

```ts
import { z } from "zod";
import { AGE_BANDS, RECIPIENT_TYPES } from "./schema";

// TASK-461: the old website's My Story form, read from its CSV export and turned into rows for the
// stories database.
//
// Pure and DB-free: the admin route reads and writes, this decides. Nobody's words are edited: the
// old form's answers are mapped onto the new form's columns, and a row that is left out says why in
// a plain sentence, because the person pressing "Add" needs to know.
//
// The file holds names, emails and phone numbers, so the tests use invented people, and the real
// export never goes near the repository.

// ---- reading the file ----

/**
 * A CSV file as rows of fields (RFC 4180): quoted fields, "" for a quote inside one, line breaks
 * inside quotes kept as \n, a byte order mark from Excel ignored, blank lines dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
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
    } else if (c === ",") {
      endField();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
    }
  }
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

/** One submission from the export: every answer as text, trimmed, "" when not given. */
export type OldSiteRow = { row: number } & Record<Field, string>;

export type ReadResult = { ok: true; rows: OldSiteRow[] } | { ok: false; error: string };

/** The export's submissions, or why the file cannot be the old form's export. */
export function readOldSiteExport(text: string): ReadResult {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, error: "That file is empty." };
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
    const row = { row: n + 1 } as OldSiteRow;
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
const MAX_QUOTE_LENGTH = 300; // the new form's own limit on a short quote
const RESENT_WITHIN_MS = 60 * 60 * 1000;
const OPENING_LENGTH = 160;

const yes = (answer: string) => /^(yes|y|true|checked|on|x)$/i.test(answer.trim());
const orNull = (value: string) => (value === "" ? null : value);
const isEmail = (value: string) => z.string().email().safeParse(value).success;

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

// Only an ISO date: "05/07/2026" could be the 5th of July or the 7th of May, so it is never guessed.
function sentAt(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
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

type Outcome = { story: ImportedStory; at: Date } | { reason: string };

function toStory(row: OldSiteRow, importedOn: Date): Outcome {
  const at = sentAt(row.submittedAt);
  if (!at) return { reason: "The date it was sent can't be read, so it isn't added." };
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
  const email = isEmail(row.email) ? row.email : null;
  const quoteFits = row.quote.length <= MAX_QUOTE_LENGTH;
  const notes = [
    `Brought in from the old website's My Story form on ${dayInWords(importedOn)}. They sent it on ${dayInWords(at)}.`,
  ];
  if (row.feedback) notes.push(`They also wrote: "${row.feedback}"`);
  if (!quoteFits) notes.push(`Their quote was too long for a short quote, so it is kept here: "${row.quote}"`);
  if (row.email && !email) notes.push(`The email they gave is not a complete address: "${row.email}"`);
  return {
    at,
    story: {
      created_at: at.toISOString(),
      consent_captured_at: at.toISOString(),
      story_text: row.story,
      short_quote: quoteFits ? orNull(row.quote) : null,
      use_scope: isPublic ? "public" : "internal_only",
      // The name and town questions were for people sharing publicly; they mean nothing otherwise.
      consent_share_first_name: isPublic && yes(row.shareFirstName),
      consent_share_town: isPublic && yes(row.shareTown),
      // The old form asked for these "just in case you're happy for us to contact you about your story".
      contact_for_more: email !== null || row.phone !== "",
      submitter_first_name: orNull(row.firstName),
      submitter_email: email,
      submitter_phone: orNull(row.phone),
      submitter_town: orNull(row.town),
      age_band: ageBand(row.age),
      gender: orNull(row.gender),
      recipient_type: recipientType(row.recipient),
      heard_about: orNull(row.heardAbout),
      confirmed_over_16: true,
      admin_notes: notes.join(" "),
    },
  };
}

function resentReason(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const when = minutes < 1 ? "less than a minute later" : minutes === 1 ? "a minute later" : `${minutes} minutes later`;
  return `They sent it again ${when}, so only their later version is added.`;
}

export interface ImportPlan {
  add: Array<{ row: OldSiteRow; story: ImportedStory }>;
  skip: Array<{ row: OldSiteRow; reason: string }>;
}

/** The stories to look for in the database: every row that could become one. */
export function lookupsFor(rows: OldSiteRow[]): Array<{ created_at: string; story_text: string }> {
  return rows.flatMap((row) => {
    const at = sentAt(row.submittedAt);
    return at && row.story ? [{ created_at: at.toISOString(), story_text: row.story }] : [];
  });
}

/**
 * What to add and what to leave out, in the file's order. `alreadyHere` holds the storyKey of each
 * story already in the database, archived or not.
 */
export function planImport(rows: OldSiteRow[], alreadyHere: Set<string>, importedOn: Date): ImportPlan {
  const outcomes = rows.map((row) => ({ row, outcome: toStory(row, importedOn) }));
  const stories = outcomes.flatMap(({ outcome }) => ("story" in outcome ? [outcome] : []));
  const planned = new Set<string>();
  const plan: ImportPlan = { add: [], skip: [] };
  for (const { row, outcome } of outcomes) {
    if (!("story" in outcome)) {
      plan.skip.push({ row, reason: outcome.reason });
      continue;
    }
    // The same email again within the hour is a second go at the same story: the later one stands.
    const email = outcome.story.submitter_email?.toLowerCase();
    const resent = email
      ? stories
          .filter((s) => s.story.submitter_email?.toLowerCase() === email && s.at > outcome.at)
          .map((s) => s.at.getTime() - outcome.at.getTime())
          .filter((ms) => ms <= RESENT_WITHIN_MS)
      : [];
    if (resent.length) {
      plan.skip.push({ row, reason: resentReason(Math.min(...resent)) });
      continue;
    }
    const key = storyKey(outcome.story.created_at, outcome.story.story_text);
    if (alreadyHere.has(key)) {
      plan.skip.push({ row, reason: "It's already in the stories list." });
      continue;
    }
    if (planned.has(key)) {
      plan.skip.push({ row, reason: "It appears twice in the file." });
      continue;
    }
    planned.add(key);
    plan.add.push({ row, story: outcome.story });
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
    const at = sentAt(row.submittedAt);
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
      firstName: row.firstName,
      town: row.town,
      reason,
    })),
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/stories-old-site-import.test.ts` → all PASS.

### Task 3: The database

**Files:** Modify `src/db/stories.ts` (append; add the import at the top).

- [ ] **Step 1: Add** (checked end to end by Task 5's scenarios in CI, which has the stories database)

```ts
import { storyKey, type ImportedStory } from "../stories/old-site-import";

// ---- TASK-461: stories from the old website -------------------------------------------------------

// Which of these stories (sent at that moment, in those words) are already here, archived or not.
export async function storiesAlreadyHere(
  lookups: Array<{ created_at: string; story_text: string }>,
): Promise<Set<string>> {
  if (lookups.length === 0) return new Set();
  const found = await storiesPool.query<{ created_at: Date; story_text: string }>(
    "SELECT created_at, story_text FROM stories WHERE created_at = ANY($1::timestamptz[])",
    [lookups.map((l) => l.created_at)],
  );
  return new Set(found.rows.map((r) => storyKey(r.created_at, r.story_text)));
}

// Adds the stories in one transaction and returns how many went in. The lock, and the second look
// inside it, mean a double click or two people adding the same file at once cannot add a story
// twice: whichever arrives second finds it already here. Status "new", so each is reviewed like any
// other. No audit_log row, for the same reason as insertStory.
export async function insertImportedStories(stories: ImportedStory[]): Promise<number> {
  if (stories.length === 0) return 0;
  const client = await storiesPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stories: old website import'))");
    const found = await client.query<{ created_at: Date; story_text: string }>(
      "SELECT created_at, story_text FROM stories WHERE created_at = ANY($1::timestamptz[])",
      [stories.map((s) => s.created_at)],
    );
    const here = new Set(found.rows.map((r) => storyKey(r.created_at, r.story_text)));
    let added = 0;
    for (const s of stories) {
      const key = storyKey(s.created_at, s.story_text);
      if (here.has(key)) continue;
      await client.query(
        `INSERT INTO stories (
           created_at, consent_captured_at, story_text, short_quote, use_scope,
           consent_share_first_name, consent_share_town, contact_for_more,
           submitter_first_name, submitter_email, submitter_phone, submitter_town,
           age_band, gender, recipient_type, heard_about, confirmed_over_16,
           status, admin_notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'new', $18)`,
        [
          s.created_at,
          s.consent_captured_at,
          s.story_text,
          s.short_quote,
          s.use_scope,
          s.consent_share_first_name,
          s.consent_share_town,
          s.contact_for_more,
          s.submitter_first_name,
          s.submitter_email,
          s.submitter_phone,
          s.submitter_town,
          s.age_band,
          s.gender,
          s.recipient_type,
          s.heard_about,
          s.confirmed_over_16,
          s.admin_notes,
        ],
      );
      here.add(key);
      added++;
    }
    await client.query("COMMIT");
    return added;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2:** `npm run build` → exit 0.

### Task 4: The route

**Files:** Create `src/routes/admin-stories-import.ts`; Modify `src/app.ts`.

- [ ] **Step 1: The route**

```ts
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection } from "./admin-authz";
import { lookupsFor, planImport, previewOf, readOldSiteExport } from "../stories/old-site-import";
import { insertImportedStories, storiesAlreadyHere } from "../db/stories";

// TASK-461: bring the old website's My Story submissions in from its CSV export.
//
//   POST /api/admin/stories/import   { csv, commit? }   stories: edit
//
// Without `commit` it only reads: what would be added, and what would not and why. With it, it reads
// the file again here, never trusting a plan sent back from the browser, and saves.
//
// The file holds names, emails and phone numbers. The server keeps nothing from it but the rows that
// become stories, and logs only counts. No audit_log row: the stories feature never touches the
// charity database (src/db/stories.ts).

export const STORIES_IMPORT_PATH = "/api/admin/stories/import";
// The admin refuses a file over 2 MB before sending it; this leaves room for the JSON around it.
export const STORIES_IMPORT_BODY_LIMIT = "3mb";

const body = z.object({ csv: z.string().min(1), commit: z.boolean().optional() }).strict();

export const adminStoriesImportRouter = Router();

adminStoriesImportRouter.post(STORIES_IMPORT_PATH, async (req: Request, res: Response) => {
  if (!(await authorizeSection(req, res, "stories", "edit"))) return;
  const input = body.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Choose the CSV file exported from the old website's form." });
    return;
  }
  const read = readOldSiteExport(input.data.csv);
  if (!read.ok) {
    res.status(400).json({ error: read.error });
    return;
  }
  try {
    const plan = planImport(read.rows, await storiesAlreadyHere(lookupsFor(read.rows)), new Date());
    const preview = previewOf(plan);
    if (!input.data.commit) {
      res.json(preview);
      return;
    }
    const added = await insertImportedStories(plan.add.map((a) => a.story));
    console.log(`stories import from the old website: ${added} added, ${plan.skip.length} left out`);
    res.json({ ...preview, added });
  } catch (err) {
    console.error("stories import failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "The stories could not be saved. Nothing was added." });
  }
});
```

- [ ] **Step 2: Mount it in `src/app.ts`**: `import { adminStoriesImportRouter, STORIES_IMPORT_PATH, STORIES_IMPORT_BODY_LIMIT } from "./routes/admin-stories-import";`; add `app.use(STORIES_IMPORT_PATH, express.json({ limit: STORIES_IMPORT_BODY_LIMIT }));` beside the other path limits, before `app.use(express.json())`; add `app.use(adminStoriesImportRouter);` after `app.use(adminEventsRouter);`.

- [ ] **Step 3:** `npm run lint && npm run build` → clean.

### Task 5: Scenarios against the stories database

**Files:** Create `features/stories-import.feature`, `features/steps/stories-import.steps.js`.

- [ ] **Step 1: The feature**

```gherkin
@admin @stories-import @db
Feature: Bringing the old website's My Story submissions into the admin (TASK-461)
  The old website's form collected stories before this site existed. An editor chooses its CSV
  export on the Stories view, sees what it would add and why anything would be left out, and only
  then adds them: with the dates they were sent, their consents, and never twice.

  Background:
    Given an admin user "editor.import.admin.bdd@example.com" with role "editor" and password "import-pw-123"
    And an admin user "viewer.import.admin.bdd@example.com" with role "viewer" and password "import-pw-123"

  Scenario: reading the file saves nothing, and says what it would add and why it would leave one out
    When "editor.import.admin.bdd@example.com" reads the old website's export
    Then the import status should be 200
    And it would add 2 stories and leave out 1, because "They sent it again 2 minutes later"
    And 0 stories from the old website's export are saved

  Scenario: adding saves them as sent, with their consents, and a second go adds nothing
    When "editor.import.admin.bdd@example.com" adds the old website's export
    Then the import status should be 200
    And 2 stories from the old website's export are saved
    And Morag's story is saved as sent at "2026-07-06T19:30:12.345Z", public with her first name and town, and new
    When "editor.import.admin.bdd@example.com" adds the old website's export
    Then the import status should be 200
    And 0 more stories are added
    And 2 stories from the old website's export are saved

  Scenario: bringing stories in needs a session, and edit rights over stories
    When I read the old website's export without a session
    Then the import status should be 401
    When "viewer.import.admin.bdd@example.com" reads the old website's export
    Then the import status should be 403

  Scenario: a file that is not the old form's export is refused, and says why
    When "editor.import.admin.bdd@example.com" reads a CSV with the columns "Name,Email"
    Then the import status should be 400
    And the refusal says it has no "Submission date" column
```

- [ ] **Step 2: The steps**

```js
const { When, Then, Before, After, AfterAll } = require("@cucumber/cucumber");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Steps for stories-import.feature (TASK-461). Reads the SEPARATE stories database, as
// admin-stories.steps.js does. Every story here is invented and carries "(bdd-stories-import)", and
// is removed before and after each scenario. The staff come from the shared @admin steps.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const storiesPool = new Pool({ connectionString: process.env.STORIES_DATABASE_URL });
const MARK = "(bdd-stories-import)";
const PASSWORD = "import-pw-123";

// The old form's header row: its questions, not anyone's answers.
const HEADER = [
  "Submission date",
  "Your story",
  "Short quote. This is a  short sentence we could use as a quote if you are happy for your story to be shared",
  "Are you happy for us to share your story publicly?",
  "If you selected 'Yes' above, are you happy for us to share your first name?",
  "If you selected 'Yes' above, are you happy for us to share your Town/Area?",
  "If you select ‘No’ above, are you happy for us to use your story internally only (for volunteer training, impact reporting or service improvement?",
  "Is there anything else you'd like to share with us, such as feedback, ideas or things we could do better?",
  "First name (leave this blank if you wish to be anonymous)",
  "Email (optional, just in case you're happy for us to contact you about your story). ",
  "Phone (optional, just in case you're happy for us to contact you about your story). ",
  "Your age",
  "How do you describe your gender?",
  "Your Town/Area",
  "The Red Bag went to a:",
  "How did you hear about us?",
  "I confirm that I am over 16 and that the information I’ve provided is accurate.",
];

function submission({ sent, story, first, email, town }) {
  return [sent, `${story} ${MARK}`, "", "Yes", "Yes", "Yes", "", "", first, email, "", "25 to 44", "", town, "Child", "", "Checked"];
}

const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvOf = (rows) => [HEADER, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

// Three invented submissions, newest first as the old site exported them: Morag's, then Callum's
// story sent twice, two minutes and twenty seconds apart.
const EXPORT = csvOf([
  submission({ sent: "2026-07-06T19:30:12.345Z", story: "The Red Bag made our Christmas.", first: "Morag", email: "morag.import.bdd@example.com", town: "Irvine" }),
  submission({ sent: "2026-07-02T10:02:20.000Z", story: "We volunteer every year, second go.", first: "Callum", email: "callum.import.bdd@example.com", town: "Troon" }),
  submission({ sent: "2026-07-02T10:00:00.000Z", story: "We volunteer every year, first go.", first: "Callum", email: "callum.import.bdd@example.com", town: "Troon" }),
]);

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.token) return body.token;
  if (body.step === "2fa" && body.devCode) {
    const res2 = await fetch(`${BASE_URL}/api/admin/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    });
    return (await res2.json().catch(() => ({}))).token;
  }
  throw new Error(`could not sign in as ${email}: ${JSON.stringify(body)}`);
}

async function send(world, token, csv, commit) {
  const res = await fetch(`${BASE_URL}/api/admin/stories/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(commit ? { csv, commit: true } : { csv }),
  });
  world.importStatus = res.status;
  world.importBody = await res.json().catch(() => ({}));
}

async function savedCount() {
  const r = await storiesPool.query("SELECT count(*)::int AS n FROM stories WHERE story_text LIKE $1", [`%${MARK}%`]);
  return r.rows[0].n;
}

async function clean() {
  await storiesPool.query("DELETE FROM stories WHERE story_text LIKE $1", [`%${MARK}%`]);
}

Before({ tags: "@stories-import" }, clean);
After({ tags: "@stories-import" }, clean);
AfterAll(async function () {
  await storiesPool.end();
});

When("{string} reads the old website's export", async function (email) {
  await send(this, await login(email), EXPORT, false);
});

When("{string} adds the old website's export", async function (email) {
  await send(this, await login(email), EXPORT, true);
});

When("I read the old website's export without a session", async function () {
  await send(this, null, EXPORT, false);
});

When("{string} reads a CSV with the columns {string}", async function (email, columns) {
  await send(this, await login(email), `${columns}\r\nsomething,something\r\n`, false);
});

Then("the import status should be {int}", function (status) {
  assert.equal(this.importStatus, status, JSON.stringify(this.importBody));
});

Then("it would add {int} stories and leave out {int}, because {string}", function (adding, leaving, why) {
  assert.equal(this.importBody.adding.length, adding);
  assert.equal(this.importBody.skipping.length, leaving);
  assert.ok(this.importBody.skipping[0].reason.startsWith(why), this.importBody.skipping[0].reason);
});

Then("{int} stories from the old website's export are saved", async function (n) {
  assert.equal(await savedCount(), n);
});

Then("{int} more stories are added", function (n) {
  assert.equal(this.importBody.added, n);
});

Then(
  "Morag's story is saved as sent at {string}, public with her first name and town, and new",
  async function (sent) {
    const r = await storiesPool.query(
      `SELECT created_at, consent_captured_at, use_scope, consent_share_first_name, consent_share_town,
              contact_for_more, status, admin_notes, submitter_first_name, submitter_town
         FROM stories WHERE submitter_email = 'morag.import.bdd@example.com'`,
    );
    assert.equal(r.rows.length, 1);
    const s = r.rows[0];
    assert.equal(s.created_at.toISOString(), sent);
    assert.equal(s.consent_captured_at.toISOString(), sent);
    assert.equal(s.use_scope, "public");
    assert.equal(s.consent_share_first_name, true);
    assert.equal(s.consent_share_town, true);
    assert.equal(s.contact_for_more, true);
    assert.equal(s.status, "new");
    assert.equal(s.submitter_first_name, "Morag");
    assert.equal(s.submitter_town, "Irvine");
    assert.match(s.admin_notes, /^Brought in from the old website's My Story form on /);
  },
);

Then("the refusal says it has no {string} column", function (column) {
  assert.ok(String(this.importBody.error).includes(`no "${column}" column`), this.importBody.error);
});
```

- [ ] **Step 3:** `npx cucumber-js --dry-run --tags "@stories-import"` → 4 scenarios, no undefined or ambiguous steps. (They run for real in CI's `pr.yml`.)

### Task 6: The panel on the Stories view

**Files:** Modify `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css`, `test/unit/admin-shell.test.ts`.

- [ ] **Step 1: The failing shell test** (in the admin shell describe block, after the Stories test)

```ts
  // TASK-461: the old website's stories come in through a closed panel on the Stories view, shown
  // only once the script knows the person can edit stories.
  it("has the old website import on the Stories view, hidden until the script allows it", () => {
    const panel = doc.getElementById("storiesImport")!;
    expect(panel.tagName).toBe("DETAILS");
    expect(panel.hasAttribute("hidden")).toBe(true);
    expect(panel.hasAttribute("open")).toBe(false);
    expect(panel.closest("#view-stories")).not.toBeNull();
    const file = doc.getElementById("storiesImportFile") as HTMLInputElement;
    expect(file.type).toBe("file");
    expect(file.getAttribute("accept")).toContain(".csv");
    expect(doc.querySelector('label[for="storiesImportFile"]')).not.toBeNull();
    expect(doc.getElementById("storiesImportPlan")).not.toBeNull();
    expect(doc.getElementById("storiesImportStatus")?.getAttribute("role")).toBe("status");
  });
```

- [ ] **Step 2:** run it → FAIL (no `#storiesImport`).

- [ ] **Step 3: The panel** (in `admin.html`, straight after the Stories intro paragraph)

```html
              <!-- TASK-461: the old website's My Story submissions, from its CSV export. Editors and
                   admins only (app.js reveals it). Nothing is saved until "Add" is pressed. -->
              <details class="admin-import" id="storiesImport" hidden>
                <summary>Add stories from the old website</summary>
                <p class="admin-muted">Choose the My Story CSV exported from the old website's form. You'll see what it would add before anything is saved, and a story that's already here is never added twice.</p>
                <div class="admin-field">
                  <label for="storiesImportFile">The CSV file</label>
                  <input type="file" id="storiesImportFile" accept=".csv,text/csv">
                </div>
                <div id="storiesImportPlan"></div>
                <p class="admin-action-status" id="storiesImportStatus" role="status" aria-live="polite"></p>
              </details>
```

- [ ] **Step 4: The script** (in `app.js`, after `runStoriesDiagnostics`; and in `loadStories`, first line: `var imp = el("storiesImport"); if (imp) imp.hidden = !canEdit("stories");`)

```js
  // ---- stories from the old website, from its CSV export (TASK-461) ----
  // Editors only (the server checks too). Choosing the file saves nothing: what would be added comes
  // first, and only "Add" writes. A file saved from Excel may not be UTF-8, so a file that does not
  // read cleanly as UTF-8 is read as Windows-1252 instead, rather than garbling people's names.
  var STORIES_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
  var storiesImportCsv = null;
  function storiesImportSay(msg) {
    var s = el("storiesImportStatus");
    if (s) s.textContent = msg || "";
  }
  function storiesImportPost(commit) {
    return authFetch("/api/admin/stories/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commit ? { csv: storiesImportCsv, commit: true } : { csv: storiesImportCsv }),
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (b) {
          if (!res.ok) throw new Error(b.error || "That file could not be read. Nothing was saved.");
          return b;
        });
    });
  }
  function storiesImportWho(item) {
    return (
      "<b>" + H.escapeHtml(item.firstName || "No name given") + "</b>" +
      (item.town ? ", " + H.escapeHtml(item.town) : "") +
      (item.sentOn ? ' <span class="admin-muted">sent ' + H.escapeHtml(item.sentOn) + "</span>" : "")
    );
  }
  function storiesImportPills(a) {
    var pills =
      '<span class="admin-pill ' + (a.scope === "public" ? "is-public" : "is-internal") + '">' +
      H.escapeHtml(H.storyLabel("useScope", a.scope)) + "</span>";
    if (a.shareFirstName) pills += ' <span class="admin-pill">First name</span>';
    if (a.shareTown) pills += ' <span class="admin-pill">Town</span>';
    if (a.contact) pills += ' <span class="admin-pill">Happy to be contacted</span>';
    return pills;
  }
  function renderStoriesImportPlan(p) {
    var adding = p.adding || [];
    var skipping = p.skipping || [];
    var html = adding.length
      ? '<h3 class="admin-subhead">' + (adding.length === 1 ? "1 story to add" : adding.length + " stories to add") + "</h3>" +
        '<ul class="admin-import-list">' +
        adding
          .map(function (a) {
            return (
              '<li><p class="admin-import-who">' + storiesImportWho(a) + "</p>" +
              '<p class="admin-import-opening">' + H.escapeHtml(a.opening) + "</p>" +
              '<p class="admin-import-pills">' + storiesImportPills(a) + "</p></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="admin-empty">Nothing new to add from this file.</p>';
    if (skipping.length) {
      html +=
        '<h3 class="admin-subhead">Not added</h3><ul class="admin-import-list">' +
        skipping
          .map(function (s) {
            return (
              '<li><p class="admin-import-who">' + storiesImportWho(s) + "</p>" +
              '<p class="admin-import-reason">' + H.escapeHtml(s.reason) + "</p></li>"
            );
          })
          .join("") +
        "</ul>";
    }
    if (adding.length) {
      html +=
        '<button class="btn btn-primary" type="button" id="storiesImportGo">' +
        (adding.length === 1 ? "Add this story" : "Add these " + adding.length + " stories") + "</button>";
    }
    el("storiesImportPlan").innerHTML = html;
    var go = el("storiesImportGo");
    if (go) go.addEventListener("click", addStoriesFromOldSite);
  }
  function storiesImportText(file) {
    return file.arrayBuffer().then(function (buf) {
      var text = new TextDecoder("utf-8").decode(buf);
      return text.indexOf("�") === -1 ? text : new TextDecoder("windows-1252").decode(buf);
    });
  }
  function storiesImportFailed(err) {
    if (err && err.message !== "unauthorized") storiesImportSay(err.message);
  }
  function readStoriesImportFile() {
    var input = el("storiesImportFile");
    var file = input && input.files && input.files[0];
    el("storiesImportPlan").innerHTML = "";
    storiesImportCsv = null;
    storiesImportSay("");
    if (!file) return;
    if (file.size > STORIES_IMPORT_MAX_BYTES) {
      storiesImportSay("That file is too big for this. The old form's export is far smaller, so please check it's the right file.");
      return;
    }
    storiesImportSay("Reading the file…");
    storiesImportText(file)
      .then(function (text) {
        storiesImportCsv = text;
        return storiesImportPost(false);
      })
      .then(function (p) {
        storiesImportSay("");
        renderStoriesImportPlan(p);
      })
      .catch(storiesImportFailed);
  }
  function addStoriesFromOldSite() {
    var go = el("storiesImportGo");
    if (go) go.disabled = true;
    storiesImportSay("Adding…");
    storiesImportPost(true)
      .then(function (p) {
        var n = p.added || 0;
        el("storiesImportPlan").innerHTML = "";
        el("storiesImportFile").value = "";
        storiesImportCsv = null;
        storiesImportSay(
          n === 0
            ? "Nothing was added: those stories are already here."
            : n === 1
              ? "Added 1 story. It's in the list below as New."
              : "Added " + n + " stories. They're in the list below as New.",
        );
        loadStories();
      })
      .catch(function (err) {
        if (go) go.disabled = false;
        storiesImportFailed(err);
      });
  }
  if (el("storiesImportFile")) el("storiesImportFile").addEventListener("change", readStoriesImportFile);
```

- [ ] **Step 5: The look** (append to `admin.css`)

```css
/* TASK-461: stories from the old website, before they are added. The list grows the page and never
   scrolls inside itself. */
.admin-import{margin:0 0 22px;padding:14px 20px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.admin-import>summary{cursor:pointer;font-weight:600;color:var(--maroon)}
.admin-import[open]>summary{margin-bottom:12px}
.admin-import .admin-field{max-width:520px}
.admin-import-list{list-style:none;margin:0 0 18px;padding:0;display:grid;gap:10px}
.admin-import-list li{padding:12px 16px;background:var(--cream);border:1px solid var(--line);border-radius:12px}
.admin-import-list p{margin:0}
.admin-import-list .admin-import-opening{margin-top:6px;max-width:72ch;overflow-wrap:anywhere}
.admin-import-list .admin-import-pills{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
.admin-import-list .admin-import-reason{margin-top:4px;color:var(--slate-soft)}
```

- [ ] **Step 6:** run the shell test → PASS. Check the panel in a real browser against a stand-in server with invented data: closed, opens, a file gives the preview, Add gives the message; phone width has no sideways scroll.

### Task 7: README

- [ ] **Step 1:** after the Stories storage diagnostic paragraph (TASK-309), add a paragraph **Stories from the old website (TASK-461)**: where the panel is and who sees it, preview then Add, the route and its limit, the date and consent mapping, the never-twice rule, the reasons a row is left out, the files and tests, and that the export only ever travels through the admin.

### Task 8: Ship

- [ ] **Step 1:** `npm run lint && npm run build && npm run test:unit` (the Windows-only donate size check is the one known local failure).
- [ ] **Step 2:** claim the number at PR time: highest across Actions, PR titles AND local branches and worktrees (`git branch -a`, `git worktree list`), plus one. (Written as 458; other sessions held 458 to 460 in unpushed worktrees, so this change is TASK-461.)
- [ ] **Step 3:** rename the branch `task-<n>-stories-import`, commit, push, open the PR, bind it; merge on green with Jaimie's go; watch the deploy; check `POST /api/admin/stories/import` answers 401 without a session on the live site.

---

## Changes after code review

An independent review before merge found these. The code blocks above are the first version; the
files are the source of truth.

- **Test data taken from the real export.** Two real submission times, one person's quote and a
  phrase from another's story had been used as "invented" test data, and the spec named one person.
  All replaced with invented values. Test data is invented from scratch, never adapted from the file.
- **A later go that takes the story back now wins.** Whether a row was sent again is decided from
  every readable, undamaged row with a story from the same email (compared as typed), before the
  row's own consent is checked. The earlier go's reason is now "so this earlier one is left out".
- **Damaged files.** `parseCsv` throws `DamagedCsvError` for a quotation mark never closed, and
  `readOldSiteExport` refuses the file. A row with more or fewer answers than the header is marked
  `damaged` and left out.
- **Dates are never guessed.** Only a full date and time with its zone, from 2000 up to the day of
  the import.
- **Notes fit the admin's own limit.** `MAX_ADMIN_NOTES_LENGTH` (2,000) now lives in
  `src/stories/schema.ts`, used by the PATCH route and the import. Quoted text is shortened to fit,
  and says so. A long quote stays in `short_quote` as written instead of moving to the notes.
- **The contact rule is explained** in the notes of every story it applies to.
- **Linear time.** Rows are grouped by sender in a Map; the email check is built once. 20,000 rows
  took 23 s before and run in well under the test's 5 s bound now.
- **The admin page:** strict UTF-8 decoding before falling back to Windows-1252; the text sent by
  Add is the text that produced the list on screen; a slower reply for an earlier file is ignored;
  a 401 or signing out clears everything from the file.
- **The route** logs who ran an import, and a failed check no longer says "could not be saved".
- **Not done: remembering erased stories.** An erased story would come back if the same file were
  added again. The panel says to delete the file once the stories are in. A suppression table in
  the stories database is a follow-up if wanted.
