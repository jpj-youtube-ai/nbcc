// TASK-311: which rows a list view should show, decided once rather than hand-written per query.
//
// Archiving replaces deleting as the everyday action on the public-form pages, and it only helps if
// the two views stay honest. An archived item leaking back into the working list makes the feature
// pointless; a live item hidden from it looks exactly like the data loss this exists to prevent.
// One pure function, unit-tested, beats the same WHERE clause typed out in several places and
// getting one of them subtly wrong.

export type ArchiveView = "live" | "archived" | "all";

const VIEWS: readonly ArchiveView[] = ["live", "archived", "all"];

/**
 * Read a requested view from a query string.
 *
 * Anything unrecognised becomes "live" - a typo must not quietly empty somebody's working list, and
 * must never silently widen it to include archived rows either. Live is what a person is looking at
 * when they are trying to get something done, so it is the safe place to land.
 */
export function parseArchiveView(raw: unknown): ArchiveView {
  return typeof raw === "string" && (VIEWS as readonly string[]).includes(raw)
    ? (raw as ArchiveView)
    : "live";
}

/**
 * The SQL condition for a view, or null when the view needs no condition at all.
 *
 * Null rather than "TRUE": callers assemble a list of conditions, and a always-true fragment in
 * every query would be noise that means nothing.
 */
export function archiveCondition(view: ArchiveView, alias?: string): string | null {
  if (view === "all") return null;
  const column = alias ? `${alias}.archived_at` : "archived_at";
  return view === "archived" ? `${column} IS NOT NULL` : `${column} IS NULL`;
}
