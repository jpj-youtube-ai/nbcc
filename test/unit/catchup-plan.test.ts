import { describe, it, expect } from "vitest";
import { buildCatchupPlan, catchupMessage, type CatchupDonor } from "../../src/outreach/catchup-plan";

// The preference link is injected, so the planner signs nothing and the tests need no secret.
const linkFor = (donorId: number) => `https://nbcc.scot/preferences/tok-${donorId}`;
const planFor = (donors: CatchupDonor[]) => buildCatchupPlan(donors, linkFor);

// TASK-438. Fiona McIlloney, Mrs I J McFarlane and Jodie McFarlane have each given £10 a month
// since May. Until TASK-430 imported them there was no record of any of it, so in four months they
// have had no thank-you, no receipt and no Gift Aid request.
//
// This decides what each of them is sent. It is pure, because what a letter tells somebody about
// their own giving — and whether they are asked to make a legal declaration to HMRC — are the parts
// worth being certain about.

const donation = (id: number, iso: string, pence = 1000, declarationStatus = "not_required") => ({
  id,
  amountPence: pence,
  paidAt: new Date(iso),
  declarationStatus,
});

const fiona = (over: Partial<CatchupDonor> = {}): CatchupDonor => ({
  donorId: 16,
  fullName: "Fiona McIlloney",
  email: "fionamcilloney@btinternet.com",
  alreadyThanked: false,
  donations: [
    donation(1, "2026-05-21T10:00:00Z"),
    donation(2, "2026-06-19T10:00:00Z"),
    donation(3, "2026-07-19T10:00:00Z"),
    donation(4, "2026-08-19T10:00:00Z"),
    donation(5, "2026-09-19T10:00:00Z"),
  ],
  ...over,
});

describe("what the letter says they gave", () => {
  // The automatic business letter uses the MONTHLY amount, because it goes out days after somebody
  // signs up when one payment has been taken. This is a catch-up covering five months, so the same
  // choice would thank Fiona for a fifth of what she has actually given.
  it("thanks them for the total, not one month of it", () => {
    const plan = planFor([fiona()]);
    expect(plan.entries[0].letter.giftAmountPence).toBe(5000);
    expect(plan.totalPence).toBe(5000);
  });

  it("still knows the monthly figure, for the note", () => {
    const plan = planFor([fiona()]);
    expect(plan.entries[0].monthlyPence).toBe(1000);
    expect(plan.entries[0].months).toBe(5);
  });

  // Nobody has declared Gift Aid. A letter saying HMRC adds 25% would tell somebody something
  // untrue about their own tax, which is the one thing in a thank-you that must not be wrong.
  it("never claims Gift Aid was added", () => {
    expect(planFor([fiona()]).entries[0].letter.giftAided).toBe(false);
  });
});

describe("the note in the letter", () => {
  const msg = catchupMessage({
    monthlyPence: 1000,
    totalPence: 5000,
    firstMonth: "May",
    preferencesLink: "https://nbcc.scot/preferences/tok-16",
  });

  it("says what they have given and since when", () => {
    expect(msg).toContain("£10 a month since May");
    expect(msg).toContain("£50");
  });

  // Four months of silence is the charity's fault, and the letter says so rather than explaining
  // the plumbing that caused it.
  it("apologises for the silence without making it their problem", () => {
    expect(msg).toMatch(/sorry/i);
    expect(msg).toMatch(/our fault/i);
  });

  // THE point of this note. Their consent record says false because they signed up through Stripe
  // before there was a form to ask on — they were never asked, they did not decline. So the letter
  // asks, rather than the charity assuming either way.
  it("asks whether they want to hear from us, rather than assuming", () => {
    expect(msg).toMatch(/never asked/i);
    expect(msg).toMatch(/asking rather than assuming/i);
  });

  // "Sign up at nbcc.scot" asks somebody to go and find a form. This is their own page, already
  // addressed to them, with the boxes on it - the difference between a reply and no reply.
  it("gives them their own one-click link rather than a website to go and find", () => {
    expect(msg).toContain("https://nbcc.scot/preferences/tok-16");
    expect(msg).toMatch(/one click/i);
    expect(msg).toMatch(/nothing to fill in/i);
  });

  // Doing nothing has to be a real option, and has to be the easy one.
  it("makes ignoring it a stated choice, not a failure to act", () => {
    expect(msg).toMatch(/ignore it and nothing will change/i);
  });

  // The Gift Aid link arrives in its own email (the formal declaration one), so the letter says so
  // rather than leaving a second message looking like a duplicate.
  it("tells them the Gift Aid email is coming, and what it is worth", () => {
    expect(msg).toMatch(/gift aid adds 25%/i);
    expect(msg).toMatch(/separate email/i);
    expect(msg).toMatch(/no cost to you/i);
  });
});

describe("the Gift Aid invitation", () => {
  it("is addressed to one of their donations", () => {
    const ga = planFor([fiona()]).entries[0].giftAid;
    expect(ga).not.toBeNull();
    expect(ga?.donationId).toBe(5); // the most recent
    expect(ga?.amountPence).toBe(1000);
  });

  // A donation already part-way through the declaration flow has a link of its own out there.
  // Issuing a second would be two routes to the same declaration.
  it("skips a donation that already has a declaration under way", () => {
    const partway = fiona({
      donations: [
        donation(1, "2026-05-21T10:00:00Z", 1000, "not_required"),
        donation(2, "2026-06-19T10:00:00Z", 1000, "sent"),
      ],
    });
    expect(planFor([partway]).entries[0].giftAid?.donationId).toBe(1);
  });

  it("offers no invitation when every donation is already spoken for", () => {
    const allSent = fiona({
      donations: [donation(1, "2026-05-21T10:00:00Z", 1000, "completed")],
    });
    const entry = planFor([allSent]).entries[0];
    expect(entry.giftAid).toBeNull();
    // They are still thanked. The letter does not depend on the declaration.
    expect(entry.letter.giftAmountPence).toBe(1000);
  });
});

describe("refusing to send", () => {
  it("will not write to somebody with no email address", () => {
    const plan = planFor([fiona({ email: null })]);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/email/i);
  });

  it("will not thank somebody for nothing", () => {
    const plan = planFor([fiona({ donations: [] })]);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/no paid donations/i);
  });

  // One letter per donor is final, everywhere else in this system. A second would undo the meaning
  // of the first, and a re-run of this script must not produce one.
  it("will not thank somebody twice", () => {
    const plan = planFor([fiona({ alreadyThanked: true })]);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/already thanked/i);
  });
});

describe("all three of them", () => {
  it("totals what is about to go out, so the number can be checked", () => {
    const plan = planFor([
      fiona(),
      fiona({ donorId: 17, fullName: "Mrs I J McFarlane", email: "bellemcf@hotmail.co.uk" }),
      fiona({ donorId: 18, fullName: "Jodie McFarlane", email: "jodie.john@yahoo.co.uk" }),
    ]);
    expect(plan.entries).toHaveLength(3);
    expect(plan.totalPence).toBe(15000);
    // Each is addressed personally, not to a list.
    expect(plan.entries.map((e) => e.letter.addressedTo)).toEqual([
      "Fiona McIlloney", "Mrs I J McFarlane", "Jodie McFarlane",
    ]);
  });
});
