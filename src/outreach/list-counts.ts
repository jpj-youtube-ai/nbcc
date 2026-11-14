import { isEngagement, isOutcome } from "./outcomes";
import type { Outcome } from "./model";

// Admin refresh (2026-11-14): the counts on Contact businesses, and the rule behind each tile that
// filters the list.
//
// Pure - no pool, no config - so the figures are unit-tested without a database (golden rule 5).
// They used to be counted in the browser from whatever part of the list it had been sent, which
// was the newest 200: on a longer list every count went quietly wrong. The route hands this every
// business (three columns each), so the counts are true however long the list is.
//
// KEEP IN SYNC with outInFilter in assets/js/admin/app.js, which filters the rows already in the
// browser by the same rule (test/unit/admin-outreach-refresh.test.ts holds the two together).

export interface CountRow {
  outcome: string | null;
  sentAt: string | null;
  ownerEmail: string | null;
}

/** The tiles a volunteer can press, in the order they are shown. */
export const LIST_FILTERS = ["waiting", "noAnswer", "interested", "signedUp", "saidNo", "mine"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export type ListCounts = Record<ListFilter, number> & {
  /** Every business on the list. */
  total: number;
  /** Emailed and replied, by the report's own rule, for the progress line at the top. */
  emailed: number;
  replied: number;
};

/** Warm, and nothing agreed: the three answers that are neither a yes nor a no. */
const WARM = ["interested", "asked_for_info", "passed_on"];

/** Is this business behind that tile? `myEmail` is whoever is signed in. */
export function inListFilter(r: CountRow, filter: ListFilter, myEmail: string): boolean {
  switch (filter) {
    // Not written to, and nothing recorded: a business rung instead, which said no, is not waiting.
    case "waiting":
      return !r.sentAt && !r.outcome;
    case "noAnswer":
      return !!r.sentAt && !r.outcome;
    case "interested":
      return !!r.outcome && WARM.includes(r.outcome);
    case "signedUp":
      return r.outcome === "signed_up";
    // Only a no. "Not this year" asked to be asked again, which is a different thing.
    case "saidNo":
      return r.outcome === "declined";
    case "mine":
      return !!myEmail && !!r.ownerEmail && r.ownerEmail.toLowerCase() === myEmail.toLowerCase();
  }
}

export function buildListCounts(rows: CountRow[], myEmail: string): ListCounts {
  const count = (filter: ListFilter) => rows.filter((r) => inListFilter(r, filter, myEmail)).length;
  return {
    total: rows.length,
    waiting: count("waiting"),
    noAnswer: count("noAnswer"),
    interested: count("interested"),
    signedUp: count("signedUp"),
    saidNo: count("saidNo"),
    mine: count("mine"),
    emailed: rows.filter((r) => r.sentAt).length,
    // The same rule as buildFunnel in reports.ts, so the line at the top of the screen and "Is it
    // working?" cannot disagree: emailed, and any answer except silence.
    replied: rows.filter(
      (r) => r.sentAt && r.outcome && isOutcome(r.outcome) && isEngagement(r.outcome as Outcome),
    ).length,
  };
}
