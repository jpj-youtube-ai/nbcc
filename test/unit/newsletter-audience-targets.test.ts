import { describe, it, expect } from "vitest";
import { parseTargetListIds, foldOutcomes, MAX_TARGETS } from "../../src/newsletter/audience-targets";

describe("parseTargetListIds", () => {
  it("accepts a list of positive integers", () => {
    expect(parseTargetListIds([3, 7, 11])).toEqual([3, 7, 11]);
  });

  it("removes duplicates so one audience cannot be written twice", () => {
    expect(parseTargetListIds([4, 4, 9])).toEqual([4, 9]);
  });

  it("rejects an empty selection rather than silently doing nothing", () => {
    expect(parseTargetListIds([])).toBeNull();
  });

  it("rejects anything that is not a positive integer id", () => {
    expect(parseTargetListIds([1, 0])).toBeNull();
    expect(parseTargetListIds([1, -2])).toBeNull();
    expect(parseTargetListIds([1, 2.5])).toBeNull();
    expect(parseTargetListIds(["3"])).toBeNull();
    expect(parseTargetListIds("3")).toBeNull();
    expect(parseTargetListIds(undefined)).toBeNull();
  });

  it("refuses an absurd number of audiences", () => {
    const many = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => i + 1);
    expect(parseTargetListIds(many)).toBeNull();
  });
});

describe("foldOutcomes", () => {
  it("counts each outcome and keeps the per-audience detail", () => {
    const folded = foldOutcomes([
      { listId: 3, listName: "Volunteers", outcome: "added" },
      { listId: 7, listName: "Newsletter", outcome: "exists" },
      { listId: 9, listName: "Bag packers", outcome: "previously_unsubscribed" },
    ]);
    expect(folded.added).toBe(1);
    expect(folded.alreadyOnList).toBe(1);
    expect(folded.previouslyUnsubscribed).toBe(1);
    expect(folded.perList).toHaveLength(3);
    expect(folded.addedTo).toEqual(["Volunteers"]);
  });

  it("reports nothing added when every audience already had them", () => {
    const folded = foldOutcomes([
      { listId: 3, listName: "Volunteers", outcome: "exists" },
      { listId: 7, listName: "Newsletter", outcome: "exists" },
    ]);
    expect(folded.added).toBe(0);
    expect(folded.addedTo).toEqual([]);
  });
});
