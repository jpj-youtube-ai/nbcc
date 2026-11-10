import { describe, it, expect } from "vitest";
import { POSTER_ALPHABET, posterCode, makePosterCode, makeTagWord } from "../../src/elf/door-codes";
import { isUsableSecretWord } from "../../src/elf/claim";
import { renderElfPoster } from "../../src/elf/print";

describe("poster codes", () => {
  it("has a 32 letter alphabet", () => {
    expect(POSTER_ALPHABET).toBe("abcdefghijkmnpqrstuvwxyz23456789");
    expect(POSTER_ALPHABET.length).toBe(32);
  });
  it("turns bytes into twelve characters", () => {
    expect(posterCode(new Uint8Array(12))).toBe("aaaaaaaaaaaa");
    expect(posterCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBe("abcdefghijkm");
  });
  it("wraps bytes above 31", () => {
    expect(posterCode(Uint8Array.from([32, 33, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0])).slice(0, 3)).toBe("ab9");
  });
  it("refuses fewer than twelve bytes", () => {
    expect(() => posterCode(new Uint8Array(11))).toThrow();
  });
  it("makes codes a poster will accept", () => {
    for (let i = 0; i < 50; i++) {
      const code = makePosterCode();
      expect(code).toMatch(/^[a-km-np-z2-9]{12}$/);
      expect(() => renderElfPoster({
        posterUrl: `https://nbcc.scot/elf/p/${code}`,
        siteOrigin: "https://nbcc.scot",
        placeName: "The Invented Bakehouse",
        placeTown: "Exampletown",
      } as never)).not.toThrow();
    }
  });
});

describe("tag words", () => {
  it("makes usable secret words", () => {
    for (let i = 0; i < 50; i++) expect(isUsableSecretWord(makeTagWord())).toBe(true);
  });
});
