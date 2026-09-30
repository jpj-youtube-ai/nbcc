import { describe, it, expect, afterEach } from "vitest";
import { resolvePlace, setPlaceResolver, type Place } from "../../src/analytics/place";

// TASK-479: places are looked up through a resolver another piece of work (TASK-481) connects at
// start-up. Until then nobody's place is recorded.

const NOWHERE: Place = { country: null, region: null, city: null };

afterEach(() => setPlaceResolver(null));

describe("resolvePlace", () => {
  it("records no place until a resolver is connected", () => {
    expect(resolvePlace("203.0.113.7")).toEqual(NOWHERE);
  });

  it("uses the connected resolver", () => {
    setPlaceResolver((ip) => (ip === "203.0.113.7" ? { country: "GB", region: "Scotland", city: "Glenmorrow" } : null));
    expect(resolvePlace("203.0.113.7")).toEqual({ country: "GB", region: "Scotland", city: "Glenmorrow" });
    expect(resolvePlace("198.51.100.1")).toEqual(NOWHERE);
  });

  it("records no place if the resolver fails, rather than losing the view", () => {
    setPlaceResolver(() => {
      throw new Error("broken file");
    });
    expect(resolvePlace("203.0.113.7")).toEqual(NOWHERE);
  });
});
