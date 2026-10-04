import { describe, it, expect } from "vitest";
import {
  ELF_NAMES,
  FESTIVE_SURNAMES,
  SECRET_WORD_IDEAS,
  cleanFirstName,
  detectiveName,
  detectiveNames,
  isFestiveSurname,
} from "../../src/elf/names";
import { normaliseWord } from "../../src/elf/claim";
import { containsBlockedWord } from "../../src/donors/display-name-filter";

// NBCC Elf Detective School: the names children appear by. Every first name here is invented.

describe("the festive surnames a detective picks from", () => {
  it("offers plenty, each a single word of letters, with no repeats", () => {
    expect(FESTIVE_SURNAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FESTIVE_SURNAMES).size).toBe(FESTIVE_SURNAMES.length);
    for (const s of FESTIVE_SURNAMES) expect(s).toMatch(/^[A-Z][a-z]+$/);
  });

  it("offers nothing the public name filter would refuse", () => {
    expect(FESTIVE_SURNAMES.filter((s) => containsBlockedWord(s))).toEqual([]);
  });

  it("knows its own list", () => {
    expect(isFestiveSurname("Tinselfoot")).toBe(true);
    expect(isFestiveSurname("tinselfoot")).toBe(false);
    expect(isFestiveSurname("Smith")).toBe(false);
  });
});

describe("the elves", () => {
  it("has a different name for each of the 24 doors", () => {
    expect(ELF_NAMES.length).toBe(24);
    expect(new Set(ELF_NAMES).size).toBe(24);
    for (const n of ELF_NAMES) expect(n).toMatch(/^[A-Z][a-z]+$/);
    expect(ELF_NAMES.filter((n) => containsBlockedWord(n))).toEqual([]);
  });
});

describe("secret word ideas", () => {
  it("offers at least one for every door, each a single word in capitals that survives typing", () => {
    expect(SECRET_WORD_IDEAS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(SECRET_WORD_IDEAS).size).toBe(SECRET_WORD_IDEAS.length);
    for (const w of SECRET_WORD_IDEAS) {
      expect(w).toMatch(/^[A-Z]{4,11}$/);
      expect(normaliseWord(w)).toBe(w.toLowerCase());
    }
  });
});

describe("a detective's first name", () => {
  it("tidies the spaces round and inside it", () => {
    expect(cleanFirstName("  Ruby ")).toEqual({ ok: true, name: "Ruby" });
    expect(cleanFirstName("Mary   Kate")).toEqual({ ok: true, name: "Mary Kate" });
  });

  it("takes accents, hyphens and apostrophes", () => {
    expect(cleanFirstName("Zoë")).toEqual({ ok: true, name: "Zoë" });
    expect(cleanFirstName("Lily-Mae")).toEqual({ ok: true, name: "Lily-Mae" });
    expect(cleanFirstName("D'Arcy")).toEqual({ ok: true, name: "D'Arcy" });
  });

  it("refuses nothing at all", () => {
    expect(cleanFirstName("")).toEqual({ ok: false, reason: "empty" });
    expect(cleanFirstName("   ")).toEqual({ ok: false, reason: "empty" });
    expect(cleanFirstName(undefined)).toEqual({ ok: false, reason: "empty" });
    expect(cleanFirstName(42)).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses more than 20 characters", () => {
    expect(cleanFirstName("A".repeat(20))).toEqual({ ok: true, name: "A".repeat(20) });
    expect(cleanFirstName("A".repeat(21))).toEqual({ ok: false, reason: "too-long" });
  });

  it("refuses digits, symbols, and a name that does not start with a letter", () => {
    expect(cleanFirstName("Ruby7")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("Ruby <3")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("-Ruby")).toEqual({ ok: false, reason: "letters-only" });
  });

  it("refuses a word the public name filter blocks", () => {
    expect(cleanFirstName("Bollocks")).toEqual({ ok: false, reason: "blocked" });
  });
});

describe("how a detective appears", () => {
  it("is Detective, the first name, then the festive surname", () => {
    expect(detectiveName("Ruby", "Tinselfoot")).toBe("Detective Ruby Tinselfoot");
  });

  it("joins a family's detectives into one line", () => {
    const ruby = { firstName: "Ruby", surname: "Tinselfoot" };
    const sam = { firstName: "Sam", surname: "Snowsleuth" };
    const mia = { firstName: "Mia", surname: "Gingersnap" };
    expect(detectiveNames([ruby])).toBe("Detective Ruby Tinselfoot");
    expect(detectiveNames([ruby, sam])).toBe("Detectives Ruby Tinselfoot and Sam Snowsleuth");
    expect(detectiveNames([ruby, sam, mia])).toBe("Detectives Ruby Tinselfoot, Sam Snowsleuth and Mia Gingersnap");
    expect(detectiveNames([])).toBe("");
  });
});
