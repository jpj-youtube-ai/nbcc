import { describe, it, expect } from "vitest";
import {
  availability,
  canFulfil,
  seatsFor,
  SEATS_PER_TABLE,
  type CapacityState,
} from "../../src/ball/capacity";

const base: CapacityState = {
  totalTables: 40,
  seatsPerTable: 10,
  heldSeats: 0,
  tablesSold: 0,
  looseSeatsSold: 0,
  reservedSeats: 0,
};

describe("availability", () => {
  it("an untouched ball offers every seat and every table", () => {
    const a = availability(base);
    expect(a.totalSeats).toBe(400);
    expect(a.seatsRemaining).toBe(400);
    expect(a.tablesRemaining).toBe(40);
    expect(a.soldOut).toBe(false);
  });

  it("a whole table sold removes 10 seats and 1 table", () => {
    const a = availability({ ...base, tablesSold: 1 });
    expect(a.seatsRemaining).toBe(390);
    expect(a.tablesRemaining).toBe(39);
  });

  it("one loose seat breaks a table: 399 seats but only 39 whole tables", () => {
    const a = availability({ ...base, looseSeatsSold: 1 });
    expect(a.seatsRemaining).toBe(399);
    expect(a.tablesRemaining).toBe(39);
  });

  it("held seats consume capacity exactly like loose seats", () => {
    const a = availability({ ...base, heldSeats: 10 });
    expect(a.seatsRemaining).toBe(390);
    expect(a.tablesRemaining).toBe(39);
  });

  it("held and loose seats share the same pooled tables", () => {
    const a = availability({ ...base, heldSeats: 6, looseSeatsSold: 4 });
    expect(a.seatsRemaining).toBe(390);
    expect(a.tablesRemaining).toBe(39);
  });

  it("live reservations count against availability", () => {
    const a = availability({ ...base, reservedSeats: 10 });
    expect(a.seatsRemaining).toBe(390);
  });

  it("is sold out when the last seat goes", () => {
    const a = availability({ ...base, tablesSold: 39, looseSeatsSold: 10 });
    expect(a.seatsRemaining).toBe(0);
    expect(a.tablesRemaining).toBe(0);
    expect(a.soldOut).toBe(true);
  });

  it("never reports negative remaining if oversold data somehow appears", () => {
    const a = availability({ ...base, tablesSold: 41 });
    expect(a.seatsRemaining).toBe(0);
    expect(a.tablesRemaining).toBe(0);
  });
});

describe("canFulfil", () => {
  it("allows seats down to the very last one", () => {
    const state = { ...base, tablesSold: 39, looseSeatsSold: 9 };
    expect(canFulfil(state, { kind: "seat", quantity: 1 })).toBe(true);
    expect(canFulfil(state, { kind: "seat", quantity: 2 })).toBe(false);
  });

  it("refuses a table when no unbroken table is left, even with seats free", () => {
    const state = { ...base, tablesSold: 39, looseSeatsSold: 1 };
    expect(availability(state).seatsRemaining).toBe(9);
    expect(canFulfil(state, { kind: "table", quantity: 1 })).toBe(false);
    expect(canFulfil(state, { kind: "seat", quantity: 9 })).toBe(true);
  });

  it("enforces the per-order caps", () => {
    expect(canFulfil(base, { kind: "seat", quantity: 9 })).toBe(true);
    expect(canFulfil(base, { kind: "seat", quantity: 10 })).toBe(false);
    expect(canFulfil(base, { kind: "table", quantity: 4 })).toBe(true);
    expect(canFulfil(base, { kind: "table", quantity: 5 })).toBe(false);
  });

  it("rejects nonsense quantities", () => {
    expect(canFulfil(base, { kind: "seat", quantity: 0 })).toBe(false);
    expect(canFulfil(base, { kind: "seat", quantity: -1 })).toBe(false);
  });
});

describe("seatsFor", () => {
  it("a table is ten seats, a seat is one", () => {
    expect(seatsFor({ kind: "table", quantity: 2 })).toBe(20);
    expect(seatsFor({ kind: "seat", quantity: 3 })).toBe(3);
  });

  it("exports the seats-per-table default", () => {
    expect(SEATS_PER_TABLE).toBe(10);
  });
});
