import { describe, it, expect } from "vitest";
import { renderGuestPage, type GuestPageInput } from "../../src/ball/guest-page";
import { guestsFromForm } from "../../src/ball/guests";
import { cateringCsv } from "../../src/ball/exports";

// TASK-417: The Park Hotel confirmed the menu, and three things about it broke assumptions the
// menu code was written under (TASK-345, before anybody had seen a real menu):
//
//  1. The starter is FIXED. Everyone gets the soup. `choosableCourses` correctly excludes a
//     course with no options, but the guest form then renders nothing at all for it, so a guest
//     never learns what they are eating first. Written the other way, with one option, they are
//     asked to "choose" from a list of one.
//  2. Every dish carries the venue's dietary codes, and the menu sheet carries a KEY explaining
//     them. "(VV)" on its own is jargon; the form had nowhere to put the key.
//  3. Both alternative dishes are vegetarian, and NBCC needs to know who picked one because they
//     are vegetarian and who just fancied it. The first is a requirement the kitchen must get
//     exactly right; the second could flex if numbers move.
//
// The real menu, used throughout so the tests fail the way production would.
const MENU = [
  "To start: Rustic red lentil and winter vegetable soup (DF)",
  "Main course: Roast crown of British Turkey with sage and onion stuffing, pigs in blankets, roast potatoes & root vegetables and served with a delicious cranberry jus (DF) | Vegan feta, haggis & beetroot wellington with sauté potatoes, market vegetables and plant-based peppercorn sauce (V)(VV)(DF)",
  "To finish: Duo of chocolate mousse with Chantilly cream and raspberry coulis | Vegan chocolate & clementine torte with crumbled pistachios and winter berry compote (V)(VV)(DF)",
].join("\n");

const MENU_KEY =
  "V = Vegetarian, VV = Vegan, GF = Gluten Free, DF = Dairy Free, GFOA = Gluten Free Option Available, DFOA = Dairy Free Option Available";

const booking = {
  reference: "BALL-K7M2PQ",
  kind: "table" as const,
  quantity: 1,
  seats: 2,
  buyerName: "Jaimie Wakefield",
  buyerFirstName: "Jaimie",
  buyerSurname: "Wakefield",
  buyerEmail: "j@example.com",
  tableName: null,
};

const page = (over: Partial<GuestPageInput> = {}): string =>
  renderGuestPage({
    token: "tok",
    booking,
    guests: [],
    lockAt: null,
    menuOptions: MENU,
    menuNote: MENU_KEY,
    ...over,
  });

const collapse = (s: string) => s.replace(/\s+/g, " ");

describe("the menu a guest can actually read", () => {
  it("shows the fixed starter, which no dropdown would ever mention", () => {
    expect(collapse(page())).toMatch(/Rustic red lentil and winter vegetable soup \(DF\)/);
  });

  it("says the fixed course is not a choice", () => {
    expect(collapse(page())).toMatch(/served to everyone/i);
  });

  // A course with one option is not a question. Asking somebody to pick soup from a list
  // containing only soup is the failure this guards.
  it("never builds a picker for the fixed course", () => {
    expect(page()).not.toContain('data-course="To start"');
  });

  it("still builds a picker for each course that does ask something", () => {
    const html = page();
    expect(html).toContain('data-course="Main course"');
    expect(html).toContain('data-course="To finish"');
  });

  // Asked for directly: keep the venue's markings exactly as the venue wrote them.
  it("keeps the dietary codes verbatim on every dish", () => {
    const html = collapse(page());
    expect(html).toMatch(/cranberry jus \(DF\)/);
    expect(html).toMatch(/peppercorn sauce \(V\)\(VV\)\(DF\)/);
    expect(html).toMatch(/winter berry compote \(V\)\(VV\)\(DF\)/);
  });

  it("prints the key, so those codes mean something", () => {
    expect(collapse(page())).toContain("VV = Vegan");
  });

  // The menu is one menu. Printing it inside all ten guest fieldsets would repeat the soup ten
  // times and bury the thing each guest is actually being asked.
  it("prints the menu once, not once per guest", () => {
    const html = page({ booking: { ...booking, seats: 10 } });
    const soup = html.split("Rustic red lentil").length - 1;
    expect(soup).toBe(1);
  });

  it("shows no menu at all while the venue has not confirmed one", () => {
    const html = page({ menuOptions: null, menuNote: null });
    expect(html).not.toMatch(/The menu/);
    expect(html).not.toContain("data-course=");
  });
});

