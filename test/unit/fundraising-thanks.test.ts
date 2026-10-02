import { describe, it, expect } from "vitest";
import {
  THANKS_MAX,
  THANKS_PER_DAY,
  thanksPostSchema,
  thanksLimitReached,
  thanksStatusWords,
  thankableGifts,
  recipientVerdict,
  forOrganiser,
  type ThanksRow,
} from "../../src/fundraising/thanks";
import type { WallSourceRow } from "../../src/fundraising/model";

// TASK-507: "Thank your supporters". The pure rules: what an organiser may send, which of their gifts
// they may pick, what they are told about a thank you, and who NBCC may email. Every name, address
// and amount here is invented.

const gift = (over: Partial<WallSourceRow> = {}): WallSourceRow => ({
  donationId: 41,
  fullName: "Alex Example",
  anonymous: false,
  showName: true,
  showAmount: true,
  amountPence: 2000,
  refundedPence: 0,
  message: "Go Sam!",
  hidden: false,
  createdAt: "2026-10-01T10:00:00.000Z",
  paidIn: false,
  giftAid: false,
  ...over,
});

const row = (over: Partial<ThanksRow> = {}): ThanksRow => ({
  id: 3,
  fundraiserId: 9,
  message: "Thank you so much!",
  status: "pending",
  createdAt: "2026-10-02T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  rejectReason: null,
  deliveredAt: null,
  gifts: 2,
  waiting: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  ...over,
});

