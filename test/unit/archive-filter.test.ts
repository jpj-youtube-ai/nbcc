import { describe, it, expect } from "vitest";
import { parseArchiveView, archiveCondition, type ArchiveView } from "../../src/admin/archive-filter";

// TASK-311: archiving replaces deleting as the everyday action on the public-form pages.
//
// Three stories were permanently deleted from production and nothing could say what had gone, when
// or why - the table was simply empty. Archiving makes the routine action reversible. But it only
// helps if the two views stay honest: an archived item leaking back into the working list makes the
// feature pointless, and a live item hidden from it looks exactly like the data loss we are fixing.
//
// So the condition is decided in one pure place rather than hand-written into each query, and the
// default is pinned: anything unrecognised means the LIVE view, because that is the one somebody is
// looking at when they are trying to do their job.

describe("reading the requested view (TASK-311)", () => {
  it("defaults to live when nothing is asked for", () => {
    expect(parseArchiveView(undefined)).toBe("live");
    expect(parseArchiveView("")).toBe("live");
  });

  it("understands the three views", () => {
    expect(parseArchiveView("live")).toBe("live");
    expect(parseArchiveView("archived")).toBe("archived");
    expect(parseArchiveView("all")).toBe("all");
  });

  it("falls back to live for anything it does not recognise", () => {
    // A typo in a query string must not quietly empty somebody's working list, and must never
    // silently widen it to include archived rows either.
    expect(parseArchiveView("ARCHIVED!")).toBe("live");
    expect(parseArchiveView("everything")).toBe("live");
    expect(parseArchiveView(42)).toBe("live");
    expect(parseArchiveView(null)).toBe("live");
  });
});

describe("the SQL condition each view produces (TASK-311)", () => {
  it("hides archived rows from the working list", () => {
    expect(archiveCondition("live")).toBe("archived_at IS NULL");
  });

  it("shows only archived rows in the archive", () => {
    expect(archiveCondition("archived")).toBe("archived_at IS NOT NULL");
  });

  it("adds no condition at all for the combined view", () => {
    // Null, not an always-true string: the caller appends conditions, and "TRUE" would leave a
    // stray fragment in every query for no reason.
    expect(archiveCondition("all")).toBeNull();
  });

  it("qualifies the column when a table alias is in play", () => {
    // The stories list joins nothing today, but the contact query and any future join need this or
    // the condition is ambiguous.
    expect(archiveCondition("live", "q")).toBe("q.archived_at IS NULL");
    expect(archiveCondition("archived", "q")).toBe("q.archived_at IS NOT NULL");
  });

  it("never produces a condition that could match both states", () => {
    const views: ArchiveView[] = ["live", "archived"];
    const conditions = views.map((v) => archiveCondition(v));
    expect(new Set(conditions).size).toBe(2);
    expect(conditions.every((c) => c && c.includes("archived_at"))).toBe(true);
  });
});
