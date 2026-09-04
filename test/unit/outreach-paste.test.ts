import { describe, it, expect } from "vitest";
import {
  parsePastedBusinesses,
  summarisePaste,
  parseTags,
} from "../../src/outreach/paste";

// TASK-416: turning a pasted list into businesses.
//
// What arrives is whatever a person pasted, so the tests are the messes a real paste actually is:
// a spreadsheet column with tabs, a list off a website with commas, blank lines, fields in the
// wrong order, and somebody's phone number typed the way people type phone numbers.

const parse = (text: string) => parsePastedBusinesses(text);

describe("what a real paste looks like", () => {
  it("takes one business per line", () => {
    const rows = parse("Ayr Joinery Ltd\nKyle Motors\nTroon Bakery");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.businessName)).toEqual(["Ayr Joinery Ltd", "Kyle Motors", "Troon Bakery"]);
  });

  // A paste from a spreadsheet gives tabs; a paste from an email gives commas. A volunteer should
  // not have to know which they have.
  it("splits on tabs or commas without being told which", () => {
    const fields = (r: ReturnType<typeof parse>[number]) => ({
      businessName: r.businessName,
      contactEmail: r.contactEmail,
      contactPhone: r.contactPhone,
    });
    const tabbed = parse("Ayr Joinery Ltd\tjane@ayrjoinery.co.uk\t01292 000000")[0];
    const commaed = parse("Ayr Joinery Ltd, jane@ayrjoinery.co.uk, 01292 000000")[0];
    expect(fields(tabbed)).toEqual({
      businessName: "Ayr Joinery Ltd",
      contactEmail: "jane@ayrjoinery.co.uk",
      contactPhone: "01292 000000",
    });
    // The same fields either way; only the raw line they came from differs.
    expect(fields(commaed)).toEqual(fields(tabbed));
  });

  // Insisting on "name, email, phone" would mean rejecting a perfectly good list for being in the
  // wrong order, which is not a reason.
  it("does not care what order the fields are in", () => {
    const row = parse("jane@ayrjoinery.co.uk, 01292 000000, Ayr Joinery Ltd")[0];
    expect(row).toMatchObject({
      businessName: "Ayr Joinery Ltd",
      contactEmail: "jane@ayrjoinery.co.uk",
      contactPhone: "01292 000000",
    });
  });

  it("copes with a name and nothing else", () => {
    expect(parse("Ayr Joinery Ltd")[0]).toMatchObject({
      businessName: "Ayr Joinery Ltd",
      contactEmail: null,
      contactPhone: null,
    });
  });

  it("ignores blank lines rather than counting them as businesses", () => {
    expect(parse("Ayr Joinery Ltd\n\n   \nKyle Motors")).toHaveLength(2);
  });

  it("lower-cases the email so the matcher compares like with like", () => {
    expect(parse("Ayr Joinery, Jane@AyrJoinery.CO.UK")[0].contactEmail).toBe("jane@ayrjoinery.co.uk");
  });

  // People type phone numbers with spaces, brackets and country codes, and a parser that only
  // accepted one shape would silently fold half of them into the business name.
  it.each(["01292 000000", "+44 1292 000000", "(01292) 000 000", "01292-000000"])(
    "recognises %s as a phone number",
    (phone) => {
      const row = parse(`Ayr Joinery Ltd\t${phone}`)[0];
      expect(row.contactPhone).toBe(phone);
      expect(row.businessName).toBe("Ayr Joinery Ltd");
    },
  );

  // A business name with a comma in it is a real thing, and the leftover fields are its name.
  it("keeps a name that had a comma in it", () => {
    expect(parse("Smith, Sons and Daughters Ltd, info@smith.example")[0]).toMatchObject({
      businessName: "Smith, Sons and Daughters Ltd",
      contactEmail: "info@smith.example",
    });
  });

  it("remembers which line each came from, so a problem can be pointed at", () => {
    expect(parse("Ayr Joinery\n\nKyle Motors")[1].line).toBe(3);
  });
});

describe("lines it cannot use", () => {
  it("says so rather than adding a business with no name", () => {
    const row = parse("jane@ayrjoinery.co.uk")[0];
    expect(row.problem).toMatch(/no business name/i);
  });

  it("refuses a name too short to be one", () => {
    expect(parse("A")[0].problem).toMatch(/too short/i);
  });

  // One bad line must not throw away a good paste of forty.
  it("keeps the good lines alongside the bad", () => {
    const s = summarisePaste(parse("Ayr Joinery Ltd\njane@ayrjoinery.co.uk\nKyle Motors"));
    expect(s.usable).toHaveLength(2);
    expect(s.problems).toHaveLength(1);
  });
});

describe("before anything is written", () => {
  // The same firm twice in the block somebody copied. Duplicates against businesses we ALREADY
  // know are the matcher's job and run server side on every add.
  it("spots the same business listed twice in the paste itself", () => {
    const s = summarisePaste(parse("Ayr Joinery Ltd\nKyle Motors\nayr joinery ltd"));
    expect(s.duplicatedInPaste).toEqual(["ayr joinery ltd"]);
  });

  it("says nothing when every line is different", () => {
    expect(summarisePaste(parse("Ayr Joinery\nKyle Motors")).duplicatedInPaste).toEqual([]);
  });
});

describe("tags", () => {
  it("takes a comma or semicolon separated list", () => {
    expect(parseTags("Chamber, supplier; parent's business")).toEqual([
      "chamber",
      "supplier",
      "parent's business",
    ]);
  });

  // "Chamber" and "chamber" would sit as two entries in a filter list and look like a bug.
  it("treats the same tag typed differently as one", () => {
    expect(parseTags("Chamber, chamber, CHAMBER")).toEqual(["chamber"]);
  });

  it("tidies the spacing somebody typed", () => {
    expect(parseTags("  local   supplier  ")).toEqual(["local supplier"]);
  });

  it("ignores empty entries from trailing commas", () => {
    expect(parseTags("chamber,,supplier,")).toEqual(["chamber", "supplier"]);
  });

  // A tag field is not a notes field, and somebody will paste a paragraph into it.
  it("refuses a tag that is really a sentence", () => {
    expect(parseTags("x".repeat(60))).toEqual([]);
  });

  it("stops at ten, rather than accepting a wall of them", () => {
    const many = Array.from({ length: 30 }, (_, i) => `tag${i}`).join(",");
    expect(parseTags(many)).toHaveLength(10);
  });
});
