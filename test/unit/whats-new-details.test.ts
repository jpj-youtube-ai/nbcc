import { describe, it, expect } from "vitest";
import { AREAS, AREA_TITLES, arrivalLine, type Area } from "../../src/admin/whats-new";

// What a notification actually says (TASK-619).
//
// The New pills only ever need to know THAT something arrived. A notification has to say what,
// in a line somebody reads on a lock screen without unlocking the phone — and, deliberately,
// without naming anybody. Jaimie's phone sits on a table at events and its lock screen is
// readable from across the room, so the donor's name waits until she taps through.

describe("a line about money", () => {
  it("says the amount and where it was given", () => {
    expect(arrivalLine("donations", { amountPence: 2500, channel: "in_person" })).toBe("£25 donation — card reader");
    expect(arrivalLine("donations", { amountPence: 1050, channel: "online" })).toBe("£10.50 donation — website");
  });

  // "£25.00 donation" is right for a receipt and fussy for a one-line alert.
  it("drops the pennies when there are none, and keeps them when there are", () => {
    expect(arrivalLine("donations", { amountPence: 500, channel: "online" })).toContain("£5 ");
    expect(arrivalLine("donations", { amountPence: 505, channel: "online" })).toContain("£5.05 ");
    expect(arrivalLine("donations", { amountPence: 150000, channel: "online" })).toContain("£1,500 ");
  });

  it("describes a monthly giver as monthly, not as a one-off", () => {
    expect(arrivalLine("monthly", { amountPence: 1000 })).toBe("New monthly giver — £10 a month");
  });

  // An unknown channel must not produce "£25 donation — undefined".
  it("still reads properly when the channel is missing", () => {
    expect(arrivalLine("donations", { amountPence: 2500 })).toBe("£25 donation");
  });
});

describe("a line about a person doing something", () => {
  it.each([
    ["fundraising", "New Get involved sign-up"],
    ["contact", "New message on the contact form"],
    ["stories", "Someone sent in their story"],
    ["fulfilments", "A business signed up as a supporter"],
    ["ball", "A Festive Ball booking"],
    ["newsletter", "Someone joined the newsletter"],
    ["elf", "A photo is waiting to be checked"],
  ] as const)("%s reads: %s", (area, expected) => {
    expect(arrivalLine(area, {})).toBe(expected);
  });
});

describe("the rule that no name reaches a lock screen", () => {
  // The queries are free to select a name for other purposes; arrivalLine must never pass one on.
  it.each(AREAS.map((a) => a.area))("%s says nothing about who", (area) => {
    const line = arrivalLine(area as Area, {
      amountPence: 2500,
      channel: "online",
      name: "Sarah McBride",
      email: "sarah@example.com",
      businessName: "McBride Joinery",
    });
    // ?? "" because an area nothing arrives in returns null, which leaks nothing by definition.
    expect(line ?? "").not.toMatch(/Sarah|McBride|sarah@/);
  });
});

describe("areas that are a screen rather than an arrival", () => {
  // events, analytics, qr, red-bag and invoices carry a pill when the SCREEN is new, but nothing
  // ever arrives in them, so there is nothing a notification could say.
  it.each(["events", "analytics", "qr", "red-bag", "invoices"] as const)("%s has no line", (area) => {
    expect(arrivalLine(area, {})).toBeNull();
  });
});

describe("an Elf Detective School photo", () => {
  it("is titled by the game's full name", () => {
    expect(AREA_TITLES.elf).toBe("Elf Detective School");
  });

  it("says a photo is waiting, whatever the query selected, and never a name or a place", () => {
    const line = arrivalLine("elf", { grownUpName: "Alex Example", detective: "Sam", placeName: "Example Library", door: 4 });
    expect(line).toBe("A photo is waiting to be checked");
    expect(arrivalLine("elf", {})).toBe("A photo is waiting to be checked");
  });
});
