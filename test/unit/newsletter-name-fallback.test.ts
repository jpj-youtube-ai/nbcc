import { describe, it, expect } from "vitest";
import { mergeName, greetingName, DEFAULT_GREETING_FALLBACK } from "../../src/newsletter/name-fallback";

describe("mergeName — a real name", () => {
  it("substitutes it", () => {
    expect(mergeName("Hey, {{firstName}}! It's the NBCC Newsletter", "Morven", "")).toBe(
      "Hey, Morven! It's the NBCC Newsletter",
    );
  });

  it("substitutes every occurrence", () => {
    expect(mergeName("{{firstName}}, {{firstName}}!", "Sam", "")).toBe("Sam, Sam!");
  });

  it("leaves text with no merge tag alone", () => {
    expect(mergeName("The bags are packed", "Morven", "")).toBe("The bags are packed");
  });
});

describe("mergeName — no name, a fallback word given", () => {
  it("uses the word", () => {
    expect(mergeName("Hey, {{firstName}}!", "", "supporter")).toBe("Hey, supporter!");
  });

  it("treats a whitespace-only name as no name", () => {
    expect(mergeName("Dear {{firstName}},", "   ", "friend")).toBe("Dear friend,");
  });
});

// The behaviour asked for: with the fallback left blank, the name should vanish CLEANLY — not leave
// "Hey, ! It's the NBCC Newsletter" behind.
describe("mergeName — no name, no fallback: tidy it away", () => {
  it("removes the name and the comma before it", () => {
    expect(mergeName("Hey, {{firstName}}! It's the NBCC Newsletter", "", "")).toBe(
      "Hey! It's the NBCC Newsletter",
    );
  });

  it("handles a tag at the end", () => {
    expect(mergeName("Hi {{firstName}}", "", "")).toBe("Hi");
  });

  it("handles a tag at the start, including the capital", () => {
    expect(mergeName("{{firstName}}, your bags are ready", "", "")).toBe("Your bags are ready");
  });

  it("does not leave a double space behind", () => {
    expect(mergeName("A note for {{firstName}} about Christmas", "", "")).toBe(
      "A note for about Christmas",
    );
  });

  it("tidies a comma before a full stop or question mark", () => {
    expect(mergeName("Thanks, {{firstName}}.", "", "")).toBe("Thanks.");
    expect(mergeName("Coming, {{firstName}}?", "", "")).toBe("Coming?");
  });

  it("leaves a subject that was only the tag as an empty string, not punctuation", () => {
    expect(mergeName("{{firstName}}", "", "")).toBe("");
  });
});

// "Dear," is never right, so the greeting keeps a word whatever happens.
describe("greetingName — the salutation always has somebody to address", () => {
  it("uses the real name", () => {
    expect(greetingName("Morven", "supporter")).toBe("Morven");
  });

  it("uses the chosen word when there is no name", () => {
    expect(greetingName("", "supporter")).toBe("supporter");
  });

  it("falls back to a sensible word rather than leaving 'Dear,'", () => {
    expect(greetingName("", "")).toBe(DEFAULT_GREETING_FALLBACK);
    expect(greetingName("", "   ")).toBe(DEFAULT_GREETING_FALLBACK);
  });
});