describe("what an organiser sends", () => {
  it("takes a message and the gifts they ticked, trimmed and without repeats", () => {
    const parsed = thanksPostSchema.safeParse({ message: "  Thank you!  ", donationIds: [41, 42, 41] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ message: "Thank you!", donationIds: [41, 42] });
  });

  it("needs a few words", () => {
    const parsed = thanksPostSchema.safeParse({ message: "   ", donationIds: [41] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("Write a few words to say thank you.");
  });

  it(`keeps a message to ${THANKS_MAX} characters`, () => {
    expect(thanksPostSchema.safeParse({ message: "a".repeat(THANKS_MAX), donationIds: [41] }).success).toBe(true);
    const parsed = thanksPostSchema.safeParse({ message: "a".repeat(THANKS_MAX + 1), donationIds: [41] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("Keep your thank you to 600 characters or fewer.");
  });

  it("refuses rude words, as the wall does", () => {
    const parsed = thanksPostSchema.safeParse({ message: "Thanks you shit", donationIds: [41] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("Please choose different words for your thank you.");
  });

  it("needs at least one gift ticked", () => {
    const parsed = thanksPostSchema.safeParse({ message: "Thanks", donationIds: [] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("Tick at least one gift to thank.");
  });

  it.each([[["41"]], [[0]], [[-3]], [[1.5]], [[2147483648]], ["41"]])("refuses gift ids that are not ids: %j", (ids) => {
    expect(thanksPostSchema.safeParse({ message: "Thanks", donationIds: ids }).success).toBe(false);
  });

  it(`allows ${THANKS_PER_DAY} thank yous in a day for one fundraiser`, () => {
    expect(thanksLimitReached(THANKS_PER_DAY - 1)).toBe(false);
    expect(thanksLimitReached(THANKS_PER_DAY)).toBe(true);
  });
});

describe("the gifts an organiser can pick", () => {
  it("shows only what the gifts list shows: a name or Anonymous, the amount unless hidden, the message, the date", () => {
    const out = thankableGifts([gift(), gift({ donationId: 42, showName: false, showAmount: false, message: null, createdAt: "2026-09-30T10:00:00.000Z" })], new Set());
    expect(out).toEqual([
      { donationId: 41, name: "Alex E.", amountPence: 2000, giftAidPence: null, message: "Go Sam!", createdAt: "2026-10-01T10:00:00.000Z", thanked: false },
      { donationId: 42, name: "Anonymous", amountPence: null, giftAidPence: null, message: null, createdAt: "2026-09-30T10:00:00.000Z", thanked: false },
    ]);
    expect(JSON.stringify(out)).not.toContain("Example");
  });

  it("leaves out money the organiser paid in, and gifts refunded in full", () => {
    const out = thankableGifts([gift({ donationId: 1, paidIn: true }), gift({ donationId: 2, refundedPence: 2000 }), gift({ donationId: 3, refundedPence: 500 })], new Set());
    expect(out.map((g) => g.donationId)).toEqual([3]);
  });

  it("marks a gift already in a thank you as thanked", () => {
    const out = thankableGifts([gift({ donationId: 41 }), gift({ donationId: 42, createdAt: "2026-09-30T10:00:00.000Z" })], new Set([42]));
    expect(out.map((g) => [g.donationId, g.thanked])).toEqual([
      [41, false],
      [42, true],
    ]);
  });

  it("keeps a message staff hid off the list", () => {
    expect(thankableGifts([gift({ hidden: true })], new Set())[0].message).toBeNull();
  });
});

describe("what the organiser is told about a thank you", () => {
  it.each([
    [row({ status: "pending" }), "Waiting for us to check"],
    [row({ status: "rejected" }), "Not sent"],
    [row({ status: "approved", waiting: 2 }), "Sending now"],
    [row({ status: "approved", deliveredAt: "2026-10-02T11:00:00.000Z", sent: 1, skipped: 1 }), "Sent to 1 supporter"],
    [row({ status: "approved", deliveredAt: "2026-10-02T11:00:00.000Z", sent: 4 }), "Sent to 4 supporters"],
    [row({ status: "approved", deliveredAt: "2026-10-02T11:00:00.000Z", sent: 0, skipped: 2 }), "Not sent"],
  ])("%#: says %s", (r, words) => {
    expect(thanksStatusWords(r)).toBe(words);
  });

  it("shows the organiser the words, the count and the status, never staff's reason or who decided", () => {
    const out = forOrganiser(row({ status: "rejected", rejectReason: "Mentions a giver by name", decidedBy: "admin:fern@example.com", skipped: 1 }));
    expect(out).toEqual({
      id: 3,
      message: "Thank you so much!",
      status: "rejected",
      statusWords: "Not sent",
      createdAt: "2026-10-02T10:00:00.000Z",
      gifts: 2,
    });
  });
});

describe("who NBCC may email", () => {
  // As NBCC's own thank you letters: only a giver whose thank you consent is on. It is written from
  // the newsletter tick box when they give, and turned off by "Stop all emails" in the preference
  // centre, which cannot be told apart from never ticking it, so off always means no.
  const giver = { email: "alex@example.com", emailConsent: true, thankyouConsent: true };

  it("emails a giver who has an address and whose thank you consent is on", () => {
    expect(recipientVerdict(giver, false)).toEqual({ send: true });
    expect(recipientVerdict({ ...giver, emailConsent: false }, false)).toEqual({ send: true });
  });

  it("skips a giver with no address", () => {
    expect(recipientVerdict({ ...giver, email: null }, false)).toEqual({ send: false, reason: "no_email" });
    expect(recipientVerdict({ ...giver, email: "  " }, false)).toEqual({ send: false, reason: "no_email" });
  });

  it("skips an address on the suppression list (a bounce, a complaint or stopped by staff)", () => {
    expect(recipientVerdict(giver, true)).toEqual({ send: false, reason: "suppressed" });
  });

  it("skips a giver whose thank you consent is off: turned off, stopped everything, or never given", () => {
    expect(recipientVerdict({ ...giver, thankyouConsent: false }, false)).toEqual({ send: false, reason: "opted_out" });
    expect(recipientVerdict({ ...giver, emailConsent: false, thankyouConsent: false }, false)).toEqual({ send: false, reason: "opted_out" });
  });
});
