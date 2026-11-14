import { describe, it, expect } from "vitest";
import { buildListCounts, inListFilter, LIST_FILTERS, type CountRow } from "../../src/outreach/list-counts";
import { buildFunnel } from "../../src/outreach/reports";

// Admin refresh (2026-11-14): the counts on Contact businesses. They used to be counted in the
// browser from the newest 200 businesses, so they went quietly wrong on a longer list. They are
// worked out here, over every business, and the tiles that filter the list use the same rule.
// Every business and address is invented.

const ME = "fern@example.com";
const row = (over: Partial<CountRow>): CountRow => ({ outcome: null, sentAt: null, ownerEmail: null, ...over });
const SENT = "2026-10-01T09:00:00.000Z";

describe("where each business stands, for the tiles", () => {
  it("is waiting to be emailed until it is emailed or something is recorded", () => {
    expect(inListFilter(row({}), "waiting", ME)).toBe(true);
    expect(inListFilter(row({ sentAt: SENT }), "waiting", ME)).toBe(false);
    // Rang them instead, and they said no: nobody is waiting to email them.
    expect(inListFilter(row({ outcome: "declined" }), "waiting", ME)).toBe(false);
  });

  it("is emailed and no answer only while nothing has been recorded", () => {
    expect(inListFilter(row({ sentAt: SENT }), "noAnswer", ME)).toBe(true);
    expect(inListFilter(row({ sentAt: SENT, outcome: "interested" }), "noAnswer", ME)).toBe(false);
    expect(inListFilter(row({}), "noAnswer", ME)).toBe(false);
  });

  it("counts the three warm answers as interested, and nothing else", () => {
    for (const outcome of ["interested", "asked_for_info", "passed_on"]) {
      expect(inListFilter(row({ outcome }), "interested", ME), outcome).toBe(true);
    }
    for (const outcome of ["signed_up", "not_this_year", "declined", "no_reply", null]) {
      expect(inListFilter(row({ outcome }), "interested", ME), String(outcome)).toBe(false);
    }
  });

  it("knows signed up from said no", () => {
    expect(inListFilter(row({ outcome: "signed_up" }), "signedUp", ME)).toBe(true);
    expect(inListFilter(row({ outcome: "declined" }), "signedUp", ME)).toBe(false);
    expect(inListFilter(row({ outcome: "declined" }), "saidNo", ME)).toBe(true);
    // Not this year is not a no: they asked to be asked again.
    expect(inListFilter(row({ outcome: "not_this_year" }), "saidNo", ME)).toBe(false);
  });

  it("is mine only when it is looked after by the person signed in, whatever the capitals", () => {
    expect(inListFilter(row({ ownerEmail: "Fern@Example.com" }), "mine", ME)).toBe(true);
    expect(inListFilter(row({ ownerEmail: "someone.else@example.com" }), "mine", ME)).toBe(false);
    expect(inListFilter(row({ ownerEmail: null }), "mine", ME)).toBe(false);
    expect(inListFilter(row({ ownerEmail: null }), "mine", "")).toBe(false);
  });
});

describe("the counts over every business", () => {
  const rows: CountRow[] = [
    row({}),
    row({ ownerEmail: ME }),
    row({ sentAt: SENT }),
    row({ sentAt: SENT, ownerEmail: ME }),
    row({ sentAt: SENT, outcome: "interested" }),
    row({ sentAt: SENT, outcome: "asked_for_info" }),
    row({ sentAt: SENT, outcome: "signed_up", ownerEmail: ME }),
    row({ sentAt: SENT, outcome: "declined" }),
    row({ sentAt: SENT, outcome: "no_reply" }),
    row({ outcome: "declined" }),
  ];
  const counts = buildListCounts(rows, ME);

  it("counts each tile", () => {
    expect(counts).toMatchObject({ total: 10, waiting: 2, noAnswer: 2, interested: 2, signedUp: 1, saidNo: 2, mine: 3 });
  });

  it("has one count for every filter the screen offers", () => {
    for (const f of LIST_FILTERS) expect(typeof counts[f], f).toBe("number");
  });

  // The line at the top of the screen and "Is it working?" must never disagree.
  it("counts emailed and replied exactly as the report does", () => {
    const funnel = buildFunnel(rows.map((r) => ({ ...r, owner: null, sentWithPersonalMessage: null, raisedPence: 0 })));
    expect(counts.emailed).toBe(funnel.emailed);
    expect(counts.replied).toBe(funnel.replied);
    expect(counts.signedUp).toBe(funnel.signedUp);
    expect(counts.emailed).toBe(7);
    expect(counts.replied).toBe(4);
  });

  it("is all noughts for an empty list", () => {
    expect(buildListCounts([], ME)).toEqual({
      total: 0, waiting: 0, noAnswer: 0, interested: 0, signedUp: 0, saidNo: 0, mine: 0, emailed: 0, replied: 0,
    });
  });
});
