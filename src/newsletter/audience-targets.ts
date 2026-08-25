// TASK-282: one person, or one spreadsheet, going to SEVERAL audiences at once.
//
// The rules live here rather than in the route handler because they decide what gets written to
// whom, and that is the part worth pinning with tests that do not need a database. The route stays
// a thin shell: authorise, parse, loop the already-proven addListSubscriber, fold, audit.

export const MAX_TARGETS = 20;

// Mirrors AddSubscriberOutcome in src/db/subscriber-lists.ts. Kept as its own name so this module
// stays DB-free and testable without a pool; tsc catches any drift at the call site.
export type AddOutcome = "added" | "exists" | "resubscribed" | "previously_unsubscribed";

export interface TargetOutcome {
  listId: number;
  listName: string;
  outcome: AddOutcome;
}

export interface FoldedOutcomes {
  added: number;
  /**
   * A membership REVIVED from an opt-out. Counted apart from `added` on purpose: somebody who once
   * asked us to stop has just been switched back on, and folding that into "added" would hide a
   * re-consent inside a routine-looking confirmation. Only a deliberate staff add can produce it
   * (revive: true); an import never can.
   */
  resubscribed: number;
  alreadyOnList: number;
  previouslyUnsubscribed: number;
  /** Audiences the person actually joined - what the confirmation says back. */
  addedTo: string[];
  /** Audiences where they were switched back on, named so the confirmation can say so plainly. */
  resubscribedTo: string[];
  /** Anything that actually changed. Zero means the whole action was a no-op. */
  changed: number;
  perList: TargetOutcome[];
}

/**
 * Validate the audiences a write is aimed at.
 *
 * Returns null (not an empty array) for anything invalid, so a caller cannot mistake "nothing
 * selected" for "proceed with no targets" - a silent no-op that reports success is the worst
 * outcome here, because the volunteer walks away believing the person was added.
 *
 * Duplicates are dropped rather than rejected: two ticks resolving to the same audience is a UI
 * accident, not an error worth refusing, and writing the same membership twice is pointless.
 */
export function parseTargetListIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > MAX_TARGETS) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Fold per-audience results into the one summary the UI and the audit row both read. */
export function foldOutcomes(results: TargetOutcome[]): FoldedOutcomes {
  const folded: FoldedOutcomes = {
    added: 0,
    resubscribed: 0,
    alreadyOnList: 0,
    previouslyUnsubscribed: 0,
    addedTo: [],
    resubscribedTo: [],
    changed: 0,
    perList: results,
  };
  for (const r of results) {
    if (r.outcome === "added") {
      folded.added++;
      folded.addedTo.push(r.listName);
    } else if (r.outcome === "resubscribed") {
      folded.resubscribed++;
      folded.resubscribedTo.push(r.listName);
    } else if (r.outcome === "exists") folded.alreadyOnList++;
    else folded.previouslyUnsubscribed++;
  }
  folded.changed = folded.added + folded.resubscribed;
  return folded;
}
