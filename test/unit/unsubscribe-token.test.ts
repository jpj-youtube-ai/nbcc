import { describe, it, expect } from "vitest";
import {
  signUnsubscribeToken,
  signUnsubscribeTokenV2,
  signSubscriberUnsubscribeToken,
  verifyUnsubscribeToken,
  UnsubscribeTokenError,
} from "../../src/donors/unsubscribe-token";

const SECRET = "test-secret";

describe("unsubscribe token", () => {
  it("round-trips a donor id", () => {
    const token = signUnsubscribeToken(42, SECRET);
    // TASK-255 widened the return to { donorId, newsletterId } so an unsubscribe can be attributed;
    // a legacy token attributes to no newsletter but MUST keep identifying its donor.
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ kind: "donor", id: 42, newsletterId: null });
  });

  it("rejects a tampered payload", () => {
    const token = signUnsubscribeToken(42, SECRET);
    const tampered = token.replace(/^\d+/, "99");
    expect(() => verifyUnsubscribeToken(tampered, SECRET)).toThrow(UnsubscribeTokenError);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signUnsubscribeToken(42, SECRET);
    expect(() => verifyUnsubscribeToken(token, "other-secret")).toThrow(UnsubscribeTokenError);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyUnsubscribeToken("not-a-token", SECRET)).toThrow(UnsubscribeTokenError);
  });
});

// TASK-255: token v2 carries WHICH newsletter the link came from, so an unsubscribe can be attributed
// on the stats dashboard. The non-negotiable property: every already-sent email carries a LEGACY
// token, and those links must keep working forever — an unsubscribe link that stops unsubscribing is
// a compliance failure, not a bug.
describe("unsubscribe token v2 (TASK-255)", () => {
  const SECRET = "test-secret";

  it("round-trips donor + newsletter", () => {
    const token = signUnsubscribeTokenV2(7, 41, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ kind: "donor", id: 7, newsletterId: 41 });
  });

  it("still accepts a LEGACY token forever, with no newsletter attributed", () => {
    const legacy = signUnsubscribeToken(7, SECRET);
    expect(verifyUnsubscribeToken(legacy, SECRET)).toEqual({ kind: "donor", id: 7, newsletterId: null });
  });

  it("rejects a v2 token whose signature does not cover BOTH ids", () => {
    // Swapping the newsletter id must invalidate the token — otherwise attribution is forgeable.
    const token = signUnsubscribeTokenV2(7, 41, SECRET);
    const tampered = token.replace(".41.", ".99.");
    expect(() => verifyUnsubscribeToken(tampered, SECRET)).toThrow(UnsubscribeTokenError);
  });

  it("rejects a legacy-shaped token signed with the wrong secret", () => {
    const forged = signUnsubscribeToken(7, "other-secret");
    expect(() => verifyUnsubscribeToken(forged, SECRET)).toThrow(UnsubscribeTokenError);
  });

  it("rejects garbage ids in either slot", () => {
    expect(() => verifyUnsubscribeToken("0.41.x", SECRET)).toThrow(UnsubscribeTokenError);
    expect(() => verifyUnsubscribeToken("7.-1.x", SECRET)).toThrow(UnsubscribeTokenError);
  });
});

// TASK-259: audience lists mean a recipient is not always a donor — a volunteer or partner is a
// list_subscribers row. Their unsubscribe link carries a SUBSCRIBER token ("s<id>.<newsletterId>"),
// alongside the two donor shapes, all verifying forever.
describe("subscriber unsubscribe token (TASK-259)", () => {
  const SECRET = "test-secret";

  it("round-trips a subscriber + newsletter", () => {
    const token = signSubscriberUnsubscribeToken(9, 41, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ kind: "subscriber", id: 9, newsletterId: 41 });
  });

  it("still verifies BOTH donor shapes, forever, now with a kind", () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(7, SECRET), SECRET)).toEqual({
      kind: "donor", id: 7, newsletterId: null,
    });
    expect(verifyUnsubscribeToken(signUnsubscribeTokenV2(7, 41, SECRET), SECRET)).toEqual({
      kind: "donor", id: 7, newsletterId: 41,
    });
  });

  it("rejects a subscriber token whose ids were tampered with", () => {
    const token = signSubscriberUnsubscribeToken(9, 41, SECRET);
    expect(() => verifyUnsubscribeToken(token.replace("s9.", "s8."), SECRET)).toThrow(UnsubscribeTokenError);
    expect(() => verifyUnsubscribeToken(token.replace(".41.", ".40."), SECRET)).toThrow(UnsubscribeTokenError);
  });

  it("rejects a donor-signed body replayed as a subscriber token", () => {
    // "7.41" signed as a donor must not verify when dressed as "s7.41" — the prefix is in the body.
    const donor = signUnsubscribeTokenV2(7, 41, SECRET);
    expect(() => verifyUnsubscribeToken("s" + donor, SECRET)).toThrow(UnsubscribeTokenError);
  });
});
