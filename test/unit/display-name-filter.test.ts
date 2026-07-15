import { describe, it, expect } from "vitest";
import { containsBlockedWord } from "../../src/donors/display-name-filter";

// TASK-223: the display-name bad-word filter is a first-line safety net for the public supporters
// wall. It is applied where a business's custom credit_name is CAPTURED (rejecting a profane name at
// source) and again at RENDER time (omitting any wall entry whose final display name trips it). The
// list is intentionally conservative — whole-word matching avoids the "Scunthorpe problem" (an
// innocent word that merely contains a short blocked word as a substring), and a human still reviews
// the admin fulfilment list. DB-free: a pure function on a string.

describe("containsBlockedWord", () => {
  it("flags common profanity as a whole word, case-insensitively", () => {
    expect(containsBlockedWord("Fuck Off Ltd")).toBe(true);
    expect(containsBlockedWord("totally CUNT traders")).toBe(true);
    expect(containsBlockedWord("The Shite Shop")).toBe(true);
    expect(containsBlockedWord("wanker & sons")).toBe(true);
  });

  it("flags a slur even when smuggled inside another token", () => {
    // The worst slurs are blocked even as substrings — they have no benign use.
    expect(containsBlockedWord("best4nigger")).toBe(true);
  });

  it("passes ordinary, clean business and individual names", () => {
    expect(containsBlockedWord("Acme Trading Ltd")).toBe(false);
    expect(containsBlockedWord("Ada Lovelace")).toBe(false);
    expect(containsBlockedWord("Bramble Cafe")).toBe(false);
    expect(containsBlockedWord("Prestwick Motors")).toBe(false);
  });

  it("does NOT over-block innocent words that merely contain a blocked word (Scunthorpe problem)", () => {
    expect(containsBlockedWord("Scunthorpe Van Hire")).toBe(false); // contains "cunt"
    expect(containsBlockedWord("Cockburn & Sons")).toBe(false); // surname, contains "cock"
    expect(containsBlockedWord("Assington Farm Shop")).toBe(false); // place, contains "ass"
    expect(containsBlockedWord("Penistone Print")).toBe(false); // place, contains "penis"
  });

  it("handles empty / whitespace input without flagging", () => {
    expect(containsBlockedWord("")).toBe(false);
    expect(containsBlockedWord("   ")).toBe(false);
  });
});
