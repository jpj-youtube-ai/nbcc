import { describe, it, expect } from "vitest";
import { familyFilter, parseDetectiveChange, parseFamilyChange } from "../../src/elf/admin-families";
import { cleanFirstName } from "../../src/elf/names";
import { firstNameRefusalWords } from "../../src/elf/join";

// What a head elf may change about a family in Head Elf HQ (docs/superpowers/specs/2026-11-05-elf-admin-
// design.md, decision 7): the same rules as enrolling, and a changed name is checked again. Every family
// here is invented.

/** Enrolling's own words for a first name it refuses. */
const enrollingSays = (name: string): string => {
  const r = cleanFirstName(name);
  if (r.ok) throw new Error(`enrolling takes ${name}`);
  return firstNameRefusalWords(r.reason);
};

describe("a head elf changing a detective", () => {
  it("takes a new first name and turns its tick off, so the new name is checked too", () => {
    expect(parseDetectiveChange({ firstName: "Rosa" })).toEqual({ ok: true, change: { firstName: "Rosa", approved: false } });
  });

  it("keeps the tick when the same change ticks it", () => {
    expect(parseDetectiveChange({ firstName: "Rosa", approved: true })).toEqual({ ok: true, change: { firstName: "Rosa", approved: true } });
  });

  it("takes a festive surname from the list, and turns the tick off for that too", () => {
    expect(parseDetectiveChange({ surname: "Frostwhistle" })).toEqual({ ok: true, change: { surname: "Frostwhistle", approved: false } });
  });

  it("refuses the first names enrolling refuses, in enrolling's own words, and anything not on the surname list", () => {
    for (const name of ["Ruby Mae", "", "R2D2", "Ruby🎄"]) {
      expect(parseDetectiveChange({ firstName: name }), name).toEqual({ ok: false, error: enrollingSays(name) });
    }
    expect(parseDetectiveChange({ surname: "Smith" })).toEqual({ ok: false, error: "Please choose a festive surname from the list." });
    expect(parseDetectiveChange({ firstName: "Rosa", surname: "Smith" })).toEqual({ ok: false, error: "Please choose a festive surname from the list." });
  });

  it("takes the tick, or taking it away, on its own", () => {
    expect(parseDetectiveChange({ approved: true })).toEqual({ ok: true, change: { approved: true } });
    expect(parseDetectiveChange({ approved: false })).toEqual({ ok: true, change: { approved: false } });
  });

  it("says when there is nothing to change", () => {
    for (const sent of [{}, null, "Rosa", { approved: "yes" }, { colour: "red" }]) {
      expect(parseDetectiveChange(sent), JSON.stringify(sent)).toEqual({ ok: false, error: "Nothing to change." });
    }
  });
});

describe("a head elf changing a family's details", () => {
  it("tidies the grown up's name and email", () => {
    expect(parseFamilyChange({ grownUpName: "  Sam   Example ", email: "  SAM@Example.ORG " })).toEqual({ ok: true, change: { grownUpName: "Sam Example", email: "sam@example.org" } });
    expect(parseFamilyChange({ email: "alex@example.org" })).toEqual({ ok: true, change: { email: "alex@example.org" } });
  });

  it("refuses an empty name and a broken email, in plain words", () => {
    expect(parseFamilyChange({ grownUpName: "   " })).toEqual({ ok: false, error: "Please give the grown up's name." });
    expect(parseFamilyChange({ grownUpName: "x".repeat(81) })).toEqual({ ok: false, error: "Please keep the grown up's name to 80 letters or fewer." });
    expect(parseFamilyChange({ email: "not an email" })).toEqual({ ok: false, error: "Please give an email address we can reach them at." });
  });

  it("says when there is nothing to change", () => {
    for (const sent of [{}, null, { newsletter: true }]) {
      expect(parseFamilyChange(sent), JSON.stringify(sent)).toEqual({ ok: false, error: "Nothing to change." });
    }
  });
});

describe("the Families filter", () => {
  it("knows its four filters, and reads anything else as all", () => {
    for (const f of ["all", "check", "week", "removed"]) expect(familyFilter(f)).toBe(f);
    for (const junk of [undefined, null, "", "CHECK", "removed;drop", 3, ["check"]]) expect(familyFilter(junk), String(junk)).toBe("all");
  });
});
