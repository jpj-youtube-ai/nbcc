import { describe, it, expect } from "vitest";
import {
  ELF_NAMES,
  FESTIVE_SURNAMES,
  SECRET_WORD_IDEAS,
  cleanFirstName,
  detectiveName,
  detectiveNames,
  isFestiveSurname,
  secretWordFrom,
} from "../../src/elf/names";
import { isUsableSecretWord, normaliseWord } from "../../src/elf/claim";
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

  it("shares no word with the elves' names, which everyone can see", () => {
    const elves = new Set(ELF_NAMES.map((n) => n.toUpperCase()));
    expect(SECRET_WORD_IDEAS.filter((w) => elves.has(w))).toEqual([]);
  });

  it("is only half a secret word: the list is public, so a tag needs a number too", () => {
    for (const w of SECRET_WORD_IDEAS) {
      expect(isUsableSecretWord(w), w).toBe(false);
      expect(isUsableSecretWord(`${w} 472`), w).toBe(true);
    }
  });
});

describe("a secret word for a tag", () => {
  it("is an idea and a three digit number that never starts with a nought", () => {
    expect(secretWordFrom(0, 372)).toBe("SNOWBALL 472");
    expect(secretWordFrom(1, 0)).toBe(`${SECRET_WORD_IDEAS[1]} 100`);
    expect(secretWordFrom(2, 899)).toBe(`${SECRET_WORD_IDEAS[2]} 999`);
  });

  it("wraps whatever numbers it is given, so it always answers", () => {
    const last = SECRET_WORD_IDEAS[SECRET_WORD_IDEAS.length - 1];
    expect(secretWordFrom(SECRET_WORD_IDEAS.length, 900)).toBe("SNOWBALL 100");
    expect(secretWordFrom(-1, -1)).toBe(`${last} 999`);
    expect(secretWordFrom(Number.NaN, Number.POSITIVE_INFINITY)).toBe("SNOWBALL 100");
    expect(secretWordFrom(0.9, 372.9)).toBe("SNOWBALL 472");
  });

  it("can always go on a tag", () => {
    for (let pick = 0; pick < SECRET_WORD_IDEAS.length; pick++) {
      for (const number of [0, 450, 899]) expect(isUsableSecretWord(secretWordFrom(pick, number))).toBe(true);
    }
  });
});

describe("a detective's first name", () => {
  it("tidies the spaces round it", () => {
    expect(cleanFirstName("  Ruby ")).toEqual({ ok: true, name: "Ruby" });
  });

  it("takes accents, hyphens and apostrophes", () => {
    expect(cleanFirstName("Zoë")).toEqual({ ok: true, name: "Zoë" });
    expect(cleanFirstName("Lily-Mae")).toEqual({ ok: true, name: "Lily-Mae" });
    expect(cleanFirstName("D'Arcy")).toEqual({ ok: true, name: "D'Arcy" });
  });

  it("takes what a phone types: a curly apostrophe, a long hyphen, an accent sent as its own mark", () => {
    const curly = String.fromCharCode(0x2019);
    const longHyphen = String.fromCharCode(0x2011);
    const accentAlone = String.fromCharCode(0x0308);
    const composed = `Zo${String.fromCharCode(0xeb)}`;
    expect(cleanFirstName(`D${curly}Arcy`)).toEqual({ ok: true, name: "D'Arcy" });
    expect(cleanFirstName(`Lily${longHyphen}Mae`)).toEqual({ ok: true, name: "Lily-Mae" });
    expect(cleanFirstName(`Zoe${accentAlone}`)).toEqual({ ok: true, name: composed });
  });

  it("refuses two words, so a surname typed after the first name is never shown", () => {
    expect(cleanFirstName("Ruby Smith")).toEqual({ ok: false, reason: "one-word" });
    expect(cleanFirstName("Mary   Kate")).toEqual({ ok: false, reason: "one-word" });
    expect(cleanFirstName("Mary-Kate")).toEqual({ ok: true, name: "Mary-Kate" });
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

  it("refuses digits, symbols, and a name that does not start and end with a letter", () => {
    expect(cleanFirstName("Ruby7")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("Ruby<3")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("-Ruby")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("Ruby-")).toEqual({ ok: false, reason: "letters-only" });
  });

  it("refuses a word the public name filter blocks", () => {
    expect(cleanFirstName("Bollocks")).toEqual({ ok: false, reason: "blocked" });
  });

  it("refuses a blocked word however it is hyphenated or accented", () => {
    const accented = `Boll${String.fromCharCode(0xf6)}cks`;
    expect(cleanFirstName("Bol-locks")).toEqual({ ok: false, reason: "blocked" });
    expect(cleanFirstName("Bol'locks")).toEqual({ ok: false, reason: "blocked" });
    expect(cleanFirstName(accented)).toEqual({ ok: false, reason: "blocked" });
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
