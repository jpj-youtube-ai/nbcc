import { describe, it, expect } from "vitest";
import { MAX_WRONG_WORDS, decideClaim, isUsableSecretWord, normaliseWord, type ClaimContext } from "../../src/elf/claim";

// NBCC Elf Detective School: claiming an elf with its secret word. Every id and word is invented.

describe("the secret word", () => {
  it("ignores capitals, spaces and punctuation", () => {
    expect(normaliseWord(" Snow Ball! ")).toBe("snowball");
    expect(normaliseWord("SNOW-BALL")).toBe("snowball");
    expect(normaliseWord("snowball")).toBe("snowball");
  });

  it("keeps digits", () => {
    expect(normaliseWord("Tinsel 38")).toBe("tinsel38");
  });

  it("folds accents away rather than dropping the letter", () => {
    expect(normaliseWord("Café")).toBe("cafe");
    expect(normaliseWord("NOËL")).toBe("noel");
  });

  it("treats nothing typed as an empty word", () => {
    expect(normaliseWord("")).toBe("");
    expect(normaliseWord(undefined as unknown as string)).toBe("");
  });

  it("can go on a tag only with a letter and a number in it, and at least four characters once tidied", () => {
    expect(isUsableSecretWord("TINSEL 38")).toBe(true);
    expect(isUsableSecretWord("Noël 12")).toBe(true);
    expect(isUsableSecretWord("e123")).toBe(true);
  });

  it("cannot go on a tag as a word on its own, because the list of word ideas is public", () => {
    expect(isUsableSecretWord("SNOWBALL")).toBe(false);
    expect(isUsableSecretWord("2026")).toBe(false);
    expect(isUsableSecretWord("e1")).toBe(false);
    expect(isUsableSecretWord("!!!")).toBe(false);
    expect(isUsableSecretWord("")).toBe(false);
  });
});

describe("claiming an elf", () => {
  const ctx: ClaimContext = {
    doorState: "hunting",
    secretWord: "Snowball 47",
    familyDetectiveIds: ["d1", "d2"],
    familyHasWon: false,
    wrongTries: 0,
  };
  const right = { detectiveIds: ["d1"], word: "snowball 47" };
  const wrong = { detectiveIds: ["d1"], word: "snowman 12" };

  it("accepts the right word from a family's own detectives, each named once", () => {
    expect(decideClaim(ctx, right)).toEqual({ ok: true, detectiveIds: ["d1"] });
    expect(decideClaim(ctx, { detectiveIds: ["d2", "d1", "d2"], word: " SNOW ball 47 " })).toEqual({
      ok: true,
      detectiveIds: ["d2", "d1"],
    });
  });

  it("accepts a claim on a revealed door, because the elf is still waiting", () => {
    expect(decideClaim({ ...ctx, doorState: "revealed" }, right)).toEqual({ ok: true, detectiveIds: ["d1"] });
  });

  it("refuses once the elf has been found, whatever is typed", () => {
    expect(decideClaim({ ...ctx, doorState: "found" }, right)).toEqual({ ok: false, reason: "already-found" });
    expect(decideClaim({ ...ctx, doorState: "found" }, wrong)).toEqual({ ok: false, reason: "already-found" });
  });

  it("refuses with no detective chosen", () => {
    expect(decideClaim(ctx, { detectiveIds: [], word: "snowball 47" })).toEqual({ ok: false, reason: "no-detectives" });
  });

  it("refuses a detective from another family", () => {
    expect(decideClaim(ctx, { detectiveIds: ["d1", "d9"], word: "snowball 47" })).toEqual({
      ok: false,
      reason: "not-your-detective",
    });
  });

  it("refuses the wrong word, and an elf with no word set", () => {
    expect(decideClaim(ctx, wrong)).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim(ctx, { detectiveIds: ["d1"], word: "" })).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim({ ...ctx, secretWord: "" }, { detectiveIds: ["d1"], word: "" })).toEqual({
      ok: false,
      reason: "wrong-word",
    });
  });

  it("gives a wrong word the same answer whether or not an elf is hiding there today", () => {
    expect(decideClaim({ ...ctx, doorState: "shut" }, wrong)).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim({ ...ctx, doorState: "hunting" }, wrong)).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideClaim({ ...ctx, doorState: "revealed" }, wrong)).toEqual({ ok: false, reason: "wrong-word" });
  });

  it("tells only the right word that it is too early", () => {
    expect(decideClaim({ ...ctx, doorState: "shut" }, right)).toEqual({ ok: false, reason: "too-early" });
  });

  it("allows six wrong words at a place and then refuses everything, even the right word", () => {
    expect(MAX_WRONG_WORDS).toBe(6);
    expect(decideClaim({ ...ctx, wrongTries: 5 }, right)).toEqual({ ok: true, detectiveIds: ["d1"] });
    expect(decideClaim({ ...ctx, wrongTries: 6 }, right)).toEqual({ ok: false, reason: "too-many-tries" });
    expect(decideClaim({ ...ctx, wrongTries: 6 }, wrong)).toEqual({ ok: false, reason: "too-many-tries" });
    expect(decideClaim({ ...ctx, doorState: "shut", wrongTries: 9 }, wrong)).toEqual({ ok: false, reason: "too-many-tries" });
  });

  it("refuses a family that has already won an elf, but only once they show the right word", () => {
    expect(decideClaim({ ...ctx, familyHasWon: true }, right)).toEqual({ ok: false, reason: "already-won" });
    expect(decideClaim({ ...ctx, familyHasWon: true }, wrong)).toEqual({ ok: false, reason: "wrong-word" });
  });
});
