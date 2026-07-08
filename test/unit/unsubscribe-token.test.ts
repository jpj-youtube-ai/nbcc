import { describe, it, expect } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  UnsubscribeTokenError,
} from "../../src/donors/unsubscribe-token";

const SECRET = "test-secret";

describe("unsubscribe token", () => {
  it("round-trips a donor id", () => {
    const token = signUnsubscribeToken(42, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe(42);
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
