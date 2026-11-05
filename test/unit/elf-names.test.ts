import { describe, it, expect } from "vitest";
import {
  ELF_NAMES,
  FESTIVE_SURNAMES,
  SECRET_WORD_IDEAS,
  cleanFirstName,
  detectiveName,
  detectiveNames,
  familyDetectiveName,
  isFestiveSurname,
  secretWord,
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
  /** A source of chance that gives these answers in turn. */
  const chance = (...answers: number[]) => {
    let i = 0;
    return () => answers[i++ % answers.length];
  };

  it("is an idea and a three digit number that never starts with a nought", () => {
    const last = SECRET_WORD_IDEAS[SECRET_WORD_IDEAS.length - 1];
    expect(secretWord(chance(0, 0))).toBe("SNOWBALL 100");
    expect(secretWord(chance(0.999999, 0.999999))).toBe(`${last} 999`);
    expect(secretWord(chance(0, 0.4134))).toBe("SNOWBALL 472");
  });

  it("is different almost every time when it is given real chance, and always fit for a tag", () => {
    const made = Array.from({ length: 200 }, () => secretWord(Math.random));
    expect(new Set(made).size).toBeGreaterThan(150);
    for (const word of made) expect(isUsableSecretWord(word ?? "")).toBe(true);
  });

  it("makes nothing, never a made up word, when the source of chance is not one", () => {
    for (const broken of [1, 1.5, -0.1, Number.NaN, "0.5", undefined]) {
      expect(secretWord(() => broken as unknown as number), String(broken)).toBeNull();
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
    expect(cleanFirstName("Bollocks-Ruby")).toEqual({ ok: false, reason: "blocked" });
  });

  it("refuses the worst words wherever they sit in a name", () => {
    expect(cleanFirstName("Rubybitch")).toEqual({ ok: false, reason: "blocked" });
    expect(cleanFirstName("Twatty")).toEqual({ ok: false, reason: "blocked" });
    expect(cleanFirstName("Hitler")).toEqual({ ok: false, reason: "blocked" });
  });

  it("still takes real names that only look as if they hold a rude word", () => {
    for (const name of ["Harshit", "Akshita", "Ishita", "Nigel", "Nazia", "Scarlett", "Cassandra"]) {
      expect(cleanFirstName(name), name).toEqual({ ok: true, name });
    }
  });

  it("allows one hyphen or apostrophe, so a sentence cannot be strung together", () => {
    expect(cleanFirstName("Santa-is-fake")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("Ruby-Smith-Annbank")).toEqual({ ok: false, reason: "letters-only" });
    expect(cleanFirstName("O'Neil")).toEqual({ ok: true, name: "O'Neil" });
  });

  it("takes names from across Europe, accents and all", () => {
    const names = ["Seán", "Zoë", "Łukasz", "Michał", "Søren", "Ngọc", "François", "Björn", "Æsa"];
    for (const name of names) expect(cleanFirstName(name), name).toEqual({ ok: true, name });
  });

  it("asks for the letters A to Z when a name is in another alphabet, which the checks cannot read", () => {
    const cyrillic = `Fu${String.fromCharCode(0x0441)}k`; // looks like a rude word, with one Russian letter
    const russian = String.fromCharCode(0x0420, 0x0443, 0x0431, 0x0438);
    const chinese = String.fromCharCode(0x7ea2, 0x5b9d);
    const smallCapitals = String.fromCharCode(0xa730, 0x1d1c, 0x1d04, 0x1d0b);
    for (const name of [cyrillic, russian, chinese, smallCapitals]) {
      expect(cleanFirstName(name), name).toEqual({ ok: false, reason: "a-to-z" });
    }
  });

  it("reads wide and fancy letters as the plain ones, then checks them like any other", () => {
    const wide = String.fromCharCode(0xff32, 0xff55, 0xff42, 0xff59); // "Ruby" in wide letters
    const boldRude = [0x1d41f, 0x1d42e, 0x1d41c, 0x1d424].map((c) => String.fromCodePoint(c)).join("");
    const dotless = `Sh${String.fromCharCode(0x0131)}t`;
    expect(cleanFirstName(wide)).toEqual({ ok: true, name: "Ruby" });
    expect(cleanFirstName(boldRude)).toEqual({ ok: false, reason: "blocked" });
    expect(cleanFirstName(dotless)).toEqual({ ok: false, reason: "blocked" });
  });

  it("refuses a letter that draws as nothing, alone or hidden inside a name", () => {
    const blank = String.fromCharCode(0x3164);
    expect(cleanFirstName(blank).ok).toBe(false);
    expect(cleanFirstName(`Ruby${blank}Smith`).ok).toBe(false);
  });
});

