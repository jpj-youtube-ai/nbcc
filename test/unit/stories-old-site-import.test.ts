import { describe, it, expect } from "vitest";
import {
  parseCsv,
  readOldSiteExport,
  planImport,
  previewOf,
  lookupsFor,
  storyKey,
  erasedFingerprint,
  ERASED_EARLIER,
  openingOf,
  dayInWords,
  MAX_STORY_LENGTH,
  type OldSiteRow,
} from "../../src/stories/old-site-import";
import { MAX_ADMIN_NOTES_LENGTH } from "../../src/stories/schema";

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

type Answers = Partial<
  Record<
    | "sent"
    | "story"
    | "quote"
    | "isPublic"
    | "name"
    | "town"
    | "internal"
    | "feedback"
    | "first"
    | "email"
    | "phone"
    | "age"
    | "gender"
    | "place"
    | "bag"
    | "heard"
    | "over16",
    string
  >
>;

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
const line = (cells: string[]) => cells.map(cell).join(",");
const csv = (...rows: string[][]) => [HEADER, ...rows].map(line).join("\r\n") + "\r\n";

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
    const result = readOldSiteExport(`${line(HEADER.filter((h) => h !== "Your story"))}\r\n`);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/no "Your story" column/);
  });

  it("refuses an empty file", () => {
    expect(readOldSiteExport("")).toEqual({ ok: false, error: "That file is empty." });
  });
});

