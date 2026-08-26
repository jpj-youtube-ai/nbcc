// TASK-297: the wording either side of an unsubscribe, kept pure and DB-free like
// src/newsletter/preferences.ts and src/newsletter/name-fallback.ts, so the tense can be unit-tested
// without standing up a route.
//
// Why the split exists at all: GET /unsubscribe/<token> used to unsubscribe on sight. Corporate mail
// security - Microsoft Defender Safe Links, Proofpoint URL Defense, Mimecast, Barracuda - fetches
// every link in an incoming email to sandbox it BEFORE the recipient sees the message, and
// click-tracking redirects lead it straight to us. A GET that wrote to the database therefore
// unsubscribed people who never clicked anything, invisibly. The GET now asks and the POST acts,
// which also happens to be what RFC 8058 one-click already assumed.

export type UnsubscribeScope = "everything" | "one-list";

/**
 * What a token's holder is actually about to lose. A donor's flag is their global marketing consent;
 * a list subscriber's row is one audience only - a volunteer leaving volunteer emails must not
 * silently lose the newsletter they also wanted.
 */
export function scopeForKind(kind: "donor" | "subscriber"): UnsubscribeScope {
  return kind === "donor" ? "everything" : "one-list";
}

/**
 * Shown BEFORE anything is written. Deliberately future tense: a page that says "you've been
 * unsubscribed" while the person is still subscribed is worse than no page at all.
 */
export function confirmPrompt(scope: UnsubscribeScope): string {
  return scope === "everything"
    ? "This will stop all our emails to you — including our newsletter and thank-you letters. Donation receipts still come through, because those are records of your gift."
    : "This will stop the emails from this one mailing list. Anything else you get from us is separate, and stays on.";
}

/** Shown AFTER the write has happened. */
export function doneMessage(scope: UnsubscribeScope): string {
  return scope === "everything"
    ? "You've been unsubscribed. We'll stop sending you emails — including our newsletter and thank-you letters. Donation receipts still come through, because those are records of your gift. If this was a mistake, just reply to any of our emails or contact us and we'll put it right."
    : "You've been unsubscribed from this mailing list. Anything else you get from us is separate and still on.";
}
