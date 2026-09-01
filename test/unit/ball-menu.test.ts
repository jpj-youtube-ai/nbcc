import { describe, it, expect } from "vitest";
import {
  parseMenu,
  choosableCourses,
  formatChoice,
  parseChoice,
  hasChosen,
  menuProgress,
} from "../../src/ball/menu";

// TASK-345: the menu, built before the venue has confirmed one.

const MENU = `Starter: Cullen skink | Haggis bon bons | Melon
Main: Steak pie | Salmon | Mushroom wellington
Dessert: Cranachan | Cheesecake`;

describe("reading the menu staff paste in", () => {
  it("reads a course and its options", () => {
    const menu = parseMenu(MENU);
    expect(menu.map((c) => c.name)).toEqual(["Starter", "Main", "Dessert"]);
    expect(menu[1].options).toEqual(["Steak pie", "Salmon", "Mushroom wellington"]);
  });

  it("tolerates the spacing a person actually types", () => {
    expect(parseMenu("Main:Beef|Salmon")).toEqual([
      { name: "Main", options: ["Beef", "Salmon"] },
    ]);
    expect(parseMenu("  Main :  Beef  |  Salmon  ")).toEqual([
      { name: "Main", options: ["Beef", "Salmon"] },
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseMenu("Main: Beef\n\n\nDessert: Tart")).toHaveLength(2);
  });

  // A line with no colon is a course everybody gets. Dropping it would show guests a menu that
  // is not the menu the venue sent.
  it("keeps a fixed course that offers no choice", () => {
    const menu = parseMenu("Canapes on arrival\nMain: Beef | Salmon");
    expect(menu[0]).toEqual({ name: "Canapes on arrival", options: [] });
  });

  it("has nothing to show before the venue confirms anything", () => {
    expect(parseMenu(null)).toEqual([]);
    expect(parseMenu("")).toEqual([]);
  });
});

describe("which courses actually ask a question", () => {
  it("leaves out the fixed ones", () => {
    const menu = parseMenu("Canapes on arrival\nMain: Beef | Salmon");
    expect(choosableCourses(menu).map((c) => c.name)).toEqual(["Main"]);
  });
});

describe("storing what a guest picked", () => {
  it("writes course and choice, one per line", () => {
    expect(formatChoice([["Main", "Salmon"], ["Dessert", "Cranachan"]])).toBe(
      "Main: Salmon\nDessert: Cranachan",
    );
  });

  it("drops a course they left blank rather than recording an empty answer", () => {
    expect(formatChoice([["Main", "Salmon"], ["Dessert", "  "]])).toBe("Main: Salmon");
  });

  it("reads back what it wrote", () => {
    const written = formatChoice([["Main", "Salmon"], ["Dessert", "Cranachan"]]);
    expect(parseChoice(written)).toEqual({ Main: "Salmon", Dessert: "Cranachan" });
  });
});

describe("has this guest answered", () => {
  const menu = parseMenu(MENU);

  it("needs every course that asks", () => {
    expect(hasChosen("Starter: Melon\nMain: Salmon", menu)).toBe(false);
    expect(hasChosen("Starter: Melon\nMain: Salmon\nDessert: Cranachan", menu)).toBe(true);
  });

  it("counts nobody as outstanding while there is no menu", () => {
    expect(hasChosen(null, [])).toBe(true);
  });

  it("does not count a guest who has answered nothing", () => {
    expect(hasChosen(null, menu)).toBe(false);
  });

  // The venue swapping Salmon for sea bass after some people have answered is ordinary. Treating
  // the stale answer as valid hands the kitchen a number for a dish nobody is cooking.
  it("does not accept a choice the menu no longer offers", () => {
    const changed = parseMenu("Starter: Melon\nMain: Steak pie | Sea bass\nDessert: Cranachan");
    const answered = "Starter: Melon\nMain: Salmon\nDessert: Cranachan";
    expect(hasChosen(answered, changed)).toBe(false);
  });

  it("still accepts the answers that survived the change", () => {
    const changed = parseMenu("Starter: Melon\nMain: Steak pie | Sea bass\nDessert: Cranachan");
    const answered = "Starter: Melon\nMain: Steak pie\nDessert: Cranachan";
    expect(hasChosen(answered, changed)).toBe(true);
  });

  it("ignores a fixed course when deciding if they are done", () => {
    const menu = parseMenu("Canapes on arrival\nMain: Beef | Salmon");
    expect(hasChosen("Main: Beef", menu)).toBe(true);
  });
});

describe("how close the kitchen order is", () => {
  const menu = parseMenu(MENU);
  const guests = [
    { fullName: "Ailsa", menuChoice: "Starter: Melon\nMain: Salmon\nDessert: Cranachan" },
    { fullName: "Rab", menuChoice: "Main: Salmon" },
    { fullName: "Effie", menuChoice: null },
  ];

  it("counts who has answered and who has not", () => {
    const p = menuProgress(guests, menu);
    expect(p.guests).toBe(3);
    expect(p.chosen).toBe(1);
    expect(p.outstanding).toBe(2);
  });

  // Before the venue confirms a menu the honest answer is "not asking yet", not "0% done"
  // against a menu that does not exist.
  it("reports nothing outstanding while no menu has been set", () => {
    const p = menuProgress(guests, []);
    expect(p.asking).toBe(false);
    expect(p.outstanding).toBe(0);
  });

  it("says it IS asking once a menu is set", () => {
    expect(menuProgress(guests, menu).asking).toBe(true);
  });
});
