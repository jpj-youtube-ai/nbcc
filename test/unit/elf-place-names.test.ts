import { describe, it, expect } from "vitest";
import { normalisePlaceName, sameName } from "../../src/elf/place-names";

describe("place names", () => {
  it("matches names however they are typed", () => {
    expect(sameName("The Corner Bakehouse", "corner-bakehouse")).toBe(true);
    expect(sameName("Corner Bakehouse", "Corner Bakery")).toBe(false);
  });
  it("drops accents", () => expect(normalisePlaceName("Café Rouge")).toBe("caferouge"));
  it("drops only a leading whole word the", () => expect(normalisePlaceName("Theatre Royal")).toBe("theatreroyal"));
  it("drops spacing, capitals and marks", () => expect(normalisePlaceName("  THE  Bakehouse!! ")).toBe("bakehouse"));
});
