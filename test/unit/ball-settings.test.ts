import { describe, it, expect } from "vitest";
import { ballSettingsUpdateSchema } from "../../src/ball/settings";

const parse = (v: unknown) => ballSettingsUpdateSchema.safeParse(v);

describe("ballSettingsUpdateSchema", () => {
  it("accepts a single field on its own", () => {
    expect(parse({ gateOpen: true }).success).toBe(true);
    expect(parse({ heldSeats: 12 }).success).toBe(true);
  });

  it("refuses an empty update rather than silently doing nothing", () => {
    expect(parse({}).success).toBe(false);
  });

  it("takes the whole set at once", () => {
    const result = parse({
      totalTables: 40,
      seatsPerTable: 10,
      heldSeats: 20,
      gateOpen: false,
      gateOpensAt: "2026-09-04T08:00:00.000Z",
      salesCloseAt: "2026-10-24T23:59:00.000Z",
      salesClosed: false,
      arrivalTime: "7pm for 7.30pm",
      includedNote: "Arrival drink and a three-course dinner.",
      lineUpNote: "Special guest announced soon.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative or absurd capacity", () => {
    expect(parse({ totalTables: -1 }).success).toBe(false);
    expect(parse({ totalTables: 5000 }).success).toBe(false);
    expect(parse({ seatsPerTable: 0 }).success).toBe(false);
  });

  it("rejects held seats that are not a whole number", () => {
    expect(parse({ heldSeats: 4.5 }).success).toBe(false);
    expect(parse({ heldSeats: -2 }).success).toBe(false);
  });

  it("rejects a date it cannot understand", () => {
    expect(parse({ gateOpensAt: "next Tuesday" }).success).toBe(false);
    expect(parse({ salesCloseAt: "2026-13-45" }).success).toBe(false);
  });

  it("allows a date to be cleared with null", () => {
    expect(parse({ gateOpensAt: null }).success).toBe(true);
    expect(parse({ salesCloseAt: null }).success).toBe(true);
  });

  it("trims free text and treats blank as cleared", () => {
    const r = parse({ arrivalTime: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.arrivalTime).toBeNull();
  });

  it("caps free text so a paste accident cannot fill the page", () => {
    expect(parse({ includedNote: "x".repeat(1001) }).success).toBe(false);
    expect(parse({ includedNote: "x".repeat(400) }).success).toBe(true);
  });

  it("has no way to change the ticket price", () => {
    // £100 is printed in a magazine that cannot be recalled. There is deliberately no price
    // field here, and an attempt to smuggle one in is dropped rather than applied.
    const r = parse({ gateOpen: true, seatPricePence: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect("seatPricePence" in r.data).toBe(false);
  });
});
