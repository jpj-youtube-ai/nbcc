import { describe, it, expect } from "vitest";
import { parseMenu } from "../../src/ball/menu";
import { bookingMenuProgress, summariseMenuProgress } from "../../src/ball/menu-progress";
import { buildMenuReadyEmail } from "../../src/ball/menu-email";

// TASK-418: the two halves of "the menu has landed, now go and get the answers".
//
// menuProgress() has existed since TASK-345 and was wired to NOTHING: no admin view, no chase.
// So the day a menu finally arrived there was no way to see who had answered, and nobody who
// had already booked was ever told the menu existed at all.

const MENU = parseMenu(
  [
    "To start: Rustic red lentil and winter vegetable soup (DF)",
    "Main course: Roast crown of British Turkey (DF) | Vegan feta, haggis & beetroot wellington (V)(VV)(DF)",
    "To finish: Duo of chocolate mousse | Vegan chocolate & clementine torte (V)(VV)(DF)",
  ].join("\n"),
);

const KEY = "V = Vegetarian, VV = Vegan, DF = Dairy Free";

const BOTH =
  "Main course: Roast crown of British Turkey (DF)\nTo finish: Duo of chocolate mousse";
const ONLY_MAIN = "Main course: Roast crown of British Turkey (DF)";

const booking = (over: Record<string, unknown> = {}) => ({
  reference: "BALL-K7M2PQ",
  buyerName: "Jaimie Wakefield",
  buyerEmail: "j@example.com",
  seats: 10,
  guestToken: "tok",
  choices: [] as Array<string | null>,
  ...over,
});

describe("how far off a complete kitchen order one booking is", () => {
  it("counts a guest who answered every course that asks", () => {
    const b = bookingMenuProgress(booking({ choices: [BOTH, BOTH] }), MENU);
    expect(b.chosen).toBe(2);
    expect(b.missing).toBe(0);
    expect(b.complete).toBe(true);
  });

  // Half an order is not an order. The kitchen cannot cook "a main, dessert to follow".
  it("does not count a guest who answered only some of them", () => {
    const b = bookingMenuProgress(booking({ choices: [BOTH, ONLY_MAIN] }), MENU);
    expect(b.chosen).toBe(1);
    expect(b.missing).toBe(1);
    expect(b.complete).toBe(false);
  });

  it("counts a guest who has answered nothing as outstanding", () => {
    const b = bookingMenuProgress(booking({ choices: [null, null] }), MENU);
    expect(b.chosen).toBe(0);
    expect(b.missing).toBe(2);
  });

  // Measured against the guests NAMED, not the seats paid for. You cannot choose a dinner for
  // somebody whose name nobody has given you yet, and counting those as outstanding menu
  // answers would blame this list for a gap the guest-name chase already owns.
  it("measures against the guests named, not the seats bought", () => {
    const b = bookingMenuProgress(booking({ seats: 10, choices: [BOTH] }), MENU);
    expect(b.guestsNamed).toBe(1);
    expect(b.missing).toBe(0);
    expect(b.complete).toBe(true);
  });

  // A stale answer is not an answer: the venue swapping a dish after somebody chose it would
  // otherwise hand the kitchen a number for a plate nobody is cooking.
  it("ignores a choice the menu no longer offers", () => {
    const changed = parseMenu("Main course: Beef | Salmon\nTo finish: Tart | Cheese");
    const b = bookingMenuProgress(booking({ choices: [BOTH] }), changed);
    expect(b.chosen).toBe(0);
  });

  // Nothing is outstanding before there is anything to choose from.
  it("asks nothing at all while the venue has not confirmed a menu", () => {
    const b = bookingMenuProgress(booking({ choices: [null, null] }), []);
    expect(b.missing).toBe(0);
    expect(b.complete).toBe(true);
  });
});

