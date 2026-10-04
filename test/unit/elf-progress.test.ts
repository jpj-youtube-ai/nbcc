import { describe, it, expect } from "vitest";
import { RANKS, progressOf, promotionsBetween, rankAt } from "../../src/elf/progress";

// NBCC Elf Detective School: how far a detective has got. Pure, so every threshold is checked here.

const doors = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("doors done", () => {
  it("starts a new detective as a Trainee with six doors to the first promotion", () => {
    expect(progressOf({ cracked: [], visited: [] })).toEqual({
      doorsDone: 0,
      cracked: 0,
      visited: 0,
      rank: "Trainee",
      graduate: false,
      goldSeal: false,
      next: { rank: "Junior Detective", at: 6, toGo: 6 },
    });
  });

  it("counts a door once whether it was cracked, visited or both", () => {
    const p = progressOf({ cracked: [1, 2, 3], visited: [3, 4] });
    expect(p.doorsDone).toBe(4);
    expect(p.cracked).toBe(3);
    expect(p.visited).toBe(2);
  });

  it("ignores repeats and anything that is not a door", () => {
    const p = progressOf({ cracked: [1, 1, 0, 25, 2.5], visited: [1, 99] });
    expect(p.doorsDone).toBe(1);
    expect(p.cracked).toBe(1);
    expect(p.visited).toBe(1);
  });

  it("treats a list that is missing, as a database gives for no rows, as empty", () => {
    expect(progressOf({ cracked: null, visited: undefined }).doorsDone).toBe(0);
    expect(progressOf({ cracked: null, visited: doors(1, 6) }).rank).toBe("Junior Detective");
  });
});

describe("ranks", () => {
  it("promotes at 6, 12, 18 and 24 doors", () => {
    expect(RANKS.map((r) => [r.rank, r.at])).toEqual([
      ["Trainee", 0],
      ["Junior Detective", 6],
      ["Detective", 12],
      ["Senior Detective", 18],
      ["Graduate", 24],
    ]);
    expect(rankAt(5)).toBe("Trainee");
    expect(rankAt(6)).toBe("Junior Detective");
    expect(rankAt(11)).toBe("Junior Detective");
    expect(rankAt(12)).toBe("Detective");
    expect(rankAt(18)).toBe("Senior Detective");
    expect(rankAt(23)).toBe("Senior Detective");
    expect(rankAt(24)).toBe("Graduate");
  });

  it("makes a count that is not a real count of doors a Trainee, and stops at Graduate", () => {
    expect(rankAt(-5)).toBe("Trainee");
    expect(rankAt(Number.NaN)).toBe("Trainee");
    expect(rankAt(1000)).toBe("Graduate");
  });

  it("says what comes next and how many doors away it is", () => {
    expect(progressOf({ cracked: doors(1, 7), visited: [] }).next).toEqual({ rank: "Detective", at: 12, toGo: 5 });
    expect(progressOf({ cracked: doors(1, 24), visited: [] }).next).toBeNull();
  });
});

describe("the two finishes", () => {
  it("graduates a detective with all 24 doors done, cracked or visited", () => {
    const p = progressOf({ cracked: doors(1, 20), visited: doors(18, 24) });
    expect(p.doorsDone).toBe(24);
    expect(p.graduate).toBe(true);
    expect(p.rank).toBe("Graduate");
    expect(p.goldSeal).toBe(false);
  });

  it("gives the gold seal only for visiting all 24 places, never for cracking them", () => {
    expect(progressOf({ cracked: doors(1, 24), visited: doors(1, 23) }).goldSeal).toBe(false);
    expect(progressOf({ cracked: doors(1, 24), visited: [] }).goldSeal).toBe(false);
    expect(progressOf({ cracked: [], visited: doors(1, 24) }).goldSeal).toBe(true);
    expect(progressOf({ cracked: [], visited: doors(1, 24) }).graduate).toBe(true);
  });

  it("does not graduate at 23", () => {
    const p = progressOf({ cracked: doors(1, 23), visited: [] });
    expect(p.graduate).toBe(false);
    expect(p.rank).toBe("Senior Detective");
  });
});

describe("promotions between two counts", () => {
  it("lists each rank newly reached, in order", () => {
    expect(promotionsBetween(5, 6)).toEqual(["Junior Detective"]);
    expect(promotionsBetween(5, 13)).toEqual(["Junior Detective", "Detective"]);
    expect(promotionsBetween(0, 24)).toEqual(["Junior Detective", "Detective", "Senior Detective", "Graduate"]);
  });

  it("lists nothing when no threshold is crossed", () => {
    expect(promotionsBetween(6, 6)).toEqual([]);
    expect(promotionsBetween(6, 11)).toEqual([]);
    expect(promotionsBetween(12, 7)).toEqual([]);
  });

  it("never lists Trainee, which every detective starts as, whatever the counts", () => {
    expect(promotionsBetween(-1, 0)).toEqual([]);
    expect(promotionsBetween(-10, 6)).toEqual(["Junior Detective"]);
  });

  it("lists nothing when a count is not a number, rather than guess at what is new", () => {
    expect(promotionsBetween(Number.NaN, 6)).toEqual([]);
    expect(promotionsBetween(5, Number.NaN)).toEqual([]);
  });
});
