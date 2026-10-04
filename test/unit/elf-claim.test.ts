import { describe, it, expect } from "vitest";
import { decideClaim, earliest, normaliseWord, type ClaimContext } from "../../src/elf/claim";

// NBCC Elf Detective School: claiming an elf with its secret word. Every id and word is invented.

describe("the secret word", () => {
  it("ignores capitals, spaces and punctuation", () => {
    expect(normaliseWord(" Snow Ball! ")).toBe("snowball");
    expect(normaliseWord("SNOW-BALL")).toBe("snowball");
    expect(normaliseWord("snowball")).toBe("snowball");
  });

  it("keeps digits", () => {
    expect(normaliseWord("Elf 24")).toBe("elf24");
  });

  it("treats nothing typed as an empty word", () => {
    expect(normaliseWord("")).toBe("");
    expect(normaliseWord(undefined as unknown as string)).toBe("");
  });
});

describe("claiming an elf", () => {
  const ctx: ClaimContext = {
    doorState: "hunting",
    secretWord: "Snowball",
    familyDetectiveIds: ["d1", "d2"],
    familyHasWon: false,
  };
  const claim = { detectiveIds: ["d1"], word: "snowball" };

  it("accepts the right word from a family's own detectives", () => {
    expect(decideClaim(ctx, claim)).toEqual({ ok: true });
    expect(decideClaim(ctx, { detectiveIds: ["d1", "d2"], word: " SNOW ball " })).toEqual({ ok: true });
  });

  it("accepts a claim on a revealed door, because the elf is still waiting", () => {
    expect(decideClaim({ ...ctx, doorState: "revealed" }, claim)).toEqual({ ok: true });
  });

  it("refuses before the clue is out", () => {
    expect(decideClaim({ ...ctx, doorState: "shut" }, claim)).toEqual({ ok: false, reason: "too-early" });
  });

  it("refuses once the elf has been found", () => {
    expect(decideClaim({ ...ctx, doorState: "found" }, claim)).toEqual({ ok: false, reason: "already-found" });
  });

  it("refuses with no detective chosen", () => {
    expect(decideClaim(ctx, { detectiveIds: [], word: "snowball" })).toEqual({ ok: false, reason: "no-detectives" });
  });

  it("refuses a detective from another family", () => {
    expect(decideClaim(ctx, { detectiveIds: ["d1", "d9"], word: "snowball" })).toEqual({
      ok: false,
      reason: "not-your-detective",
    });
  });

  it("refuses the wrong word, and an elf with no word set", () => {
    expect(decideClaim(ctx, { detectiveIds: ["d1"], word: "snowman" })).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim(ctx, { detectiveIds: ["d1"], word: "" })).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim({ ...ctx, secretWord: "" }, { detectiveIds: ["d1"], word: "" })).toEqual({
      ok: false,
      reason: "wrong-word",
    });
  });

  it("refuses a family that has already won an elf, even with the right word", () => {
    expect(decideClaim({ ...ctx, familyHasWon: true }, claim)).toEqual({ ok: false, reason: "already-won" });
  });
});

describe("who was first", () => {
  const a = { family: "a", at: new Date("2026-12-07T17:47:03.000Z") };
  const b = { family: "b", at: new Date("2026-12-07T17:47:01.000Z") };
  const c = { family: "c", at: new Date("2026-12-07T17:47:01.000Z") };

  it("picks the earliest claim", () => {
    expect(earliest([a, b])).toBe(b);
  });

  it("keeps the order they arrived in when two claims share a moment", () => {
    expect(earliest([a, b, c])).toBe(b);
    expect(earliest([c, b])).toBe(c);
  });

  it("has no winner with no claims", () => {
    expect(earliest([])).toBeNull();
  });
});
