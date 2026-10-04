import { describe, it, expect } from "vitest";
import { FACTS, factFor } from "../../src/elf/facts";

// NBCC Elf Detective School: the 24 facts Jaimie approved on 4 October 2026, one for each door, with
// a short line for children. These tests hold the house style, and a fingerprint of the wording so
// that it cannot change by accident.

describe("the 24 facts", () => {
  it("has one for each door, in order", () => {
    expect(FACTS.map((f) => f.door)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("gives every fact a title, a fact for the grown up's email and a line for the door", () => {
    for (const f of FACTS) {
      expect(f.title.trim(), `door ${f.door} title`).not.toBe("");
      expect(f.grownUp.trim(), `door ${f.door} fact`).not.toBe("");
      expect(f.doorLine.trim(), `door ${f.door} door line`).not.toBe("");
    }
  });

  it("keeps the door line short enough to sit on a door", () => {
    for (const f of FACTS) expect(f.doorLine.length, `door ${f.door}`).toBeLessThanOrEqual(80);
  });

  it("keeps the email fact to a few sentences", () => {
    for (const f of FACTS) expect(f.grownUp.length, `door ${f.door}`).toBeLessThanOrEqual(320);
  });

  it("uses no dash or hyphen of any kind, anywhere", () => {
    for (const f of FACTS) {
      const text = `${f.title} ${f.grownUp} ${f.doorLine}`;
      expect(text, `door ${f.door}`).not.toMatch(/\p{Pd}/u);
    }
  });

  it("is the wording Jaimie approved, to the letter", () => {
    // A fingerprint of every word of every fact. If this fails, the wording has changed. Change the
    // wording only with Jaimie's yes, and then put the new fingerprint here in the same commit.
    let hash = 0x811c9dc5;
    for (const ch of JSON.stringify(FACTS.map((f) => [f.door, f.title, f.grownUp, f.doorLine]))) {
      hash ^= ch.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    expect(hash.toString(16)).toBe("cb11c500");
  });

  it("cannot be changed by anything that reads it", () => {
    expect(Object.isFrozen(FACTS)).toBe(true);
    expect(() => {
      (factFor(1) as { title: string }).title = "x";
    }).toThrow();
    expect(factFor(1)?.title).toBe("It started with a question");
  });

  it("writes the building one way", () => {
    const all = FACTS.map((f) => `${f.title} ${f.grownUp} ${f.doorLine}`).join(" ");
    const spellings = all.match(/\bel(?:f|ve)[^\s<>]{0,12}\s+workshop/gi) ?? [];
    expect(spellings.length).toBeGreaterThan(0);
    expect(spellings.filter((s) => s !== "Elves' Workshop")).toEqual([]);
  });
});

describe("looking a fact up", () => {
  it("finds the fact for a door", () => {
    expect(factFor(7)?.title).toBe("7,657 Red Bags");
    expect(factFor(24)?.title).toBe("The Night Before Christmas");
  });

  it("has nothing for a number that is not a door", () => {
    expect(factFor(0)).toBeNull();
    expect(factFor(25)).toBeNull();
  });
});
