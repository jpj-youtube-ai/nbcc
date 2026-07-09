import { describe, it, expect } from "vitest";
import {
  signThankYouLetterToken,
  verifyThankYouLetterToken,
  LetterTokenError,
} from "../../src/thank-you/letter-token";

// TASK-165 (REQ-069): the stateless printable-letter token. Pure HMAC, DB-free, so it is unit-tested
// directly (mirrors unsubscribe-token). It gates the public print page against id enumeration.
const SECRET = "test-secret";

describe("thank-you letter token", () => {
  it("round-trips a sent-letter id", () => {
    const token = signThankYouLetterToken(7, SECRET);
    expect(verifyThankYouLetterToken(token, SECRET)).toBe(7);
  });

  it("rejects a tampered id", () => {
    const token = signThankYouLetterToken(7, SECRET);
    const tampered = token.replace(/^\d+/, "99");
    expect(() => verifyThankYouLetterToken(tampered, SECRET)).toThrow(LetterTokenError);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signThankYouLetterToken(7, SECRET);
    expect(() => verifyThankYouLetterToken(token, "other-secret")).toThrow(LetterTokenError);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyThankYouLetterToken("not-a-token", SECRET)).toThrow(LetterTokenError);
  });
});
