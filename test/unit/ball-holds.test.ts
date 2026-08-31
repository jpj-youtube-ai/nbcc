import { describe, it, expect } from "vitest";
import { holdCreateSchema, seatsForHold, isHoldActive, heldSeatsFrom } from "../../src/ball/holds";

// TASK-324: holds you can account for. What this replaces is a single "held back" number that
// recorded nothing about WHO the seats were for or UNTIL WHEN — a number that only ever goes
// up, because nobody dares reduce what nobody can explain.

const NOW = new Date("2026-09-15T12:00:00Z");
const hold = (over: Partial<{ expiresAt: string | null; releasedAt: string | null; seats: number }> = {}) => ({
  expiresAt: null,
  releasedAt: null,
  seats: 10,
  ...over,
});

describe("holdCreateSchema", () => {
  it("takes a name, a kind and a quantity", () => {
    const r = holdCreateSchema.safeParse({ name: "Ayrshire Bakery", kind: "table", quantity: 2 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.note).toBeNull();
      expect(r.data.expiresAt).toBeNull();
    }
  });

  // A hold with no name is the old number again, one row further on.
  it("refuses a hold with nobody's name on it", () => {
    expect(holdCreateSchema.safeParse({ name: "", kind: "seat", quantity: 1 }).success).toBe(false);
    expect(holdCreateSchema.safeParse({ name: "  ", kind: "seat", quantity: 1 }).success).toBe(false);
    expect(holdCreateSchema.safeParse({ name: "x", kind: "seat", quantity: 1 }).success).toBe(false);
  });

  // A hold bigger than the room takes everything off sale and looks exactly like a sell-out.
  it("refuses a quantity larger than the whole ball", () => {
    expect(holdCreateSchema.safeParse({ name: "Typo", kind: "seat", quantity: 401 }).success).toBe(false);
    expect(holdCreateSchema.safeParse({ name: "Typo", kind: "seat", quantity: 0 }).success).toBe(false);
  });

  it("takes an optional deadline and an optional note", () => {
    const r = holdCreateSchema.safeParse({
      name: "Ayrshire Bakery",
      kind: "table",
      quantity: 1,
      note: "  invoice 1042  ",
      expiresAt: "2026-10-01T12:00:00Z",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.note).toBe("invoice 1042");
      expect(r.data.expiresAt).toBe("2026-10-01T12:00:00Z");
    }
  });

  it("refuses a deadline it cannot read, rather than holding forever by accident", () => {
    expect(
      holdCreateSchema.safeParse({ name: "Bakery", kind: "seat", quantity: 1, expiresAt: "next tuesday" }).success,
    ).toBe(false);
  });
});

describe("seatsForHold", () => {
  it("counts a table hold as a whole table of seats", () => {
    expect(seatsForHold("table", 2)).toBe(20);
  });
  it("counts a seat hold as itself", () => {
    expect(seatsForHold("seat", 3)).toBe(3);
  });
});

describe("isHoldActive", () => {
  it("holds indefinitely when no deadline was given", () => {
    expect(isHoldActive(hold(), NOW)).toBe(true);
  });

  it("stops counting once released", () => {
    expect(isHoldActive(hold({ releasedAt: "2026-09-14T00:00:00Z" }), NOW)).toBe(false);
  });

  // The point of the deadline: the seats come back on their own. Nothing has to run.
  it("stops counting the moment its deadline passes", () => {
    expect(isHoldActive(hold({ expiresAt: "2026-09-15T11:59:59Z" }), NOW)).toBe(false);
    expect(isHoldActive(hold({ expiresAt: "2026-09-15T12:00:01Z" }), NOW)).toBe(true);
  });

  // An unreadable date must not silently put someone's invoiced tables back on sale.
  it("treats an unreadable deadline as STILL HELD", () => {
    expect(isHoldActive(hold({ expiresAt: "nonsense" }), NOW)).toBe(true);
  });

  it("counts a released hold as gone even if its deadline has not passed", () => {
    expect(
      isHoldActive(hold({ expiresAt: "2026-12-01T00:00:00Z", releasedAt: "2026-09-01T00:00:00Z" }), NOW),
    ).toBe(false);
  });
});

describe("heldSeatsFrom", () => {
  it("adds up only the holds still standing", () => {
    const seats = heldSeatsFrom(
      [
        hold({ seats: 10 }),                                          // no deadline  -> counts
        hold({ seats: 20, expiresAt: "2026-12-01T00:00:00Z" }),       // future       -> counts
        hold({ seats: 30, expiresAt: "2026-09-01T00:00:00Z" }),       // expired      -> ignored
        hold({ seats: 40, releasedAt: "2026-09-02T00:00:00Z" }),      // released     -> ignored
      ],
      NOW,
    );
    expect(seats).toBe(30);
  });

  it("is zero when nothing is held", () => {
    expect(heldSeatsFrom([], NOW)).toBe(0);
  });
});