describe("vegetarian: a requirement, or a preference", () => {
  it("asks each guest, once per seat", () => {
    const html = page();
    expect(html).toContain('name="vegetarian1"');
    expect(html).toContain('name="vegetarian2"');
    expect(html).not.toContain('name="vegetarian3"');
  });

  it("makes the distinction the kitchen needs, in plain words", () => {
    expect(collapse(page())).toMatch(/vegetarian/i);
    expect(collapse(page())).toMatch(/preference/i);
  });

  it("remembers a guest who said they are vegetarian", () => {
    const html = page({
      guests: [
        {
          firstName: "Sam", surname: "Bryce", fullName: "Sam Bryce",
          dietary: null, accessNeeds: null, isVegetarian: true,
        },
      ],
    });
    expect(html).toMatch(/name="vegetarian1"[^>]*checked/);
  });

  it("leaves it unticked for a guest who did not say so", () => {
    const html = page({
      guests: [
        {
          firstName: "Sam", surname: "Bryce", fullName: "Sam Bryce",
          dietary: null, accessNeeds: null, isVegetarian: false,
        },
      ],
    });
    expect(html).not.toMatch(/name="vegetarian1"[^>]*checked/);
  });

  // Nothing to be vegetarian about until there is a menu to choose from.
  it("does not ask before the venue has confirmed a menu", () => {
    expect(page({ menuOptions: null, menuNote: null })).not.toContain('name="vegetarian1"');
  });
});

describe("reading the tick back off the posted form", () => {
  it("records a guest who ticked it", () => {
    const rows = guestsFromForm({ firstName1: "Sam", surname1: "Bryce", vegetarian1: "on" }, 1, []);
    expect(rows[0].isVegetarian).toBe(true);
  });

  // An unticked checkbox posts NOTHING at all. That absence is the answer, not missing data.
  it("records a guest who left it alone", () => {
    const rows = guestsFromForm({ firstName1: "Jo", surname1: "Smith" }, 1, []);
    expect(rows[0].isVegetarian).toBe(false);
  });

  it("keeps the tick with the right guest when an earlier seat is blank", () => {
    const rows = guestsFromForm({ firstName2: "Ali", surname2: "Nunn", vegetarian2: "on" }, 2, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fullName: "Ali Nunn", isVegetarian: true });
  });
});

describe("what reaches the kitchen", () => {
  const guest = (fullName: string, isVegetarian: boolean) => ({
    fullName, surname: null, dietary: null, accessNeeds: null,
    menuChoice: "Main course: Vegan feta, haggis & beetroot wellington",
    tableName: "Top table", reference: "BALL-1", isVegetarian,
  });

  it("tells the caterer which vegetarian plates are a requirement", () => {
    const csv = cateringCsv([guest("Sam Bryce", true)]);
    expect(csv).toContain("Vegetarian");
    expect(csv).toMatch(/Sam Bryce/);
  });

  // The whole point of the tick. A plate that is merely preferred can be swapped if the numbers
  // move; one that is a requirement cannot.
  it("distinguishes a requirement from a preference", () => {
    const required = cateringCsv([guest("Sam Bryce", true)]);
    const preferred = cateringCsv([guest("Jo Smith", false)]);
    expect(required).not.toBe(preferred);
  });
});
