import { describe, it, expect } from "vitest";
import { renderGuestPage, type GuestPageInput } from "../../src/ball/guest-page";
import { guestsFromForm, composeName } from "../../src/ball/guests";
import { surnameOf, doorListCsv } from "../../src/ball/exports";

// Four things reported about the "tell us about your table" form, all of them about the person
// filling it in rather than the data coming out:
//
//  1. It asked for a name in ONE box, the last single-name field on the site. Every other form
//     has taken a first name and surname separately since TASK-226, and TASK-318 did the same
//     for the buyer, for a reason spelled out in that migration: there is no reliable way back
//     out of one box.
//  2. The dietary and access hints were PLACEHOLDERS. Placeholder text is low contrast by
//     design, vanishes the moment somebody types, and is read inconsistently by screen readers.
//     For a field asking about a disability that is the wrong control entirely.
//  3. The booker had to type their own name into a form reached from their own booking.
//  4. "Table name" did nothing to help people who booked SEPARATELY sit together, which is the
//     case it needs to solve. Four people each listing three friends gives a contradictory
//     partial list somebody has to reverse-engineer; one agreed group name sorts a spreadsheet.

const booking = {
  reference: "BALL-K7M2PQ",
  kind: "table" as const,
  quantity: 1,
  seats: 4,
  buyerName: "Jaimie Wakefield",
  buyerFirstName: "Jaimie",
  buyerSurname: "Wakefield",
  buyerEmail: "j@example.com",
  tableName: null,
};

const page = (over: Partial<GuestPageInput> = {}): string =>
  renderGuestPage({ token: "tok", booking, guests: [], lockAt: null, ...over });

describe("a guest's name is asked for the way every other form asks", () => {
  it("has a first name and a surname box per guest", () => {
    const html = page();
    expect(html).toContain('name="firstName1"');
    expect(html).toContain('name="surname1"');
  });

  it("no longer asks for a whole name in one box", () => {
    expect(page()).not.toContain('name="fullName1"');
  });

  it("asks once per seat, not once per booking", () => {
    const html = page();
    expect(html).toContain('name="surname4"');
    expect(html).not.toContain('name="surname5"');
  });
});

describe("the hints are labels, not placeholders", () => {
  const html = page();

  // The whole point. A placeholder is not a label, and this form asks about allergies and
  // access needs.
  it("puts no placeholder on any guest field", () => {
    expect(html).not.toContain("placeholder=");
  });

  it("still shows the examples, as readable text", () => {
    expect(html).toMatch(/coeliac/i);
    expect(html).toMatch(/step-free/i);
  });

  // Visible text is not enough on its own: the hint has to be announced with the field it
  // belongs to, or a screen-reader user hears the label and never the examples.
  it("ties each hint to its field for a screen reader", () => {
    expect(html).toContain('aria-describedby="dietaryHint1"');
    expect(html).toContain('id="dietaryHint1"');
    expect(html).toContain('aria-describedby="accessHint1"');
    expect(html).toContain('id="accessHint1"');
  });
});

describe("the booker does not type their own name in", () => {
  it("fills the first guest in from the booking", () => {
    const html = page();
    expect(html).toContain('name="firstName1" value="Jaimie"');
    expect(html).toContain('name="surname1" value="Wakefield"');
  });

  // A PA books for somebody else. The prefill has to be undoable, and obviously so.
  it("offers a way to clear it", () => {
    expect(page()).toMatch(/clear/i);
  });

  // Once anything is saved, what is stored wins. Overwriting a booker's own correction with a
  // guess from the booking would be worse than never guessing.
  it("never overwrites guests that are already saved", () => {
    const html = page({
      guests: [{ firstName: "Sam", surname: "Bryce", fullName: "Sam Bryce", dietary: null, accessNeeds: null }],
    });
    expect(html).toContain('value="Sam"');
    expect(html).not.toContain('value="Jaimie"');
  });

  // A PA clears the booker out and saves an empty table. Without this they would watch the name
  // they just deleted reappear, which reads as the page refusing to do as it is told.
  it("stays cleared after a save that emptied the table", () => {
    const html = page({ guests: [], saved: true });
    expect(html).not.toContain('value="Jaimie"');
  });

  // Rows written before the split have a full name and nothing else. The form still has to show
  // them something it can edit.
  it("shows a legacy single-name row without losing it", () => {
    const html = page({
      guests: [{ firstName: null, surname: null, fullName: "Ali Nunn", dietary: null, accessNeeds: null }],
    });
    expect(html).toContain("Ali");
    expect(html).toContain("Nunn");
  });
});

