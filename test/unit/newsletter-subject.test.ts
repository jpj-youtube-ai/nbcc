import { describe, it, expect } from "vitest";
import { mergeSubject } from "../../src/newsletter/theme";

// TASK-254: {{firstName}} in the SUBJECT line.
//
// The builder invites you to personalise with {{firstName}} (it is the text field's own hint), and the
// BODY has always merged it per recipient — but the subject was passed through raw, so a newsletter
// titled "Hey, {{firstName}}!" reached every donor with the marker showing. Both sides worked; the hop
// between them did not.
//
// A subject line is PLAIN TEXT, not HTML, so this must NOT reuse the body's applyMerge: that escapes,
// and a donor called O'Brien would get "Hey, O&#39;Brien" in their inbox. That is the whole reason
// this is its own function.
describe("mergeSubject (TASK-254)", () => {
  it("puts the donor's name in the subject", () => {
    expect(mergeSubject("Hey, {{firstName}}! it's the NBCC", "Jodie")).toBe("Hey, Jodie! it's the NBCC");
  });

  it("does NOT escape — a subject is plain text, and a mail client shows it literally", () => {
    // The bug this function exists to avoid: applyMerge would emit "O&#39;Brien" / "Ben &amp; Jerry".
    expect(mergeSubject("A note for {{firstName}}", "O'Brien")).toBe("A note for O'Brien");
    expect(mergeSubject("A note for {{firstName}}", "Ben & Jerry")).toBe("A note for Ben & Jerry");
    expect(mergeSubject("{{firstName}} <3", "Zoë")).toBe("Zoë <3");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(mergeSubject("{{firstName}}, this one's for you {{firstName}}", "Sam")).toBe(
      "Sam, this one's for you Sam",
    );
  });

  it("leaves a subject with no marker exactly as written", () => {
    expect(mergeSubject("July Newsletter", "Jodie")).toBe("July Newsletter");
  });

  it("never leaves an empty gap where a name should be", () => {
    // The send passes firstNameOf(), which already falls back to "friend" — but if anything ever hands
    // this a blank, "Hey, !" must not go out to a donor.
    expect(mergeSubject("Hey, {{firstName}}!", "")).toBe("Hey, friend!");
    expect(mergeSubject("Hey, {{firstName}}!", "   ")).toBe("Hey, friend!");
  });
});