describe("how a detective appears in public", () => {
  const ruby = { firstName: "Ruby", surname: "Tinselfoot", approved: true };
  const sam = { firstName: "Sam", surname: "Snowsleuth", approved: true };
  const mia = { firstName: "Mia", surname: "Gingersnap", approved: true };

  it("is Detective, the first name, then the festive surname, once staff have ticked the name", () => {
    expect(detectiveName(ruby)).toBe("Detective Ruby Tinselfoot");
  });

  it("is only the first letter until staff have ticked the name", () => {
    expect(detectiveName({ ...ruby, approved: false })).toBe("Detective R. Tinselfoot");
    expect(detectiveName({ firstName: "mike-hunt", surname: "Snowsleuth", approved: false })).toBe("Detective M. Snowsleuth");
    expect(detectiveName({ ...ruby, approved: "yes" as unknown as boolean })).toBe("Detective R. Tinselfoot");
  });

  it("checks the first name again, whatever was saved, and shows none of one that fails", () => {
    expect(detectiveName({ firstName: "Ruby Smith", surname: "Tinselfoot", approved: true })).toBe("Detective Tinselfoot");
    expect(detectiveName({ firstName: "<b>Ruby</b>", surname: "Tinselfoot", approved: true })).toBe("Detective Tinselfoot");
    expect(detectiveName({ firstName: "", surname: "Tinselfoot", approved: true })).toBe("Detective Tinselfoot");
  });

  it("shows no surname that is not on the list", () => {
    expect(detectiveName({ firstName: "Ruby", surname: "Smith", approved: true })).toBe("Detective Ruby");
    expect(detectiveName({ firstName: "Ruby", surname: "Smith", approved: false })).toBe("Detective R.");
    expect(detectiveName({ firstName: "", surname: "", approved: true })).toBe("A detective");
  });

  it("joins a family's detectives into one line", () => {
    expect(detectiveNames([ruby])).toBe("Detective Ruby Tinselfoot");
    expect(detectiveNames([ruby, sam])).toBe("Detectives Ruby Tinselfoot and Sam Snowsleuth");
    expect(detectiveNames([ruby, sam, mia])).toBe("Detectives Ruby Tinselfoot, Sam Snowsleuth and Mia Gingersnap");
    expect(detectiveNames([ruby, { ...sam, approved: false }])).toBe("Detectives Ruby Tinselfoot and S. Snowsleuth");
    expect(detectiveNames([])).toBe("");
    expect(detectiveNames([{ firstName: "", surname: "", approved: true }])).toBe("A detective");
  });
});

describe("how a detective appears to their own family", () => {
  it("is the whole name, ticked or not, because the family typed it", () => {
    expect(familyDetectiveName({ firstName: "Ruby", surname: "Tinselfoot", approved: false })).toBe("Detective Ruby Tinselfoot");
  });

  it("still shows nothing of a first name that fails the checks", () => {
    expect(familyDetectiveName({ firstName: "Ruby Smith", surname: "Tinselfoot", approved: false })).toBe("Detective Tinselfoot");
  });
});
