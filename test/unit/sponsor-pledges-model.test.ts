import { describe, it, expect } from "vitest";
import {
  PLEDGE_MIN_PENCE,
  PLEDGE_WORDING_KEYS,
  PLEDGE_WORDING_VERSION,
  PAY_CATCH_UP_DAYS,
  RETENTION_DAYS,
  canPledge,
  fullName,
  payDueDay,
  payWhenWords,
  pledgeDeclarationWording,
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
import { SINGLE_DONATION_WORDING, hasFullLiabilityStatement } from "../../src/declarations/wording";

// Sponsor pledges (Jaimie, 2026-10-03): the rules, pure. A pledge is a promise, never money. Every
// name, address and amount here is invented.

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

describe("the Gift Aid declaration made with a pledge", () => {
  const w = pledgeDeclarationWording(1000);

  it("names the amount, says it is for when they pay it, and names the charity in full", () => {
    expect(w.wording_snapshot.startsWith("I want to Gift Aid my donation of £10 when I pay it, to the Night Before Christmas Campaign. ")).toBe(true);
  });

  it("ends with HMRC's liability sentence, word for word as on an online gift", () => {
    const liability = SINGLE_DONATION_WORDING.wording_snapshot.slice(SINGLE_DONATION_WORDING.wording_snapshot.indexOf("I am a UK taxpayer"));
    expect(w.wording_snapshot.endsWith(liability)).toBe(true);
    expect(hasFullLiabilityStatement(w.wording_snapshot)).toBe(true);
  });

  it("has a version of its own, so a claim can tell it from an online gift's declaration", () => {
    expect(w.wording_version).toBe(PLEDGE_WORDING_VERSION);
    expect(w.wording_version).not.toBe(SINGLE_DONATION_WORDING.wording_version);
  });

  it("shows pence only when there are some", () => {
    expect(pledgeDeclarationWording(1250).wording_snapshot).toContain("my donation of £12.50 when I pay it");
  });

  it("fits in a Stripe metadata value (500 characters)", () => {
    expect(pledgeDeclarationWording(999_999).wording_snapshot.length).toBeLessThanOrEqual(500);
  });
});

describe("which pages take pledges", () => {
  const today = "2026-11-01";

  it("a public, approved sponsorship page whose day is still to come", () => {
    expect(canPledge(fundraiser(), today)).toBe(true);
  });

  it("on the day itself, still", () => {
    expect(canPledge(fundraiser({ eventDate: today }), today)).toBe(true);
  });

  it("a page with no date, until it is finished", () => {
    expect(canPledge(fundraiser({ eventDate: null }), today)).toBe(true);
    expect(canPledge(fundraiser({ eventDate: null, status: "finished" }), today)).toBe(false);
  });

  it("a team member's page", () => {
    expect(canPledge(fundraiser({ teamId: 3 }), today)).toBe(true);
  });

  it.each([
    ["an event", { path: "event" as const }],
    ["a page in memory of someone", { inMemory: true }],
    ["a page in a memory category", { kind: "in_memory" }],
    ["the team page itself", { isTeam: true }],
    ["a page not public", { public: false }],
    ["a page waiting for approval", { status: "new" as const }],
    ["a declined page", { status: "declined" as const }],
    ["a page whose day has gone", { eventDate: "2026-10-31" }],
  ])("never %s", (_what, over) => {
    expect(canPledge(fundraiser(over), today)).toBe(false);
  });
});

describe("what the pledge form may send", () => {
  const good = { amountPence: 1000, firstName: "Alex", surname: "Example", email: "alex@example.com", showName: true, showAmount: true, giftAid: false };

  it("takes a plain pledge, tidying the email", () => {
    const r = pledgeSchema.safeParse({ ...good, email: "  Alex@Example.com " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("alex@example.com");
  });

  it("refuses under £2, in words", () => {
    const r = pledgeSchema.safeParse({ ...good, amountPence: PLEDGE_MIN_PENCE - 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("The smallest pledge is £2.");
  });

  it("refuses a fraction of a penny and a huge amount", () => {
    expect(pledgeSchema.safeParse({ ...good, amountPence: 1000.5 }).success).toBe(false);
    expect(pledgeSchema.safeParse({ ...good, amountPence: 100_000_000 }).success).toBe(false);
  });

  it("needs a first name, a surname and an email that looks like one", () => {
    for (const bad of [{ firstName: " " }, { surname: "" }, { email: "alex" }]) {
      expect(pledgeSchema.safeParse({ ...good, ...bad }).success).toBe(false);
    }
  });

  it("keeps the name off the wall unless they choose to show it", () => {
    const rest: Record<string, unknown> = { ...good };
    delete rest.showName;
    const r = pledgeSchema.safeParse(rest);
    expect(r.success && r.data.showName).toBe(false);
  });

  it("holds a message to 200 characters and refuses blocked words, like a gift's", () => {
    expect(pledgeSchema.safeParse({ ...good, message: "x".repeat(201) }).success).toBe(false);
    expect(pledgeSchema.safeParse({ ...good, message: "Go on, you can do it!" }).success).toBe(true);
    const rude = pledgeSchema.safeParse({ ...good, message: "fuck this" });
    expect(rude.success).toBe(false);
    if (!rude.success) expect(rude.error.issues[0].message).toBe("Please choose different words for your message.");
  });

  it("with Gift Aid, needs the house, the home address and a UK postcode", () => {
    const r = pledgeSchema.safeParse({ ...good, giftAid: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0]).sort()).toEqual(["address", "house", "postcode"]);
    expect(pledgeSchema.safeParse({ ...good, giftAid: true, house: "12", address: "Example Street, Exampleton", postcode: "KA1 1AA" }).success).toBe(true);
    expect(pledgeSchema.safeParse({ ...good, giftAid: true, house: "12", address: "Example Street, Exampleton", postcode: "nope" }).success).toBe(false);
  });

  it("with Gift Aid and a home outside the UK, needs the address but no postcode", () => {
    expect(pledgeSchema.safeParse({ ...good, giftAid: true, nonUk: true, address: "1 Example Road, Exampleville" }).success).toBe(true);
  });

  it("without Gift Aid, drops any address sent", () => {
    const r = pledgeSchema.safeParse({ ...good, house: "12", address: "Example Street", postcode: "KA1 1AA" });
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.house, r.data.address, r.data.postcode]).toEqual([null, null, null]);
  });
});

describe("when the pay email is due", () => {
  it("the day after the date", () => {
    expect(payDueDay(fundraiser({ eventDate: "2026-12-05" }))).toBe("2026-12-06");
    expect(payDueDay(fundraiser({ eventDate: "2026-12-31" }))).toBe("2027-01-01");
  });

  it("with no date, the day staff marked it finished (UK day)", () => {
    expect(payDueDay(fundraiser({ eventDate: null }))).toBeNull();
    expect(payDueDay(fundraiser({ eventDate: null, status: "finished", finishedAt: "2026-07-10T23:30:00.000Z" }))).toBe("2026-07-11");
  });

  it("finished before its date: when it was finished", () => {
    expect(payDueDay(fundraiser({ status: "finished", finishedAt: "2026-11-20T09:00:00.000Z" }))).toBe("2026-11-20");
  });

  it("the pay email goes from the day after the event, once", () => {
    const f = fundraiser();
    expect(pledgeEmailDue(pledge(), f, "2026-12-05")).toBeNull();
    expect(pledgeEmailDue(pledge(), f, "2026-12-06")).toBe("pledge_pay");
    expect(pledgeEmailDue(pledge({ payEmailClaimedAt: "2026-12-06T08:00:00.000Z" }), f, "2026-12-06")).toBeNull();
  });

  it("catches up a missed run, but not for ever", () => {
    const f = fundraiser({ eventDate: "2026-06-01" });
    expect(pledgeEmailDue(pledge(), f, "2026-06-20")).toBe("pledge_pay");
    const late = new Date(Date.parse("2026-06-02T12:00:00Z") + (PAY_CATCH_UP_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    expect(pledgeEmailDue(pledge(), f, late)).toBeNull();
  });

  it("one reminder, a week after the pay email, and then nothing", () => {
    const f = fundraiser();
    const sent = pledge({ payEmailClaimedAt: "2026-12-06T08:00:00.000Z", payEmailSentAt: "2026-12-06T08:00:05.000Z" });
    expect(pledgeEmailDue(sent, f, "2026-12-12")).toBeNull();
    expect(pledgeEmailDue(sent, f, "2026-12-13")).toBe("pledge_reminder");
    expect(pledgeEmailDue({ ...sent, reminderClaimedAt: "2026-12-13T08:00:00.000Z" }, f, "2026-12-14")).toBeNull();
    expect(pledgeEmailDue({ ...sent, reminderClaimedAt: "2026-12-13T08:00:00.000Z", reminderSentAt: "2026-12-13T08:00:03.000Z" }, f, "2027-01-30")).toBeNull();
    // A reminder weeks late would be stale.
    expect(pledgeEmailDue(sent, f, "2027-02-20")).toBeNull();
  });

  it.each(["paid", "cash", "cancelled", "expired"] as const)("never for a %s pledge", (status) => {
    expect(pledgeEmailDue(pledge({ status }), fundraiser(), "2026-12-06")).toBeNull();
  });

  it("never once the details have been removed", () => {
    expect(pledgeEmailDue(pledge({ email: null, anonymisedAt: "2026-12-01T00:00:00.000Z" }), fundraiser(), "2026-12-06")).toBeNull();
  });

  it("never for a page that is in memory, an event, declined or not public", () => {
    for (const over of [{ inMemory: true }, { path: "event" as const }, { status: "declined" as const }, { public: false }]) {
      expect(pledgeEmailDue(pledge(), fundraiser(over), "2026-12-06")).toBeNull();
    }
  });

  it("a finished page still gets them", () => {
    expect(pledgeEmailDue(pledge(), fundraiser({ status: "finished", finishedAt: "2026-12-05T18:00:00.000Z" }), "2026-12-06")).toBe("pledge_pay");
  });
});

describe("removing personal details", () => {
  const f = fundraiser();
  const day = (from: string, plus: number) => new Date(Date.parse(`${from}T12:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10);

  it(`an unpaid pledge is anonymised ${RETENTION_DAYS} days after its pay email`, () => {
    const p = pledge({ payEmailSentAt: "2026-12-06T08:00:00.000Z" });
    expect(retentionAction(p, f, day("2026-12-06", RETENTION_DAYS - 1))).toBeNull();
    expect(retentionAction(p, f, day("2026-12-06", RETENTION_DAYS))).toBe("anonymise");
  });

  it("one never emailed counts from the day the email was due", () => {
    expect(retentionAction(pledge(), f, day("2026-12-06", RETENTION_DAYS))).toBe("anonymise");
  });

  it("one on a page with no date that never finished goes a year after it was made", () => {
    const open = fundraiser({ eventDate: null });
    expect(retentionAction(pledge(), open, "2027-10-31")).toBeNull();
    expect(retentionAction(pledge(), open, "2027-11-01")).toBe("anonymise");
  });

  it("a cancelled or cash pledge goes too, counted from the pay email or from when it was marked", () => {
    expect(retentionAction(pledge({ status: "cancelled", cancelledAt: "2026-11-10T10:00:00.000Z" }), f, day("2026-11-10", RETENTION_DAYS))).toBe("anonymise");
    expect(retentionAction(pledge({ status: "cash", cashMarkedAt: "2026-11-10T10:00:00.000Z" }), f, day("2026-11-10", RETENTION_DAYS - 1))).toBeNull();
  });

  it("a paid pledge keeps its name, and loses its email after the same wait", () => {
    const paid = pledge({ status: "paid", paidAt: "2026-12-07T10:00:00.000Z", paidAmountPence: 1000 });
    expect(retentionAction(paid, f, day("2026-12-07", RETENTION_DAYS - 1))).toBeNull();
    expect(retentionAction(paid, f, day("2026-12-07", RETENTION_DAYS))).toBe("trim");
    expect(retentionAction({ ...paid, email: null }, f, day("2026-12-07", RETENTION_DAYS))).toBeNull();
  });

  it("never twice", () => {
    expect(retentionAction(pledge({ status: "expired", anonymisedAt: "2027-03-06T08:00:00.000Z", email: null }), f, "2028-01-01")).toBeNull();
  });
});

describe("the pledges on the page", () => {
  const rows = [
    pledge({ id: 1, createdAt: "2026-11-01T10:00:00.000Z", message: "Go on Robin!" }),
    pledge({ id: 2, firstName: "Sam", surname: "Sample", showName: false, amountPence: 2500, createdAt: "2026-11-02T10:00:00.000Z" }),
    pledge({ id: 3, firstName: "Jo", surname: "Bloggs", showAmount: false, createdAt: "2026-11-03T10:00:00.000Z", message: "Hidden words", messageHidden: true }),
    pledge({ id: 4, status: "paid", paidAmountPence: 1000 }),
    pledge({ id: 5, status: "cancelled" }),
    pledge({ id: 6, status: "cash" }),
  ];

  it("shows only pledges still to be paid, newest first, by a first name and an initial", () => {
    expect(publicPledges(rows)).toEqual([
      { name: "Jo B.", amountPence: null, message: null, createdAt: "2026-11-03T10:00:00.000Z" },
      { name: "Anonymous", amountPence: 2500, message: null, createdAt: "2026-11-02T10:00:00.000Z" },
      { name: "Alex E.", amountPence: 1000, message: "Go on Robin!", createdAt: "2026-11-01T10:00:00.000Z" },
    ]);
  });

  it("adds them up apart from the money raised", () => {
    expect(pledgeTotals(rows)).toEqual({
      openCount: 3,
      openPence: 4500,
      paidCount: 1,
      paidPence: 1000,
      cashCount: 1,
      cashPence: 1000,
      cancelledCount: 1,
      expiredCount: 0,
      refundedCount: 0,
      pledgedPence: 6500,
    });
  });

  it("counts what was actually paid, when a sponsor paid more than they pledged", () => {
    expect(pledgeTotals([pledge({ status: "paid", amountPence: 1000, paidAmountPence: 1500 })]).paidPence).toBe(1500);
  });

  it("says when they are to be paid", () => {
    expect(payWhenWords(fundraiser(), "Robin", "2026-11-01")).toBe("to be paid after Saturday 5 December 2026");
    expect(payWhenWords(fundraiser({ eventDate: null }), "Robin", "2026-11-01")).toBe("to be paid once Robin has finished");
    expect(payWhenWords(fundraiser(), "Robin", "2026-12-06")).toBe("still to be paid");
  });

  it("gives the organiser the sponsor's full name, or A sponsor once the details are gone", () => {
    expect(fullName(pledge())).toBe("Alex Example");
    expect(fullName(pledge({ firstName: null, surname: null }))).toBe("A sponsor");
  });

  it("says where each pledge is up to", () => {
    expect(statusWords(pledge())).toBe("Not paid yet");
    expect(statusWords(pledge({ payEmailSentAt: "2026-12-06T08:00:00.000Z" }))).toBe("Not paid yet, pay link sent");
    expect(statusWords(pledge({ status: "paid", paidAmountPence: 1000 }))).toBe("Paid online");
    expect(statusWords(pledge({ status: "paid", paidAmountPence: 1000, refunded: true }))).toBe("Paid online, then refunded");
    expect(statusWords(pledge({ status: "cash" }))).toBe("Paid you in cash");
    expect(statusWords(pledge({ status: "cancelled" }))).toBe("Cancelled");
    expect(statusWords(pledge({ status: "expired" }))).toBe("Not paid");
  });

  it("counts those still unpaid two weeks after the event, for the Monday summary", () => {
    const f = fundraiser();
    expect(unpaidTwoWeeksOn([{ p: pledge(), f }], "2026-12-18")).toBe(0);
    expect(unpaidTwoWeeksOn([{ p: pledge(), f }, { p: pledge({ status: "paid" }), f }, { p: pledge({ status: "cancelled" }), f }], "2026-12-19")).toBe(1);
    expect(unpaidTwoWeeksOn([{ p: pledge(), f: fundraiser({ eventDate: null }) }], "2027-06-01")).toBe(0);
  });
});

describe("the wording keys an admin signs off", () => {
  it("are the pay email and the reminder", () => {
    expect([...PLEDGE_WORDING_KEYS]).toEqual(["pledge_pay", "pledge_reminder"]);
  });
});