describe("sitting together is solved with one agreed name", () => {
  const html = page();

  it("asks for a group name", () => {
    expect(html).toMatch(/group name/i);
  });

  // The instruction IS the mechanism. Without "everyone types the same thing" the field collects
  // four different spellings and sorts into four groups.
  it("tells everyone in the party to use the same one", () => {
    expect(html.replace(/\s+/g, " ")).toMatch(/exactly the same/i);
  });

  // Both kinds of booking get the instruction. A table booker whose friends bought separate
  // tickets needs the coordination just as much as a seat booker does, and is the party most
  // likely to want it.
  it("says it to seat bookers and table bookers alike", () => {
    const seats = page({ booking: { ...booking, kind: "seat", quantity: 2, seats: 2 } });
    expect(seats.replace(/\s+/g, " ")).toMatch(/exactly the same/i);
  });

  it("keeps posting to the field the table plan already reads", () => {
    expect(html).toContain('name="tableName"');
  });
});

describe("when the guest list closes", () => {
  // Asked for directly: do not tell people they can change this forever. The date is agreed with
  // the venue and is not settled, so the honest answer is that we will confirm it.
  it("says the closing date is still to be confirmed when it is", () => {
    const html = page({ lockAt: null }).replace(/\s+/g, " ");
    expect(html).toMatch(/to be confirmed|we'll confirm/i);
  });

  it("names the date once there is one", () => {
    const html = page({ lockAt: new Date("2026-10-24T00:00:00Z") });
    expect(html).toMatch(/24 October/);
  });

  it("never promises edits right up to the night", () => {
    const html = page().replace(/\s+/g, " ");
    expect(html).not.toMatch(/any time before the night/i);
  });
});

describe("folding the posted form back into guests", () => {
  it("joins the two boxes into the stored full name", () => {
    const rows = guestsFromForm({ firstName1: "Jo", surname1: "Smith" }, 1, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ firstName: "Jo", surname: "Smith", fullName: "Jo Smith" });
  });

  // Somebody who only knows a first name should not be blocked from telling us about the
  // allergy attached to it.
  it("accepts a row with only one half of a name", () => {
    const rows = guestsFromForm({ firstName1: "Sam", dietary1: "Coeliac" }, 1, []);
    expect(rows[0]).toMatchObject({ fullName: "Sam", dietary: "Coeliac" });
  });

  it("drops a row with no name at all, rather than erroring", () => {
    const rows = guestsFromForm({ firstName1: "", surname1: "", dietary1: "Coeliac" }, 1, []);
    expect(rows).toEqual([]);
  });

  it("keeps later guests when an earlier seat is left blank", () => {
    const rows = guestsFromForm({ firstName2: "Ali", surname2: "Nunn" }, 3, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe("Ali Nunn");
  });

  it("trims, so a stray space is not stored as a name", () => {
    expect(composeName("  Jo  ", "  Smith ")).toBe("Jo Smith");
    expect(composeName("", "   ")).toBe("");
  });
});

describe("the door list files people under the name they gave us", () => {
  // The payoff for storing the halves. Splitting on the last space is what the door list did
  // for everybody, and it is wrong for exactly the names it is most awkward to get wrong in
  // front of a queue.
  it("uses the surname the booker typed, not the last word", () => {
    expect(surnameOf("Ali van der Berg", "van der Berg")).toBe("van der berg");
    expect(surnameOf("Jo Smith", "Smith")).toBe("smith");
  });

  it("still guesses for a row saved before the split", () => {
    expect(surnameOf("Ali van der Berg", null)).toBe("berg");
    expect(surnameOf("Jo Smith")).toBe("smith");
  });

  // A blank box must not sort everyone who left it empty to the top under "".
  it("falls back when the surname box was left empty", () => {
    expect(surnameOf("Jo Smith", "   ")).toBe("smith");
  });

  it("sorts the printed list by that surname", () => {
    const guest = (fullName: string, surname: string | null) => ({
      fullName,
      surname,
      dietary: null,
      accessNeeds: null,
      menuChoice: null,
      tableName: null,
      reference: "BALL-1",
    });
    const csv = doorListCsv([
      guest("Ali van der Berg", "van der Berg"),
      guest("Jo Smith", "Smith"),
    ]);
    // Smith before van der Berg. On the old last-word guess, "Berg" sorted first.
    expect(csv.indexOf("Jo Smith")).toBeLessThan(csv.indexOf("Ali van der Berg"));
  });
});
