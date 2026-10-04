import { describe, it, expect } from "vitest";
import { RED_BAG_LIVE, RED_BAG_PATH, RED_BAG_THANKS_PATH, redBagAccess, redBagIsLive } from "../../src/red-bag/switch";
import { redBagOpenTo } from "../../src/red-bag/staff";

// Fill a Red Bag is PUBLIC (Jaimie, 4 October 2026: "make it public but don't link anywhere to it
// right now"). One constant in code decides. Switched off again, the public gets the site's 404 and
// a signed in member of staff gets a preview: that path is kept, and tested here and in
// red-bag-page.test.ts, so turning it off is one line.

describe("the switch", () => {
  it("is on: the page is public", () => {
    expect(RED_BAG_LIVE).toBe(true);
    expect(redBagIsLive()).toBe(true);
  });

  it("names the page's one address, /fill, and its thank you under it", () => {
    expect(RED_BAG_PATH).toBe("/fill");
    expect(RED_BAG_THANKS_PATH).toBe("/fill/thank-you");
  });

  it("lets anyone use it, with no session, and asks nobody who they are", async () => {
    expect(await redBagOpenTo(undefined)).toBe(true);
    expect(await redBagOpenTo("Bearer nonsense")).toBe(true);
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
