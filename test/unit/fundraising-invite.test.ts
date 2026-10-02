import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_DAYS,
  INVITE_NOTE_MAX,
  hashInviteToken,
  inviteIssuedAt,
  invitePrefill,
  inviteSchema,
  inviteUrl,
  inviteVerdict,
  newInviteToken,
  readInviteToken,
  staffFirstName,
} from "../../src/fundraising/invite";

// TASK-503: the invite a member of staff sends from Admin > Fundraising. Its link carries a random
// token; only a hash of it is kept, it works for 60 days from when it was last sent, once, and it
// fills in only the name and email on the sign up form. Every name and address here is invented.

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
  it("is the name and email, and nothing else", () => {
    const prefill = invitePrefill({
      id: 4,
      name: "Alex Example",
      email: "alex@example.com",
      note: "Lovely to chat about the bake sale",
      signedBy: "Fern",
      sentBy: "admin:fern@example.com",
    } as unknown as { name: string; email: string });
    expect(prefill).toEqual({ name: "Alex Example", email: "alex@example.com" });
  });
});

describe("the invite form", () => {
  const ok = { name: " Alex Example ", email: " Alex@Example.com ", note: " Great to chat! ", signedBy: 3 };

  it("tidies a good invite", () => {
    const parsed = inviteSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ name: "Alex Example", email: "alex@example.com", note: "Great to chat!", signedBy: 3 });
  });

  it("treats a blank note as none", () => {
    const parsed = inviteSchema.safeParse({ ...ok, note: "   " });
    expect(parsed.success && parsed.data.note).toBeNull();
    const none = inviteSchema.safeParse({ name: "Alex", email: "alex@example.com", signedBy: 3 });
    expect(none.success && none.data.note).toBeNull();
  });

  it("keeps the note to 600 characters", () => {
    expect(INVITE_NOTE_MAX).toBe(600);
    expect(inviteSchema.safeParse({ ...ok, note: "a".repeat(600) }).success).toBe(true);
    expect(inviteSchema.safeParse({ ...ok, note: "a".repeat(601) }).success).toBe(false);
  });

  it("needs a name, a whole email and who it is signed by, and nothing else", () => {
    expect(inviteSchema.safeParse({ ...ok, name: " " }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, email: "alex@" }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, signedBy: 0 }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, signedBy: "3" }).success).toBe(false);
    expect(inviteSchema.safeParse({ ...ok, eventDate: "2026-12-05" }).success).toBe(false);
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
