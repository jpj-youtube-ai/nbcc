import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  MANAGE_TOKEN_TTL_MS,
  newManageToken,
  hashManageToken,
  issueManageToken,
  verifyManageToken,
  manageLink,
  ManageTokenError,
} from "../../src/fundraising/manage-token";

// TASK-493: the emailed link an organiser uses to change their page. Random, kept only as a sha256
// hash, good for 24 hours, and for one fundraiser. The clock is passed in.

const NOW = new Date("2026-10-02T12:00:00Z");

describe("making a manage link", () => {
  it("is long and random", () => {
    const a = newManageToken();
    const b = newManageToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is kept only as its sha256", () => {
    const token = "an-invented-token-for-the-test";
    expect(hashManageToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashManageToken(token)).not.toContain(token);
  });

  it("lasts 24 hours from when it is made, for the one fundraiser", () => {
    const record = issueManageToken({ token: "t1", fundraiserId: 7, now: NOW });
    expect(MANAGE_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(record).toEqual({
      tokenHash: hashManageToken("t1"),
      fundraiserId: 7,
      expiresAt: new Date("2026-10-03T12:00:00Z"),
    });
  });

  it("is a link to the manage page, the token in the query so it is never tagged or logged as a path", () => {
    expect(manageLink("https://nbcc.scot/", "abc_DEF-123")).toBe("https://nbcc.scot/fundraise/manage?token=abc_DEF-123");
  });
});

describe("using a manage link", () => {
  const row = { fundraiserId: 7, expiresAt: new Date("2026-10-03T12:00:00Z") };

  it("opens its fundraiser while it lasts", () => {
    expect(verifyManageToken(row, NOW)).toEqual({ fundraiserId: 7 });
    expect(verifyManageToken(row, new Date("2026-10-03T11:59:59Z"))).toEqual({ fundraiserId: 7 });
  });

  it("does not open once 24 hours are up", () => {
    expect(() => verifyManageToken(row, new Date("2026-10-03T12:00:00Z"))).toThrow(ManageTokenError);
    try {
      verifyManageToken(row, new Date("2026-10-04T00:00:00Z"));
    } catch (err) {
      expect((err as ManageTokenError).reason).toBe("expired");
    }
  });

  it("does not open when it matches nothing", () => {
    try {
      verifyManageToken(null, NOW);
      expect.unreachable();
    } catch (err) {
      expect((err as ManageTokenError).reason).toBe("not_found");
    }
  });
});
