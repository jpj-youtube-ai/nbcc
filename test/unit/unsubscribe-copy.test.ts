import { describe, it, expect } from "vitest";
import {
  scopeForKind,
  confirmPrompt,
  doneMessage,
  type UnsubscribeScope,
} from "../../src/newsletter/unsubscribe-copy";

// TASK-297: GET /unsubscribe/<token> used to unsubscribe on sight. Corporate mail security -
// Microsoft Defender Safe Links, Proofpoint URL Defense, Mimecast, Barracuda - FETCHES every link in
// an incoming email to sandbox it before the recipient ever sees the message. So a scanner could
// silently unsubscribe someone who never clicked anything, and nobody would ever know why the list
// was shrinking. The GET now asks; a POST acts.
//
// That split needs two different sentences for the same event: one in the future tense (what WILL
// happen if you confirm) and one in the past (what HAS happened). Getting those the wrong way round
// is the whole failure mode - a confirmation page that says "you've been unsubscribed" while the
// person is still subscribed is worse than no page at all - so the tense is pinned here.

const SCOPES: UnsubscribeScope[] = ["everything", "one-list"];

describe("unsubscribe scope (TASK-297)", () => {
  it("maps a donor token to everything and a subscriber token to one list", () => {
    // A donor's flag is their global marketing consent; a subscriber row is one audience only. A
    // volunteer leaving volunteer emails must not silently lose the newsletter they also wanted.
    expect(scopeForKind("donor")).toBe("everything");
    expect(scopeForKind("subscriber")).toBe("one-list");
  });
});

describe("unsubscribe wording (TASK-297)", () => {
  it("never claims the unsubscribe has happened while it is still only being offered", () => {
    for (const scope of SCOPES) {
      const prompt = confirmPrompt(scope).toLowerCase();
      expect(prompt).not.toContain("you've been");
      expect(prompt).not.toContain("you have been");
      expect(prompt).not.toContain("unsubscribed.");
    }
  });

  it("says it in the future tense, so the reader knows nothing has happened yet", () => {
    for (const scope of SCOPES) {
      expect(confirmPrompt(scope).toLowerCase()).toContain("this will stop");
    }
  });

  it("confirms in the past tense once the write has actually happened", () => {
    for (const scope of SCOPES) {
      expect(doneMessage(scope).toLowerCase()).toContain("you've been unsubscribed");
    }
  });

  it("warns a donor that thank-you letters stop too, before they commit", () => {
    // The old page only said this AFTER the fact. Someone who wanted to stop the newsletter and keep
    // their thank-you letters had no way to learn that until it was already done.
    expect(confirmPrompt("everything")).toContain("thank-you letters");
    expect(confirmPrompt("everything")).toContain("receipts");
  });

  it("reassures a list leaver that their other emails are untouched", () => {
    expect(confirmPrompt("one-list").toLowerCase()).toContain("separate");
    expect(confirmPrompt("one-list")).not.toContain("thank-you letters");
  });
});
