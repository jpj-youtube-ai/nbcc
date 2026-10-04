import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_DAYS,
  INVITE_NOTE_MAX,
  INVITE_NAME_PART_MAX,
  INVITE_REFRESH,
  hashInviteToken,
  inviteCc,
  inviteFullName,
  inviteNameParts,
  inviteIssuedAt,
  invitePrefill,
  inviteSchema,
  inviteUrl,
  inviteVerdict,
  newInviteToken,
  readInviteToken,
  staffFirstName,
} from "../../src/fundraising/invite";
import { NAME_PART_MAX } from "../../src/fundraising/model";

// TASK-503: the invite a member of staff sends from Admin > Fundraising. Its link carries a random
// token; only a hash of it is kept, it works for 60 days from when it was last sent, once, and it
// fills in only the first name, surname and email on the sign up form. Every name and address here is invented.

const DAY = 24 * 60 * 60 * 1000;

describe("the invite token", () => {
  it("is 32 random bytes, written in letters, digits, - and _", () => {
    const t = newInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newInviteToken()).not.toBe(t);
  });

  it("is kept only as a hash, which is never the token itself", () => {
    const t = newInviteToken();
    const h = hashInviteToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashInviteToken(t)).toBe(h);
    expect(hashInviteToken(newInviteToken())).not.toBe(h);
  });

  it("reads only a token of the right shape from the page", () => {
    const t = newInviteToken();
    expect(readInviteToken(t)).toBe(t);
    expect(readInviteToken(` ${t} `)).toBe(t);
    for (const bad of [undefined, null, 42, "", "short", t + "x", t.slice(0, 42) + "!", { t }]) {
      expect(readInviteToken(bad)).toBeNull();
    }
  });

  it("builds the link to the sign up form", () => {
    expect(inviteUrl("https://nbcc.test/", "abc_DEF-123")).toBe("https://nbcc.test/fundraise?invite=abc_DEF-123");
  });
});

describe("whether an invite still works", () => {
  const sent = new Date("2026-10-01T09:00:00Z");
  const row = (over: Partial<{ createdAt: Date; resentAt: Date | null; usedAt: Date | null }> = {}) => ({
    createdAt: sent,
    resentAt: null,
    usedAt: null,
    ...over,
  });

  it("works for 60 days from when it was sent", () => {
    expect(INVITE_TTL_DAYS).toBe(60);
    expect(inviteVerdict(row(), new Date(sent.getTime() + 59 * DAY))).toBe("ok");
    expect(inviteVerdict(row(), new Date(sent.getTime() + 60 * DAY - 1))).toBe("ok");
    expect(inviteVerdict(row(), new Date(sent.getTime() + 60 * DAY))).toBe("expired");
  });

  it("counts the 60 days from the last time it was sent again", () => {
    const resentAt = new Date(sent.getTime() + 50 * DAY);
    expect(inviteIssuedAt(row({ resentAt }))).toEqual(resentAt);
    expect(inviteVerdict(row({ resentAt }), new Date(sent.getTime() + 100 * DAY))).toBe("ok");
    expect(inviteVerdict(row({ resentAt }), new Date(sent.getTime() + 110 * DAY))).toBe("expired");
  });

  it("works only once", () => {
    expect(inviteVerdict(row({ usedAt: new Date(sent.getTime() + DAY) }), new Date(sent.getTime() + 2 * DAY))).toBe("used");
  });

  it("is none when there is no such invite", () => {
    expect(inviteVerdict(null, sent)).toBe("none");
  });
});

describe("what an invite fills in on the form", () => {
  it("is the first name, surname and email exactly as staff typed them, and nothing else", () => {
    const prefill = invitePrefill({
      id: 4,
      name: "Morag Ann Fyfe",
      firstName: "Morag Ann",
      lastName: "Fyfe",
      email: "morag@example.com",
      note: "Lovely to chat about the bake sale",
      signedBy: "Fern",
      sentBy: "admin:fern@example.com",
    } as unknown as { name: string; firstName: string | null; lastName: string | null; email: string });
    // `name`, the two joined, is there too so a sign up page loaded before the two boxes still fills in.
    expect(prefill).toEqual({ name: "Morag Ann Fyfe", firstName: "Morag Ann", lastName: "Fyfe", email: "morag@example.com" });
  });

  it("splits the one name of an invite sent before the two boxes at its first space", () => {
    expect(invitePrefill({ name: "Alex Example Jones", firstName: null, lastName: null, email: "alex@example.com" })).toEqual({
      name: "Alex Example Jones",
      firstName: "Alex",
      lastName: "Example Jones",
      email: "alex@example.com",
    });
  });
});

describe("an invite's name", () => {
  it("is the two boxes when they were kept", () => {
    expect(inviteNameParts({ name: "Morag Ann Fyfe", firstName: "Morag Ann", lastName: "Fyfe" })).toEqual({ firstName: "Morag Ann", lastName: "Fyfe" });
  });

  it("falls back to the old split for an invite with only one name", () => {
    expect(inviteNameParts({ name: " Alex  Example Jones ", firstName: null, lastName: null })).toEqual({ firstName: "Alex", lastName: "Example Jones" });
    expect(inviteNameParts({ name: "Alex", firstName: null, lastName: null })).toEqual({ firstName: "Alex", lastName: "" });
    expect(inviteNameParts({ name: "Alex Example" })).toEqual({ firstName: "Alex", lastName: "Example" });
  });

  it("is kept whole as the first name, a space and the surname, within the 100 the table allows", () => {
    expect(inviteFullName("Morag Ann", "Fyfe")).toBe("Morag Ann Fyfe");
    const long = inviteFullName("a".repeat(INVITE_NAME_PART_MAX), "b".repeat(INVITE_NAME_PART_MAX));
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.startsWith("a".repeat(50) + " b")).toBe(true);
  });
});

