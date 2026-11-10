import { describe, it, expect } from "vitest";
import { MAX_WRONG_WORDS, decideWord, isUsableSecretWord, normaliseWord, type WordContext } from "../../src/elf/claim";

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

  it("reads the wide letters and numbers some keyboards type as the plain ones", () => {
    const wide = String.fromCharCode(0xff33, 0xff4e, 0xff4f, 0xff57, 0xff14, 0xff17);
    expect(normaliseWord(wide)).toBe("snow47");
  });

  it("can go on a tag only with a letter and at least three numbers in it", () => {
    expect(isUsableSecretWord("TINSEL 384")).toBe(true);
    expect(isUsableSecretWord("Noël 127")).toBe(true);
    expect(isUsableSecretWord("e123")).toBe(true);
  });

  it("cannot go on a tag if it could be guessed, because the list of word ideas is public", () => {
    expect(isUsableSecretWord("SNOWBALL")).toBe(false);
    expect(isUsableSecretWord("SNOWBALL 4")).toBe(false);
    expect(isUsableSecretWord("Elf 77")).toBe(false);
    expect(isUsableSecretWord("2026")).toBe(false);
    expect(isUsableSecretWord("!!!")).toBe(false);
    expect(isUsableSecretWord("")).toBe(false);
  });
});

describe("the word on the tag", () => {
  const ctx: WordContext = {
    doorState: "hunting",
    goneHome: false,
    secretWord: "SNOWBALL 472",
    familyDetectiveIds: ["d1", "d2"],
    familyHasWon: false,
    wrongTries: 0,
    alreadyStamped: [],
  };
  const right = { detectiveIds: ["d1"], word: "snowball472" };
  const wrong = { detectiveIds: ["d1"], word: "snowbal 472" };

  it("wins the elf for a family that has not won, while it is hunted or revealed", () => {
    expect(decideWord(ctx, right)).toEqual({ ok: true, outcome: "won", detectiveIds: ["d1"] });
    expect(decideWord({ ...ctx, doorState: "revealed" }, right)).toEqual({ ok: true, outcome: "won", detectiveIds: ["d1"] });
    expect(decideWord(ctx, { detectiveIds: ["d2", "d1", "d2"], word: " SNOW ball 472 " })).toEqual({
      ok: true,
      outcome: "won",
      detectiveIds: ["d2", "d1"],
    });
    expect(decideWord(ctx, { detectiveIds: "d1", word: "snowball472" })).toEqual({ ok: true, outcome: "won", detectiveIds: ["d1"] });
  });

  it("stamps a family that has already won, counting from the shown time", () => {
    expect(decideWord({ ...ctx, familyHasWon: true }, right)).toEqual({ ok: true, outcome: "visited", detectiveIds: ["d1"], countsFromReveal: false });
    expect(decideWord({ ...ctx, doorState: "revealed", familyHasWon: true }, right)).toEqual({
      ok: true,
      outcome: "visited",
      detectiveIds: ["d1"],
      countsFromReveal: false,
    });
  });

  it("stamps when the elf is found with its place hidden, counting from the reveal", () => {
    expect(decideWord({ ...ctx, doorState: "found-hidden" }, right)).toEqual({ ok: true, outcome: "visited", detectiveIds: ["d1"], countsFromReveal: true });
    expect(decideWord({ ...ctx, doorState: "found-hidden", familyHasWon: true }, right)).toEqual({
      ok: true,
      outcome: "visited",
      detectiveIds: ["d1"],
      countsFromReveal: true,
    });
  });

  it("stamps only the detectives not already stamped, and says when nobody is new", () => {
    const found = { ...ctx, doorState: "found" as const, alreadyStamped: ["d1"] };
    expect(decideWord(found, { detectiveIds: ["d1", "d2"], word: "snowball472" })).toEqual({
      ok: true,
      outcome: "visited",
      detectiveIds: ["d2"],
      countsFromReveal: false,
    });
    expect(decideWord(found, right)).toEqual({ ok: false, reason: "nothing-new" });
  });

  it("is too early only for the right word, and gives a wrong word the same answer on any door", () => {
    expect(decideWord({ ...ctx, doorState: "shut" }, right)).toEqual({ ok: false, reason: "too-early" });
    for (const doorState of ["shut", "hunting", "found-hidden", "found", "revealed", "snow"] as const) {
      expect(decideWord({ ...ctx, doorState }, wrong), doorState).toEqual({ ok: false, reason: "wrong-word" });
    }
  });

  it("sends a family home from an elf that has gone home, even with the right word", () => {
    expect(decideWord({ ...ctx, doorState: "found", goneHome: true }, right)).toEqual({ ok: false, reason: "gone-home" });
    expect(decideWord({ ...ctx, doorState: "found", goneHome: true }, wrong)).toEqual({ ok: false, reason: "wrong-word" });
  });

  it("reads a snow day door like any other place, because its caller gives it no word", () => {
    expect(decideWord({ ...ctx, doorState: "snow", secretWord: "" }, right)).toEqual({ ok: false, reason: "wrong-word" });
    expect(decideWord({ ...ctx, secretWord: "" }, { detectiveIds: ["d1"], word: "" })).toEqual({ ok: false, reason: "wrong-word" });
  });

  it("allows six wrong words at a place and then refuses everything before reading the word", () => {
    expect(MAX_WRONG_WORDS).toBe(6);
    expect(decideWord({ ...ctx, wrongTries: 5 }, right).ok).toBe(true);
    expect(decideWord({ ...ctx, wrongTries: 6 }, right)).toEqual({ ok: false, reason: "too-many-tries" });
    expect(decideWord({ ...ctx, wrongTries: 6 }, wrong)).toEqual({ ok: false, reason: "too-many-tries" });
    for (const missing of [undefined, null, Number.NaN, "2"]) {
      expect(decideWord({ ...ctx, wrongTries: missing as unknown as number }, right), String(missing)).toEqual({ ok: false, reason: "too-many-tries" });
    }
  });

  it("checks who is ticked first", () => {
    expect(decideWord(ctx, { detectiveIds: [], word: "snowball472" })).toEqual({ ok: false, reason: "no-detectives" });
    expect(decideWord(ctx, { detectiveIds: undefined, word: "snowball472" })).toEqual({ ok: false, reason: "no-detectives" });
    expect(decideWord(ctx, { detectiveIds: ["d9"], word: "snowball472" })).toEqual({ ok: false, reason: "not-your-detective" });
    expect(decideWord(ctx, { detectiveIds: ["d1", "d9"], word: "snowball472" })).toEqual({ ok: false, reason: "not-your-detective" });
  });
});
