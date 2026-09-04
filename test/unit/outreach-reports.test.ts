import { describe, it, expect } from "vitest";
import {
  buildFunnel,
  buildMoneyRaised,
  buildByVolunteer,
  buildPersonalMessageEffect,
  ENOUGH_TO_COMPARE,
  type ReportRow,
} from "../../src/outreach/reports";

// TASK-413: is any of this working, and what works best?
//
// These figures may end up in front of trustees, so the tests are written around the ways a report
// can be quietly wrong: dividing by a number that includes businesses which have not had their
// chance yet, dressing a name guess as a fact, and calling three sends out of four a success rate.

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  outcome: null,
  sentAt: null,
  owner: null,
  sentWithPersonalMessage: null,
  raisedPence: 0,
  ...over,
});

const SENT = "2026-08-01T09:00:00Z";

describe("the funnel", () => {
  const rows = [
    row(),                                                   // added, never emailed
    row({ sentAt: SENT }),                                   // emailed, nothing back
    row({ sentAt: SENT, outcome: "no_reply" }),              // emailed, silence recorded
    row({ sentAt: SENT, outcome: "interested" }),            // replied
    row({ sentAt: SENT, outcome: "declined" }),              // replied, and said no
    row({ sentAt: SENT, outcome: "signed_up" }),             // replied, and signed up
  ];
  const f = buildFunnel(rows);

  it("counts each stage", () => {
    expect(f).toMatchObject({ added: 6, emailed: 5, replied: 3, signedUp: 1 });
  });

  // A "no" is a reply. Counting only the good news would make the reply rate meaningless and the
  // charity think its email was being ignored when it was being read and answered.
  it("counts a decline as a reply", () => {
    expect(buildFunnel([row({ sentAt: SENT, outcome: "declined" })]).replied).toBe(1);
  });

  it("does not count recorded silence as a reply", () => {
    expect(buildFunnel([row({ sentAt: SENT, outcome: "no_reply" })]).replied).toBe(0);
  });

  // The trap. A business sitting on the list with no address has not declined to reply, and
  // putting it in the denominator punishes the charity for having a to-do item.
  it("works both rates out of those emailed, not those added", () => {
    expect(f.replyRate).toBe(60); // 3 of 5 emailed, not 3 of 6 added
    expect(f.signUpRate).toBe(20); // 1 of 5
  });

  // Zero out of zero is not nought per cent, and showing "0%" on day one would read as failure.
  it("gives no rate at all before anybody has been emailed", () => {
    const early = buildFunnel([row(), row()]);
    expect(early.replyRate).toBeNull();
    expect(early.signUpRate).toBeNull();
  });

  it("copes with nothing at all", () => {
    expect(buildFunnel([])).toMatchObject({ added: 0, emailed: 0, replyRate: null });
  });
});

describe("money raised", () => {
  it("adds up only what linked supporters actually gave", () => {
    const m = buildMoneyRaised([
      row({ outcome: "signed_up", raisedPence: 12000 }),
      row({ outcome: "signed_up", raisedPence: 3000 }),
      row({ outcome: "interested" }),
    ]);
    expect(m).toEqual({ supporters: 2, totalPence: 15000, averagePence: 7500 });
  });

  // A business marked "signed up" that nobody linked to a donor contributes nothing, because we
  // do not know what it gave. Guessing by name would be a figure nobody could stand behind.
  it("ignores a sign-up that was never linked to a donor", () => {
    expect(buildMoneyRaised([row({ outcome: "signed_up", raisedPence: 0 })]).supporters).toBe(0);
  });

  it("gives no average rather than a misleading zero", () => {
    expect(buildMoneyRaised([]).averagePence).toBeNull();
  });
});

describe("how each volunteer has got on", () => {
  const rows = [
    row({ sentAt: SENT, owner: "Sarah", outcome: "signed_up" }),
    row({ sentAt: SENT, owner: "Sarah", outcome: "no_reply" }),
    row({ sentAt: SENT, owner: "Jaimie", outcome: "interested" }),
    row({ owner: "Jaimie" }), // added but never emailed
    row({ sentAt: SENT, owner: null, outcome: "signed_up" }),
  ];
  const tallies = buildByVolunteer(rows);

  // Somebody who added ten businesses and emailed none has not failed at anything.
  it("counts only what was actually sent", () => {
    expect(tallies.find((t) => t.owner === "Jaimie")).toMatchObject({ emailed: 1, signedUp: 0 });
  });

  // Real work. Hiding it would make the columns stop adding up to the funnel.
  it("groups unassigned work rather than dropping it", () => {
    expect(tallies.find((t) => t.owner === "Nobody assigned")).toMatchObject({ emailed: 1, signedUp: 1 });
  });

  // One sign-up from one email is not a hundred per cent success story, and sorting by rate would
  // park it at the top of the table for ever.
  it("orders by sign-ups, not by rate", () => {
    expect(tallies[0].signedUp).toBeGreaterThanOrEqual(tallies[tallies.length - 1].signedUp);
    expect(tallies.map((t) => t.owner)).toContain("Sarah");
  });

  it("works out each rate out of that volunteer's own sends", () => {
    expect(tallies.find((t) => t.owner === "Sarah")?.signUpRate).toBe(50);
  });
});

describe("does a personal message help?", () => {
  const many = (n: number, over: Partial<ReportRow>) => Array.from({ length: n }, () => row(over));

  it("compares the two sides", () => {
    const e = buildPersonalMessageEffect([
      ...many(8, { sentAt: SENT, sentWithPersonalMessage: true, outcome: "signed_up" }),
      ...many(4, { sentAt: SENT, sentWithPersonalMessage: true }),
      ...many(2, { sentAt: SENT, sentWithPersonalMessage: false, outcome: "signed_up" }),
      ...many(10, { sentAt: SENT, sentWithPersonalMessage: false }),
    ]);
    expect(e.withMessage).toMatchObject({ emailed: 12, signedUp: 8 });
    expect(e.without).toMatchObject({ emailed: 12, signedUp: 2 });
    expect(e.worthReading).toBe(true);
  });

  // The honest part. With four sends on one side, one sign-up swings the rate by twenty points,
  // and a charity could reasonably change how it works on the strength of nothing at all.
  it("says outright when there is not enough to compare yet", () => {
    const e = buildPersonalMessageEffect([
      ...many(3, { sentAt: SENT, sentWithPersonalMessage: true, outcome: "signed_up" }),
      ...many(1, { sentAt: SENT, sentWithPersonalMessage: false }),
    ]);
    expect(e.worthReading).toBe(false);
  });

  it("needs enough on BOTH sides, not just one", () => {
    const e = buildPersonalMessageEffect([
      ...many(ENOUGH_TO_COMPARE + 5, { sentAt: SENT, sentWithPersonalMessage: true }),
      ...many(2, { sentAt: SENT, sentWithPersonalMessage: false }),
    ]);
    expect(e.worthReading).toBe(false);
  });

  // Sends from before this was recorded are neither one thing nor the other, and putting them in
  // the "without" column would invent a result.
  it("leaves out sends made before we started recording it", () => {
    const e = buildPersonalMessageEffect([row({ sentAt: SENT, sentWithPersonalMessage: null })]);
    expect(e.withMessage.emailed).toBe(0);
    expect(e.without.emailed).toBe(0);
  });
});