describe("each answer, mapped", () => {
  it("keeps a public story's words exactly, with the date it was sent as when consent was given", () => {
    const [{ story }] = plan(
      csv(answers({ story: "Line one.\r\nLine two.  ", quote: "Christmas Eve felt like magic again " })),
    ).add;
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
    const bands: Array<[string, string | null]> = [
      ["16 to 24", "16_24"],
      ["25 to 44", "25_44"],
      ["45 to 64", "45_64"],
      ["65+", "65_plus"],
      ["Prefer not to say", null],
    ];
    for (const [age, band] of bands) {
      expect(plan(csv(answers({ age }))).add[0].story.age_band, age).toBe(band);
    }
  });

  it("reads who the Red Bag went to", () => {
    const types: Array<[string, string | null]> = [
      ["Child", "child"],
      ["Young person", "young_person"],
      ["Vulnerable adult", "vulnerable_adult"],
      ["", null],
    ];
    for (const [bag, type] of types) {
      expect(plan(csv(answers({ bag }))).add[0].story.recipient_type, bag).toBe(type);
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

  it("says in the notes why someone is marked happy to be contacted, and says nothing when they are not", () => {
    expect(plan(csv(answers())).add[0].story.admin_notes).toContain(
      `Marked happy to be contacted: the old form asked for an email or phone number "just in case you're happy for us to contact you about your story", and they gave one.`,
    );
    expect(plan(csv(answers({ email: "", phone: "" }))).add[0].story.admin_notes).not.toContain("happy to be contacted");
  });

  // The admin's own limit on notes is what staff save against: an import past it would leave a
  // story whose status and tags could never be changed again.
  it("keeps the notes within the admin's own limit, however much they wrote", () => {
    const [{ story }] = plan(csv(answers({ feedback: "word ".repeat(1500).trim(), email: "x".repeat(400) }))).add;
    expect(story.admin_notes.length).toBeLessThanOrEqual(MAX_ADMIN_NOTES_LENGTH);
    expect(story.admin_notes).toContain("(shortened to fit)");
    expect(story.admin_notes).toMatch(/^Brought in from the old website's My Story form on /);
  });

  it("shares no name or town for a story kept within the charity, whatever those answers said", () => {
    const [{ story }] = plan(csv(answers({ isPublic: "No", internal: "Yes", name: "Yes", town: "Yes" }))).add;
    expect(story.use_scope).toBe("internal_only");
    expect(story.consent_share_first_name).toBe(false);
    expect(story.consent_share_town).toBe(false);
  });

  it("notes where it came from, with both dates in words, and anything else they wrote", () => {
    const [{ story }] = plan(csv(answers({ feedback: "Keep it up", email: "", phone: "" }))).add;
    expect(story.admin_notes).toBe(
      `Brought in from the old website's My Story form on 30 September 2026. They sent it on 6 July 2026. They also wrote: "Keep it up"`,
    );
  });

  it("keeps a long quote as they wrote it", () => {
    const long = "word ".repeat(70).trim();
    const [{ story }] = plan(csv(answers({ quote: long }))).add;
    expect(story.short_quote).toBe(long);
    expect(story.admin_notes).not.toContain(long);
  });
});

describe("a damaged file", () => {
  it("is refused whole when a quotation mark is never closed, rather than losing the rows after it", () => {
    expect(() => parseCsv('a,b\r\n"1,2\r\n3,4\r\n')).toThrow(/never closed/);
    const result = readOldSiteExport(csv(answers()) + '2026-07-06T19:30:12.345Z,"An unfinished story,,,\r\n');
    expect(result).toEqual({
      ok: false,
      error:
        "That file looks damaged: a quotation mark in submission 2 is never closed, so it can't be read safely. Please export it from the old website again.",
    });
  });

  it("leaves out a row with more or fewer answers than the form has, because its answers may have shifted", () => {
    const tooMany = [...answers(), "extra"];
    const tooFew = answers().slice(0, 12);
    const reasons = plan(csv(tooMany, tooFew)).skip.map((s) => s.reason);
    expect(reasons).toEqual([
      "It has 18 answers where the form has 17, so it may be damaged. It isn't added: check it in the file.",
      "It has 12 answers where the form has 17, so it may be damaged. It isn't added: check it in the file.",
    ]);
  });
});

describe("rows that are not added, and why", () => {
  const reasons = (text: string, here?: Set<string>) => plan(text, here).skip.map((s) => s.reason);

  it("keeps only the later of two sent by the same email within the hour, saying how soon", () => {
    const p = plan(
      csv(
        answers({ sent: "2026-07-02T10:02:20.000Z", story: "Second go." }),
        answers({ sent: "2026-07-02T10:00:00.000Z", story: "First go." }),
      ),
    );
    expect(p.add.map((a) => a.story.story_text)).toEqual(["Second go."]);
    expect(p.skip.map((s) => s.reason)).toEqual(["They sent it again 2 minutes later, so this earlier one is left out."]);
    // The words may differ between the two, so whoever reads the story later knows there was another.
    expect(p.add[0].story.admin_notes).toContain("They sent an earlier version 2 minutes before this one, which isn't added.");
  });

  // Their last word stands even when it takes the story back: an earlier yes is not added over it.
  it("lets a later go that withdraws consent win over an earlier one that gave it", () => {
    const p = plan(
      csv(
        answers({ sent: "2026-07-02T10:02:20.000Z", story: "Second go.", isPublic: "No", internal: "No" }),
        answers({ sent: "2026-07-02T10:00:00.000Z", story: "First go." }),
      ),
    );
    expect(p.add).toEqual([]);
    expect(p.skip.map((s) => s.reason)).toEqual([
      "They didn't agree to their story being used, publicly or within the charity.",
      "They sent it again 2 minutes later, so this earlier one is left out.",
    ]);
  });

  it("treats the same mistyped email as the same person", () => {
    const p = plan(
      csv(
        answers({ sent: "2026-07-02T10:02:20.000Z", story: "Second go.", email: "morag at example" }),
        answers({ sent: "2026-07-02T10:00:00.000Z", story: "First go.", email: "Morag At Example " }),
      ),
    );
    expect(p.add.map((a) => a.story.story_text)).toEqual(["Second go."]);
  });

  it("leaves each earlier go out when someone sent it three times across two hours", () => {
    const p = plan(
      csv(
        answers({ sent: "2026-07-02T11:40:00Z", story: "Third go." }),
        answers({ sent: "2026-07-02T10:50:00Z", story: "Second go." }),
        answers({ sent: "2026-07-02T10:00:00Z", story: "First go." }),
      ),
    );
    expect(p.add.map((a) => a.story.story_text)).toEqual(["Third go."]);
    expect(p.skip.map((s) => s.reason)).toEqual([
      "They sent it again 50 minutes later, so this earlier one is left out.",
      "They sent it again 50 minutes later, so this earlier one is left out.",
    ]);
  });

  it("says how many earlier versions there were when someone sent it three times", () => {
    const p = plan(
      csv(
        answers({ sent: "2026-07-03T09:10:00Z", story: "Third go." }),
        answers({ sent: "2026-07-03T09:05:00Z", story: "Second go." }),
        answers({ sent: "2026-07-03T09:00:00Z", story: "First go." }),
      ),
    );
    expect(p.add.map((a) => a.story.story_text)).toEqual(["Third go."]);
    expect(p.add[0].story.admin_notes).toMatch(/ They sent 2 earlier versions in the hour before this one, which aren't added\.$/);
  });

  it("adds both when the same email wrote twice a day apart", () => {
    const p = plan(
      csv(answers({ sent: "2026-07-02T10:00:00Z", story: "Two." }), answers({ sent: "2026-07-01T10:00:00Z", story: "One." })),
    );
    expect(p.add).toHaveLength(2);
  });

  it("never merges rows with no email", () => {
    const p = plan(
      csv(
        answers({ email: "", first: "A", sent: "2026-07-01T10:01:00Z" }),
        answers({ email: "", first: "B", sent: "2026-07-01T10:00:00Z" }),
      ),
    );
    expect(p.add).toHaveLength(2);
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
    expect(reasons(csv(answers({ story: "x".repeat(MAX_STORY_LENGTH + 1) })))[0]).toMatch(/over 20,000 characters/);
  });

  // A date is only used when it cannot mean anything else: "05/07" could be July or May, a time with
  // no zone could be an hour out in summer, and a year like 0000 is not a real submission.
  it("never guesses a date", () => {
    for (const sent of ["05/07/2026 14:10", "2026-07-05 14:10:30", "2026-07-05T14:10:30", "0000-07-05T14:10:30Z", "2999-07-05T14:10:30Z"]) {
      expect(reasons(csv(answers({ sent }))), sent).toEqual(["The date it was sent can't be read for certain, so it isn't added."]);
    }
    expect(plan(csv(answers({ sent: "2026-07-06T20:30:12+01:00" }))).add[0].story.created_at).toBe("2026-07-06T19:30:12.000Z");
  });

  // Planning runs inside the web server, so a large file must not hold it up.
  it("plans a very large file quickly", () => {
    const many = Array.from({ length: 20_000 }, (_, i) =>
      answers({ sent: new Date(Date.UTC(2026, 0, 1) + i * 300_000).toISOString(), email: `person${i}@example.com` }),
    );
    const started = Date.now();
    expect(plan(csv(...many)).add).toHaveLength(20_000);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);
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

// TASK-475: a story erased from the admin is remembered by a one way fingerprint, so adding the same
// old export again never brings it back.
describe("a story erased earlier", () => {
  const SENT = "2026-07-06T19:30:12.345Z";
  const WORDS = "The Red Bag made our Christmas.";
  const erased = new Set([storyKey(SENT, WORDS)]);

  it("is left out, saying so plainly", () => {
    const p = planImport(read(csv(answers(), answers({ sent: "2026-07-07T09:00:00Z", first: "Callum", email: "callum@example.com" }))), new Set(), ON, erased);
    expect(p.add.map((a) => a.row.row)).toEqual([2]);
    expect(p.skip.map((s) => s.reason)).toEqual([ERASED_EARLIER]);
    expect(ERASED_EARLIER).toBe("It was erased earlier, so it isn't added again.");
  });

  it("shows in the preview among the rows left out", () => {
    const preview = previewOf(planImport(read(csv(answers())), new Set(), ON, erased));
    expect(preview.adding).toEqual([]);
    expect(preview.skipping).toEqual([
      { row: 1, sentOn: "6 July 2026", firstName: "Morag", town: "Irvine", reason: ERASED_EARLIER },
    ]);
  });

  it("says it is already here, rather than erased, when it is somehow both", () => {
    const p = planImport(read(csv(answers())), erased, ON, erased);
    expect(p.skip.map((s) => s.reason)).toEqual(["It's already in the stories list."]);
  });

  it("is the same story only when sent at the same moment in the same words", () => {
    const p = planImport(read(csv(answers({ sent: "2026-07-06T19:30:13.345Z" }), answers({ story: `${WORDS} Again.`, email: "other@example.com" }))), new Set(), ON, erased);
    expect(p.add).toHaveLength(2);
  });
});

describe("the fingerprint an erased story leaves", () => {
  it("is a sha256 of the moment and the words: 64 hex characters, nothing readable", () => {
    const f = erasedFingerprint("2026-07-06T19:30:12.345Z", "The Red Bag made our Christmas.");
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(f).not.toMatch(/red|bag|christmas/i);
  });

  it("is the same from a date or its text, and different for different words or moments", () => {
    const f = erasedFingerprint("2026-07-06T19:30:12.345Z", "A");
    expect(erasedFingerprint(new Date("2026-07-06T19:30:12.345Z"), "A")).toBe(f);
    expect(erasedFingerprint("2026-07-06T19:30:12.346Z", "A")).not.toBe(f);
    expect(erasedFingerprint("2026-07-06T19:30:12.345Z", "B")).not.toBe(f);
  });
});