describe("who is copied in on an invite", () => {
  // Jaimie 2026-10-03: the member of staff who sends it, so they have a copy.
  it("is the sender's email, tidied", () => {
    expect(inviteCc(" Fern@Example.com ", "morag@example.com")).toBe("fern@example.com");
  });

  it("is nobody when the sender's email is missing or not a whole address, so the invite still goes", () => {
    expect(inviteCc(undefined, "morag@example.com")).toBeUndefined();
    expect(inviteCc(null, "morag@example.com")).toBeUndefined();
    expect(inviteCc("", "morag@example.com")).toBeUndefined();
    expect(inviteCc("fern@", "morag@example.com")).toBeUndefined();
    expect(inviteCc("fern@example.com, rowan@example.com", "morag@example.com")).toBeUndefined();
  });

  it("is nobody when the sender is the person invited", () => {
    expect(inviteCc("Morag@Example.com", "morag@example.com")).toBeUndefined();
  });
});

describe("the invite form", () => {
  const ok = { firstName: " Morag Ann ", lastName: " Fyfe ", email: " Morag@Example.com ", note: " Great to chat! ", signedBy: 3 };

  it("tidies a good invite", () => {
    const parsed = inviteSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ firstName: "Morag Ann", lastName: "Fyfe", email: "morag@example.com", note: "Great to chat!", signedBy: 3, type: null });
    }
  });

  it("treats a blank note as none", () => {
    const parsed = inviteSchema.safeParse({ ...ok, note: "   " });
    expect(parsed.success && parsed.data.note).toBeNull();
    const none = inviteSchema.safeParse({ firstName: "Morag", lastName: "Fyfe", email: "morag@example.com", signedBy: 3 });
    expect(none.success && none.data.note).toBeNull();
  });

  // Jaimie 2026-10-03: a personal note can be a proper letter, so the limit is 5,000 (was 600).
  it("keeps the note to 5,000 characters", () => {
    expect(INVITE_NOTE_MAX).toBe(5000);
    expect(inviteSchema.safeParse({ ...ok, note: "a".repeat(5000) }).success).toBe(true);
    expect(inviteSchema.safeParse({ ...ok, note: "a".repeat(5001) }).success).toBe(false);
  });

  it("needs a first name, a surname, a whole email and who it is signed by, and nothing else", () => {
    expect(inviteSchema.safeParse({ ...ok, firstName: " " }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, lastName: " " }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, email: "alex@" }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, signedBy: 0 }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, signedBy: "3" }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, eventDate: "2026-12-05" }).success).toBe(false);
    // Both kinds of name at once is not something either page sends.
    expect(inviteSchema.safeParse({ ...ok, name: "Morag Fyfe" }).success).toBe(false);
  });

  // An admin page loaded before the two boxes (an old app.js still in the browser) sends one name.
  // For a while, that is split at its first space, as the sign up form used to.
  it("takes one name from a page loaded before the two boxes, split at its first space", () => {
    const parsed = inviteSchema.safeParse({ name: " Mary Jane  Smith ", email: "mary@example.com", note: "Hi", signedBy: 3 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ firstName: "Mary", lastName: "Jane Smith", email: "mary@example.com", note: "Hi", signedBy: 3, type: null });
      expect(parsed.data).not.toHaveProperty("name");
    }
  });

  it("asks for a refresh, naming no box, when that one name has no surname in it", () => {
    expect(INVITE_REFRESH).toBe("Please refresh the page and try again.");
    const parsed = inviteSchema.safeParse({ name: "Mary", email: "mary@example.com", signedBy: 3 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0]).toMatchObject({ path: [], message: INVITE_REFRESH });
    }
  });

  it("names the box that needs another look", () => {
    const blank = inviteSchema.safeParse({ ...ok, firstName: "", lastName: "" });
    expect(blank.success).toBe(false);
    if (!blank.success) {
      const said = Object.fromEntries(blank.error.issues.map((i) => [i.path.join("."), i.message]));
      expect(said.firstName).toBe("Add their first name.");
      expect(said.lastName).toBe("Add their surname.");
    }
  });

  it("takes as much in each box as the sign up form does", () => {
    expect(INVITE_NAME_PART_MAX).toBe(NAME_PART_MAX);
    expect(inviteSchema.safeParse({ ...ok, firstName: "a".repeat(INVITE_NAME_PART_MAX), lastName: "b".repeat(INVITE_NAME_PART_MAX) }).success).toBe(true);
    const long = inviteSchema.safeParse({ ...ok, firstName: "a".repeat(INVITE_NAME_PART_MAX + 1), lastName: "b".repeat(INVITE_NAME_PART_MAX + 1) });
    expect(long.success).toBe(false);
    if (!long.success) {
      const said = Object.fromEntries(long.error.issues.map((i) => [i.path.join("."), i.message]));
      expect(said.firstName).toBe("Keep the first name to 50 characters or fewer.");
      expect(said.lastName).toBe("Keep the surname to 50 characters or fewer.");
    }
  });
});

describe("the first name an invite is signed with", () => {
  it("is the first word of the staff member's name", () => {
    expect(staffFirstName("Fern Example", "fern@example.com")).toBe("Fern");
    expect(staffFirstName("  rowan  example ", "rowan@example.com")).toBe("Rowan");
  });

  it("falls back to the start of their email when they have no name", () => {
    expect(staffFirstName("", "fern.example@example.com")).toBe("Fern");
    expect(staffFirstName(null, "fern@example.com")).toBe("Fern");
  });
});
