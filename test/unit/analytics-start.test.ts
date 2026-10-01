import { describe, it, expect, afterEach } from "vitest";
import { startPlaceLookups } from "../../src/analytics/start";
import { resolvePlace, setPlaceResolver } from "../../src/analytics/place";

// TASK-482 joins TASK-479 and TASK-481: at start-up the counting looks places up in the DB-IP file
// when it is in the image, and records no place when it is not.

afterEach(() => setPlaceResolver(null));

describe("connecting the location database at start-up", () => {
  it("looks places up in the database when the file is there", () => {
    const ok = startPlaceLookups(() => () => ({ country: "GB", region: "Scotland", city: "Ayr" }));
    expect(ok).toBe(true);
    expect(resolvePlace("203.0.113.9")).toEqual({ country: "GB", region: "Scotland", city: "Ayr" });
  });

  it("records no place, and still starts, when the file is missing", () => {
    expect(startPlaceLookups(() => null)).toBe(false);
    expect(resolvePlace("203.0.113.9")).toEqual({ country: null, region: null, city: null });
  });
});
