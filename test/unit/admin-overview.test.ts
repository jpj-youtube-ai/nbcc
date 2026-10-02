import { describe, it, expect } from "vitest";
import { needsLines, NEEDS, type NeedCounts } from "../../src/admin/overview";

// TASK-508: "Needs you" on the admin Overview. These are the pure rules: what each waiting item is
// called, how urgent it is, the order, and which screen deals with it. Invented numbers only.

describe("the words for each waiting item", () => {
  it("says one and many properly", () => {
    expect(needsLines({ contactWaiting: { count: 1 } })[0].text).toBe("1 contact message is waiting for a reply");
    expect(needsLines({ contactWaiting: { count: 3 } })[0].text).toBe("3 contact messages are waiting for a reply");
    expect(needsLines({ transfersOverdue: { count: 1 } })[0].text).toBe("1 bank transfer is overdue");
    expect(needsLines({ transfersOverdue: { count: 2 } })[0].text).toBe("2 bank transfers are overdue");
  });

  it("gives the money where there is some to collect", () => {
    expect(needsLines({ giftAidReady: { count: 12, pence: 48_050 } })[0].text).toBe(
      "12 donations are ready to claim Gift Aid on (£480.50 of giving)",
    );
  });

  it("has words for every item it knows", () => {
    for (const need of NEEDS) {
      const [one] = needsLines({ [need.key]: { count: 1 } } as NeedCounts);
      const [many] = needsLines({ [need.key]: { count: 2 } } as NeedCounts);
      expect(one.text, need.key).toMatch(/^1 /);
      expect(many.text, need.key).toMatch(/^2 /);
      expect(one.text, need.key).not.toBe(many.text);
      // House style: no hyphens joining words, no dashes.
      expect(many.text, need.key).not.toMatch(/[A-Za-z]-[A-Za-z]/);
      expect(many.text, need.key).not.toMatch(/[–—]/);
    }
  });
});

describe("which items show, and in what order", () => {
  it("leaves out anything at zero", () => {
    expect(needsLines({ contactWaiting: { count: 0 }, storiesNew: { count: 0 } })).toEqual([]);
    expect(needsLines({})).toEqual([]);
  });

  it("puts money and overdue things first, then replies, then slower deadlines", () => {
    const lines = needsLines({
      declarationsAwaiting: { count: 4 },
      contactWaiting: { count: 2 },
      monthlyFailing: { count: 1 },
      storiesNew: { count: 1 },
      transfersOverdue: { count: 1 },
    });
    expect(lines.map((l) => l.level)).toEqual([1, 1, 2, 2, 3]);
    // Within a level, the catalogue's order: overdue transfers before failing monthly gifts.
    expect(lines.map((l) => l.key)).toEqual(["transfersOverdue", "monthlyFailing", "contactWaiting", "storiesNew", "declarationsAwaiting"]);
  });

  it("names the screen that deals with each", () => {
    expect(needsLines({ contactWaiting: { count: 2 } })[0]).toMatchObject({ view: "contact", button: "Contact form" });
    expect(needsLines({ businessCalls: { count: 2 } })[0]).toMatchObject({ view: "fulfilments", button: "Business supporters" });
    expect(needsLines({ gasdsDeadline: { count: 2 } })[0]).toMatchObject({ view: "gasds", button: "GASDS" });
  });

  it("knows each item once, and sends each to a real screen", () => {
    const keys = NEEDS.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    const views = ["ball", "monthly", "claims", "email-audit", "fundraising", "contact", "stories", "fulfilments", "outreach", "thank-you", "gasds"];
    for (const n of NEEDS) expect(views, n.key).toContain(n.view);
  });
});
