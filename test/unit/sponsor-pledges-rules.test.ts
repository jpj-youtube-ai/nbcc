import { describe, it, expect } from "vitest";
import {
  CONFIRM_DAYS,
  OWN_MONEY_WORDS,
  PLEDGE_MAX_PENCE,
  doublePaidCount,
  parsePayAmount,
  payLinkRefusal,
  pledgeEmailDue,
  pledgeSchema,
  pledgeTotals,
  publicPledges,
  retentionAction,
  statusWords,
  unpaidTwoWeeksOn,
  type PledgeFundraiser,
  type PledgeRow,
} from "../../src/pledges/model";

// Sponsor pledges, the rules added after review (2026-10-03): a pledge counts for nothing until its
// sponsor confirms it by email; names are checked like messages; £1,000 is the most; an organiser can
// hide one; a refunded payment is not "paid"; a pledge paid twice is flagged; and staff can only send
// the pay link once it is due. Every name here is invented.

const fundraiser = (over: Partial<PledgeFundraiser> = {}): PledgeFundraiser => ({
  id: 7,
  path: "raising",
  public: true,
  status: "approved",
  kind: "run_walk",
  eventDate: "2026-12-05",
  isTeam: false,
  inMemory: false,
  finishedAt: null,
  ...over,
});

const pledge = (over: Partial<PledgeRow> = {}): PledgeRow => ({
  id: 1,
  fundraiserId: 7,
  firstName: "Alex",
  surname: "Example",
  email: "alex@example.com",
  amountPence: 1000,
  message: null,
  messageHidden: false,
  showName: true,
  showAmount: true,
  giftAid: false,
  status: "open",
  createdAt: "2026-11-01T10:00:00.000Z",
  payEmailClaimedAt: null,
  payEmailSentAt: null,
  reminderClaimedAt: null,
  reminderSentAt: null,
  paidAt: null,
  paidAmountPence: null,
  cashMarkedAt: null,
  cancelledAt: null,
  anonymisedAt: null,
  refunded: false,
  ...over,
});

describe("a pledge waiting for its sponsor to confirm", () => {
  const waiting = pledge({ status: "unconfirmed" });

  it("is not on the page", () => {
    expect(publicPledges([waiting])).toEqual([]);
  });

  it("counts in no total", () => {
    expect(pledgeTotals([waiting])).toMatchObject({ openCount: 0, openPence: 0, pledgedPence: 0 });
  });

  it("never gets the pay email or the reminder", () => {
    expect(pledgeEmailDue(waiting, fundraiser(), "2026-12-06")).toBeNull();
    expect(unpaidTwoWeeksOn([{ p: waiting, f: fundraiser() }], "2027-01-10")).toBe(0);
  });

  it(`is deleted ${CONFIRM_DAYS} days after it was made`, () => {
    expect(retentionAction(waiting, fundraiser(), "2026-11-07")).toBeNull();
    expect(retentionAction(waiting, fundraiser(), "2026-11-08")).toBe("delete");
  });

  it("says so to staff", () => {
    expect(statusWords(waiting)).toBe("Waiting for the sponsor to confirm by email");
  });
});

describe("what a sponsor may type", () => {
  const good = { amountPence: 1000, firstName: "Alex", surname: "Example", email: "alex@example.com" };

  it("checks the first name and the surname for blocked words, as it does a message", () => {
    for (const bad of [{ firstName: "Fuck" }, { surname: "Shit Head" }]) {
      const r = pledgeSchema.safeParse({ ...good, ...bad });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Please give your own name.");
    }
  });

  it("takes £1,000 and no more, asking for a call above that", () => {
    expect(PLEDGE_MAX_PENCE).toBe(100_000);
    expect(pledgeSchema.safeParse({ ...good, amountPence: 100_000 }).success).toBe(true);
    const r = pledgeSchema.safeParse({ ...good, amountPence: 100_001 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("For a pledge over £1,000, please call us on 01292 811 015.");
  });

  it("still lets them pay more than they pledged, up to £10,000", () => {
    expect(parsePayAmount("5000", 100_000)).toEqual({ pence: 500_000 });
    expect(parsePayAmount("10001", 1000)).toEqual({ error: "You can pay up to £10,000 here. For more, please call us on 01292 811 015." });
  });

  it("has the own money line for the Gift Aid tick", () => {
    expect(OWN_MONEY_WORDS).toBe("This gift is my own money.");
  });
});

describe("a pledge its organiser hid", () => {
  it("is off the page, and still counts", () => {
    const hidden = pledge({ hiddenAt: "2026-11-02T10:00:00.000Z" });
    expect(publicPledges([hidden, pledge({ id: 2 })]).length).toBe(1);
    expect(pledgeTotals([hidden]).openCount).toBe(1);
  });
});

describe("the totals", () => {
  it("leave a refunded payment out of what was paid, and out of what was pledged", () => {
    const t = pledgeTotals([
      pledge({ status: "paid", paidAmountPence: 1000 }),
      pledge({ id: 2, status: "paid", amountPence: 2000, paidAmountPence: 2000, refunded: true }),
    ]);
    expect(t).toMatchObject({ paidCount: 1, paidPence: 1000, refundedCount: 1, pledgedPence: 1000 });
  });

  it("count those paid twice that nobody has checked yet", () => {
    expect(
      doublePaidCount([
        pledge({ status: "paid", doublePaidAt: "2026-12-07T10:00:00.000Z" }),
        pledge({ id: 2, status: "paid", doublePaidAt: "2026-12-07T10:00:00.000Z", doublePaidCheckedAt: "2026-12-08T10:00:00.000Z" }),
        pledge({ id: 3, status: "paid" }),
      ]),
    ).toBe(1);
  });
});

describe("staff sending the pay link by hand", () => {
  const f = fundraiser();

  it("is refused before the link is due", () => {
    expect(payLinkRefusal(pledge(), f, "2026-12-05")).toBe("early");
    expect(payLinkRefusal(pledge(), fundraiser({ eventDate: null }), "2026-12-05")).toBe("early");
    expect(payLinkRefusal(pledge(), f, "2026-12-06")).toBeNull();
  });

  it("goes for a page with no date once it is marked finished", () => {
    expect(payLinkRefusal(pledge(), fundraiser({ eventDate: null, status: "finished", finishedAt: "2026-11-20T10:00:00.000Z" }), "2026-11-20")).toBeNull();
  });

  it("has no time limit after that: the daily task's window is the only rule it skips", () => {
    expect(payLinkRefusal(pledge({ payEmailSentAt: "2026-12-06T08:00:00.000Z" }), f, "2027-06-01")).toBeNull();
  });

  it("is refused for a pledge that is not open, or has no address left", () => {
    for (const over of [{ status: "unconfirmed" as const }, { status: "paid" as const }, { status: "cancelled" as const }, { email: null }, { anonymisedAt: "2027-01-01T00:00:00.000Z" }]) {
      expect(payLinkRefusal(pledge(over), f, "2026-12-06")).toBe("not_open");
    }
  });

  it("is refused when the page no longer has pledges on it", () => {
    for (const over of [{ public: false }, { status: "declined" as const }, { inMemory: true }, { path: "event" as const }]) {
      expect(payLinkRefusal(pledge(), fundraiser(over), "2026-12-06")).toBe("page");
    }
  });
});
