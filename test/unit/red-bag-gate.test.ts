import { describe, it, expect } from "vitest";
import { RED_BAG_LIVE, RED_BAG_PATH, redBagAccess, redBagIsLive } from "../../src/red-bag/switch";

// Fill a Red Bag ships switched off. One constant in code decides; while it is off the public gets
// the site's 404 and a signed in member of staff gets a preview.

describe("the switch", () => {
  it("is off until Jaimie says", () => {
    expect(RED_BAG_LIVE).toBe(false);
    expect(redBagIsLive()).toBe(false);
  });

  it("names the page's one address", () => {
    expect(RED_BAG_PATH).toBe("/fill-a-red-bag");
  });
});

describe("who sees the page", () => {
  it("off: the public gets the 404", () => {
    expect(redBagAccess(false, false)).toBe("closed");
  });

  it("off: staff get the preview", () => {
    expect(redBagAccess(false, true)).toBe("preview");
  });

  it("on: everyone gets the page, with no preview strip, staff included", () => {
    expect(redBagAccess(true, false)).toBe("open");
    expect(redBagAccess(true, true)).toBe("open");
  });
});
