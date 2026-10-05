import { describe, it, expect } from "vitest";
import { isCharityAddress } from "../../src/email/audit-removals";

// TASK-NNN: removing an address from the Email audit can also block it. One of the charity's own
// addresses is never blocked: that would stop the charity's own notes to itself (a fundraiser has
// signed up, a pledge needs approving), which go to events@ and the like. Every address here is
// invented.

describe("isCharityAddress", () => {
  it.each(["events@nbcc.scot", "Events@NBCC.scot", "  giving@nbcc.scot  ", "newsletter@news.nbcc.scot"])(
    "knows %s as one of the charity's own",
    (email) => {
      expect(isCharityAddress(email)).toBe(true);
    },
  );

  // A domain that only ends in the same letters, or that starts with them, is somebody else's.
  it.each(["ada@example.org", "ada@notnbcc.scot", "ada@nbcc.scot.example.org", "nbcc.scot@example.org", "nbcc.scot", ""])(
    "does not take %s for one of the charity's own",
    (email) => {
      expect(isCharityAddress(email)).toBe(false);
    },
  );
});