describe("the whole room at a glance", () => {
  const rows = [
    booking({ reference: "A", choices: [BOTH, BOTH] }),
    booking({ reference: "B", choices: [BOTH, ONLY_MAIN, null] }),
    booking({ reference: "C", choices: [] }),
  ];

  it("totals who has answered and who has not", () => {
    const s = summariseMenuProgress(rows, MENU);
    expect(s.guestsNamed).toBe(5);
    expect(s.chosen).toBe(3);
    expect(s.outstanding).toBe(2);
  });

  it("counts the bookings still to chase, which is what staff act on", () => {
    expect(summariseMenuProgress(rows, MENU).bookingsOutstanding).toBe(1);
  });

  // Same rule as the guest-name summary: 99.6% must not round to a finished-looking 100.
  it("never reads as finished while anyone is outstanding", () => {
    expect(summariseMenuProgress(rows, MENU).percentComplete).toBeLessThan(100);
  });

  it("reads as finished only when it is", () => {
    const done = [booking({ reference: "A", choices: [BOTH] })];
    expect(summariseMenuProgress(done, MENU).percentComplete).toBe(100);
  });

  it("says it is not asking anything while there is no menu", () => {
    expect(summariseMenuProgress(rows, []).asking).toBe(false);
  });
});

describe("the email that tells people the menu exists", () => {
  const mail = buildMenuReadyEmail({
    buyerFirstName: "Jaimie",
    reference: "BALL-K7M2PQ",
    guestLink: "https://nbcc.scot/ball/guests/tok",
    menu: MENU,
    menuNote: KEY,
  });

  it("says in the subject what has actually happened", () => {
    expect(mail.subject).toMatch(/menu/i);
  });

  it("carries the link to their own table", () => {
    expect(mail.html).toContain("https://nbcc.scot/ball/guests/tok");
    expect(mail.text).toContain("https://nbcc.scot/ball/guests/tok");
  });

  // The whole point is that they can read it without clicking anything. An email saying "the
  // menu is ready, click here" is a worse email than one containing the menu.
  it("prints the menu in the email itself", () => {
    expect(mail.html).toMatch(/Roast crown of British Turkey/);
    // Asserted around the ampersand: the dish name contains "&", which is correctly escaped to
    // "&amp;" in the markup, so the raw dish name is not a string that appears in the HTML.
    expect(mail.html).toMatch(/Vegan feta, haggis &amp; beetroot wellington/);
    expect(mail.text).toContain("Vegan feta, haggis & beetroot wellington");
  });

  it("includes the fixed course no dropdown would mention", () => {
    expect(mail.html).toMatch(/Rustic red lentil/);
  });

  it("carries the dietary key, so the codes mean something", () => {
    expect(mail.html).toContain("VV = Vegan");
  });

  it("wears the NBCC shell, like every other ball email", () => {
    expect(mail.html).toContain("https://nbcc.scot/assets/img/nbcc-logo.png");
    expect(mail.html).toContain("https://nbcc.scot/assets/img/the-designer-rooms-cream.png");
    expect(mail.html).toContain('href="mailto:events@nbcc.scot"');
  });

  it("always has a plain-text alternative", () => {
    expect(mail.text.length).toBeGreaterThan(200);
    expect(mail.text).not.toContain("<");
  });

  // Asked for while this was being written: the hotel is holding a rate for ball guests. This
  // is the one email going to everybody who has booked, so it is where the offer belongs.
  it("mentions the hotel's room rate for guests staying over", () => {
    const flat = mail.html.replace(/\s+/g, " ");
    expect(flat).toMatch(/£110 per room per night|£110<\/b> per room per night/);
    expect(flat).toMatch(/contact the hotel directly/i);
  });

  it("carries the room rate in the plain-text part too", () => {
    expect(mail.text).toContain("£110");
    expect(mail.text).toMatch(/contact the hotel directly/i);
  });

  it("escapes a name so it cannot break the markup", () => {
    const evil = buildMenuReadyEmail({
      buyerFirstName: 'Jo <img src=x onerror="alert(1)">',
      reference: "BALL-1",
      guestLink: "https://nbcc.scot/ball/guests/t",
      menu: MENU,
      menuNote: null,
    });
    expect(evil.html).not.toContain("<img src=x");
    expect(evil.html).not.toContain('onerror="');
  });
});
