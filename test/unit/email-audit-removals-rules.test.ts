import { describe, it, expect } from "vitest";
import { isCharityAddress, looksLikeAddress } from "../../src/email/audit-removals";

// TASK-562: removing an address from the Email audit can also block it. One of the charity's own
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

// What can be blocked. Addresses come into the site through a loose check (the donation form, the
// newsletter spreadsheet, a sponsor's pledge), so the log holds some a strict check would refuse:
// a trailing full stop, two dots, brackets round it. Those are the very ones that fail every time
// and need removing, so this is the same loose shape, no stricter.
describe("looksLikeAddress", () => {
  it.each(["ada@example.org", "ada@example.org.", "ada..b@example.org", "<ada@example.org>", "ada&bo@example.org", "  ada@example.org  "])(
    "takes %s for an address, as the log does",
    (email) => {
      expect(looksLikeAddress(email)).toBe(true);
    },
  );

  // A cleared team invite's rows read "deleted team invitee" where the address was.
  it.each(["deleted team invitee", "ada", "ada@", "@example.org", "ada@example", "ada @example.org", ""])(
    "does not take %s for one",
    (email) => {
      expect(looksLikeAddress(email)).toBe(false);
    },
  );
});
