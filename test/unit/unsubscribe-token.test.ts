import { describe, it, expect } from "vitest";
import {
  signUnsubscribeToken,
  signUnsubscribeTokenV2,
  verifyUnsubscribeToken,
  UnsubscribeTokenError,
} from "../../src/donors/unsubscribe-token";

const SECRET = "test-secret";

describe("unsubscribe token", () => {
  it("round-trips a donor id", () => {
    const token = signUnsubscribeToken(42, SECRET);
    // TASK-255 widened the return to { donorId, newsletterId } so an unsubscribe can be attributed;
    // a legacy token attributes to no newsletter but MUST keep identifying its donor.
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ donorId: 42, newsletterId: null });
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
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ donorId: 7, newsletterId: 41 });
  });

  it("still accepts a LEGACY token forever, with no newsletter attributed", () => {
    const legacy = signUnsubscribeToken(7, SECRET);
    expect(verifyUnsubscribeToken(legacy, SECRET)).toEqual({ donorId: 7, newsletterId: null });
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
