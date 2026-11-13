// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHqPage } from "../../src/elf/pages/hq";
import type { HqView, TodayView } from "../../src/elf/pages/types";
import { at, hqView } from "./elf-fixtures";

// NBCC Elf Detective School: Detective HQ, a family's own page. Every family, detective, clue and
// business here is invented (see elf-fixtures.ts).

const page = (v: HqView = hqView()) => new DOMParser().parseFromString(renderHqPage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** The words people see: everything but what is there for a screen reader alone. */
const seen = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return words(copy);
};
const today = (over: Partial<TodayView>, view: Partial<HqView> = {}): HqView => hqView({ ...view, today: { ...hqView().today!, ...over } });

// 7 December 2026 is a Monday: clue 1 at 5:30pm, clue 2 at 6pm, clue 3 at 6:30pm, the place at 7pm.
const CLUE_1 = hqView().today!.clues[0];
const CLUE_2 = { n: 2 as const, at: at("2026-12-07T18:00:00.000Z"), words: "Practice clue 2: it has a lid.", pictureUrl: "/elf/hq/clue/7/2.jpg", pictureAlt: "A pretend drawing of a lid" };
const CLUE_3 = { n: 3 as const, at: at("2026-12-07T18:30:00.000Z"), words: "Practice clue 3: it whistles when it is ready.", pictureUrl: null, pictureAlt: null };
const SIX_10 = at("2026-12-07T18:10:00.000Z");
const SIX_40 = at("2026-12-07T18:40:00.000Z");
const TWO_OUT = today({ clues: [CLUE_1, CLUE_2], nextClueAt: CLUE_3.at, revealAt: at("2026-12-07T19:00:00.000Z") }, { now: SIX_10 });
const ALL_OUT = today({ clues: [CLUE_1, CLUE_2, CLUE_3], nextClueAt: null, revealAt: at("2026-12-07T19:00:00.000Z"), mayShowLater: true }, { now: SIX_40 });

describe("Detective HQ", () => {
  it("is a private page with one heading and a greeting", () => {
    const doc = page();
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(words(doc.querySelector("h1"))).toBe("Detective HQ");
    expect(doc.title).toBe("Detective HQ | Night Before Christmas Campaign");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    expect(words(doc.querySelector(".elf-hq__hello"))).toContain("Hello Sam");
    expect(doc.querySelector('script[src="/assets/js/elf-hq.js"]')).not.toBeNull();
  });

  it("links back to the calendar, from the strip under the site's banner", () => {
    const go = page().querySelector('nav.elf-bar a.elf-bar__go[href="/elf"]');
    expect(go).not.toBeNull();
    expect(words(go)).toBe("The calendar");
  });
});

describe("today's case before its first clue", () => {
  it("counts down to the clue, and shows no clue and no guess", () => {
    const doc = page(today({ state: "shut", nextClueAt: at("2026-12-07T19:00:00.000Z"), clues: [{ n: 1, at: at("2026-12-07T19:00:00.000Z"), words: "A clue that must not show yet", pictureUrl: null, pictureAlt: null }] }));
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("Door 7");
    expect(words(card)).toContain("Clue out at 7pm");
    expect(card.querySelector(".elf-cd")!.getAttribute("data-until")).toBe("2026-12-07T19:00:00.000Z");
    expect(card.querySelector(".elf-cd")!.textContent).toBe("1:20:00");
    expect(doc.documentElement.outerHTML).not.toContain("must not show yet");
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector(".elf-clue")).toBeNull();
  });
});

describe("the clue ladder", () => {
  it("puts each clue that is out on a taped note of its own, and nothing of a clue still to come", () => {
    const doc = page(TWO_OUT);
    const notes = [...doc.querySelectorAll(".elf-ladder > .elf-clue")];
    expect(notes.length).toBe(2);
    expect(notes.map((n) => words(n.querySelector(".elf-clue__n")))).toEqual(["Clue 1", "Clue 2"]);
    expect(notes.map((n) => words(n.querySelector(".elf-clue__at")))).toEqual(["5:30pm", "6pm"]);
    for (const n of notes) expect(n.querySelector(":scope > .elf-tape")!.getAttribute("aria-hidden")).toBe("true");
    expect(doc.documentElement.outerHTML).not.toContain(CLUE_3.words);
    expect(doc.querySelectorAll(".elf-clue").length).toBe(2);
  });

  // Two locks on a clue before its time: the view holds only the clues that are out, and the page
  // writes only those whose time has come, whatever the view holds.
  it("never writes a clue whose time has not come, even when the view holds it", () => {
    const doc = page(today({ clues: [CLUE_1, CLUE_2, CLUE_3], nextClueAt: CLUE_3.at }, { now: SIX_10 }));
    expect([...doc.querySelectorAll(".elf-clue")].map((n) => words(n.querySelector(".elf-clue__n")))).toEqual(["Clue 1", "Clue 2"]);
    expect(doc.documentElement.outerHTML).not.toContain(CLUE_3.words);
    expect(words(doc.querySelector(".elf-ladder__next"))).toBe("Clue 3 comes out at 6:30pm");
    // A clock that is not a real time shows no clue at all.
    expect(page(today({}, { now: new Date("nonsense") })).querySelector(".elf-clue")).toBeNull();
  });

  it("keeps a clue's lines as staff wrote them", () => {
    const first = page().querySelector(".elf-clue .elf-clue__words")!;
    expect(words(first)).toBe("I am hiding where stories sleep on shelves. Look up, not down!");
    expect(first.querySelectorAll("br").length).toBe(1);
  });

  it("shows a clue's picture with its words for a screen reader", () => {
    const pic = page(TWO_OUT).querySelectorAll(".elf-clue")[1].querySelector<HTMLImageElement>("img.elf-clue__pic")!;
    expect(pic.getAttribute("src")).toBe("/elf/hq/clue/7/2.jpg");
    expect(pic.getAttribute("alt")).toBe("A pretend drawing of a lid");
    expect(pic.getAttribute("width")).toMatch(/^\d+$/);
    expect(pic.getAttribute("height")).toMatch(/^\d+$/);
    expect(page(TWO_OUT).querySelectorAll(".elf-clue")[0].querySelector("img")).toBeNull();
  });

  it("counts down to the next clue", () => {
    const doc = page(TWO_OUT);
    expect(words(doc.querySelector(".elf-ladder__next"))).toBe("Clue 3 comes out at 6:30pm");
    const cd = doc.querySelector(".elf-case .elf-cd")!;
    expect(cd.getAttribute("data-until")).toBe("2026-12-07T18:30:00.000Z");
    expect(cd.textContent).toBe("20:00");
  });

  // Task 9 (the coordinator, after the report): under the one rule the place is shown only to a family that has
  // had its guess, so once all three clues are out the ladder says when a family finds out whether it cracked
  // the case, in the clue email's words while the elf is still hiding (perhaps later than the reveal).
  it("says when a family finds out whether it cracked it once all three clues are out", () => {
    const doc = page(ALL_OUT);
    expect(doc.querySelectorAll(".elf-clue").length).toBe(3);
    expect(words(doc.querySelector(".elf-ladder__next"))).toBe("You find out whether you cracked it at 7pm, or later if the elf is still hiding then.");
    expect(doc.querySelector(".elf-case .elf-cd")).toBeNull();
    expect(words(doc.querySelector(".elf-case"))).not.toContain("comes out at");
    expect(words(doc.querySelector(".elf-case"))).not.toContain("is shown at");
  });

  // As the calendar says it once the elf is found, and as the clue email says it when the place closes by the
  // reveal: the family finds out at the reveal, never later. Fix round 1 (the review's Minor 1): the view says
  // which (TodayView.mayShowLater, from the run's own closing), never the closing time the case shows, which is
  // gone once it has passed.
  it("says only the reveal's time once the elf is found, or when the place closes by then, as the view says", () => {
    const next = (over: Partial<TodayView>) => words(page(today({ ...ALL_OUT.today!, ...over }, { now: SIX_40 })).querySelector(".elf-ladder__next"));
    expect(next({ state: "found-hidden", mayShowLater: false })).toBe("You find out whether you cracked it at 7pm.");
    // A found elf's place is shown at the reveal, whatever else the view holds.
    expect(next({ state: "found-hidden", mayShowLater: true })).toBe("You find out whether you cracked it at 7pm.");
    expect(next({ mayShowLater: false, closesAt: null })).toBe("You find out whether you cracked it at 7pm.");
    expect(next({ mayShowLater: true, closesAt: at("2026-12-07T20:00:00.000Z") })).toBe("You find out whether you cracked it at 7pm, or later if the elf is still hiding then.");
  });

  // Final review, Important 2: once the reveal time has passed with the elf still hiding, the place is
  // shown the moment the elf is found, or at its closing at the latest (shownAt). Task 9, fix round 1: said as
  // when a family finds out whether it cracked it, with the closing (typed, or the 8pm fallback) as the latest.
  it("says a family finds out as soon as the elf is found, or at the closing at the latest, once the reveal time has passed", () => {
    const after = (shownBy: Date | null) =>
      page(today({ clues: [CLUE_1, CLUE_2, CLUE_3], nextClueAt: null, revealAt: null, shownBy }, { now: at("2026-12-07T19:20:00.000Z") }));
    const doc = after(at("2026-12-07T20:00:00.000Z"));
    expect(words(doc.querySelector(".elf-ladder__next"))).toBe("You find out whether you cracked it as soon as the elf is found, or at 8pm at the latest.");
    expect(doc.querySelector(".elf-case .elf-cd")).toBeNull();
    expect(doc.querySelector("form.elf-guess")).not.toBeNull();
    expect(words(doc.querySelector(".elf-case"))).not.toContain("is shown");
    // With no real time to give, the find alone.
    expect(words(after(null).querySelector(".elf-ladder__next"))).toBe("You find out whether you cracked it as soon as the elf is found.");
  });
});

describe("the guess", () => {
  it("is one box to type the place in, with a button to lock it in, and works with no script", () => {
    const doc = page();
    const form = doc.querySelector<HTMLFormElement>("form.elf-guess")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/elf/hq/guess");
    expect(form.getAttribute("data-api")).toBe("/api/elf/guess");
    expect(form.querySelector<HTMLInputElement>('input[type="hidden"][name="door"]')!.value).toBe("7");
    const box = form.querySelector<HTMLInputElement>('input[name="text"][maxlength="80"]')!;
    expect(box.type).toBe("text");
    expect(box.getAttribute("autocomplete")).toBe("off");
    expect(box.required).toBe(true);
    expect(box.value).toBe("");
    expect(words(form.querySelector("legend"))).toBe("Where is Bauble hiding?");
    expect(words(doc.querySelector(`label[for="${box.id}"]`))).toBe("Type the name of the place. Spelling does not have to be perfect.");
    expect(words(form.querySelector("button"))).toBe("Lock in my guess");
    expect(form.querySelector(".elf-guess__status")!.getAttribute("role")).toBe("status");
  });

  it("shows the family's guess as typed, and says it can still be changed until the place is shown", () => {
    const doc = page(today({ guess: { text: "The Bookshop", at: at("2026-12-07T17:45:00.000Z") } }));
    const form = doc.querySelector("form.elf-guess")!;
    expect(form.querySelector<HTMLInputElement>('input[name="text"]')!.value).toBe("The Bookshop");
    expect(words(form.querySelector(".elf-guess__status"))).toBe("Your guess: The Bookshop. You can change it until the hiding place is shown.");
    expect(words(form.querySelector("button"))).toBe("Change my guess");
  });

  it("says why a guess sent with no script was not taken, in the form's status line, made safe", () => {
    const doc = page(today({ guess: { text: "The Bookshop", at: at("2026-12-07T17:45:00.000Z") }, guessError: "That elf was already found behind door 3. <b>Try again!</b>" }));
    const status = doc.querySelector("form.elf-guess .elf-guess__status")!;
    expect(status.classList.contains("is-error")).toBe(true);
    expect(status.getAttribute("role")).toBe("status");
    expect(words(status)).toBe("That elf was already found behind door 3. <b>Try again!</b>");
    expect(status.querySelector("b")).toBeNull();
    // The guess already locked in is still in the box, to change or send again.
    expect(doc.querySelector<HTMLInputElement>('form.elf-guess input[name="text"]')!.value).toBe("The Bookshop");
  });

  it("keeps the status line plain when there is nothing wrong", () => {
    expect(page().querySelector(".elf-guess__status")!.classList.contains("is-error")).toBe(false);
  });

  it("still says why a guess was not taken where the case has no form any more (the place is shown now)", () => {
    const outcome = { place: "The Toy Shop, Troon", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: false };
    const doc = page(today({ state: "found", canGuess: false, outcome, guessError: "There is nothing to guess at this door just now." }));
    expect(doc.querySelector("form.elf-guess")).toBeNull();
    const status = doc.querySelector(".elf-case .elf-guess__status.is-error")!;
    expect(words(status)).toBe("There is nothing to guess at this door just now.");
    expect(status.getAttribute("role")).toBe("status");
    // And nothing at all when there is nothing to say.
    expect(page(today({ state: "found", canGuess: false, outcome })).querySelector(".elf-guess__status")).toBeNull();
  });

  it("offers no empty form when there is nothing left to guess", () => {
    const doc = page(today({ canGuess: false }));
    expect(doc.querySelector("form.elf-guess")).toBeNull();
    expect(words(doc.querySelector(".elf-case"))).toContain("nothing left to guess");
  });
});

describe("a find while the place is still hidden", () => {
  it("says the elf has been found, and keeps the clues and the guess going", () => {
    const doc = page(today({ state: "found-hidden", clues: [CLUE_1, CLUE_2], nextClueAt: CLUE_3.at, canGuess: true }, { now: SIX_10 }));
    const card = doc.querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Bauble has been found!");
    expect(card.querySelectorAll(".elf-clue").length).toBe(2);
    expect(words(card.querySelector(".elf-ladder__next"))).toBe("Clue 3 comes out at 6:30pm");
    expect(card.querySelector("form.elf-guess")).not.toBeNull();
    expect(words(card)).not.toContain("Case closed");
  });
});

describe("how an open door turned out", () => {
  const outcome = { place: "The Toy Shop, Troon", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: false };

  it("says the family cracked the case, with the guess as they typed it", () => {
    const doc = page(
      today({
        state: "found",
        canGuess: false,
        guess: { text: "the bookshop", at: at("2026-12-07T17:45:00.000Z") },
        outcome: { place: "The Bookshop, Ayr", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: true },
      }),
    );
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("You cracked it! Your guess was the bookshop.");
    expect(words(card)).toContain("Bauble was hiding at The Bookshop, Ayr");
    expect(words(card)).toContain("Found first by Detective Orla Snowsleuth at 5:47pm");
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector(".elf-clue")).toBeNull();
  });

  it("is kind about a wrong guess, and about no guess at all", () => {
    const wrong = page(today({ state: "found", canGuess: false, guess: { text: "The Bookshop", at: at("2026-12-07T17:45:00.000Z") }, outcome }));
    expect(words(wrong.querySelector(".elf-case"))).toContain("Your guess was The Bookshop. Not this time, but there is a new clue tomorrow.");
    const none = page(today({ state: "found", canGuess: false, guess: null, outcome }));
    expect(words(none.querySelector(".elf-case"))).toContain("You did not lock in a guess for this one");
    expect(words(none.querySelector(".elf-case"))).not.toContain("You cracked it");
  });

  it("says a revealed elf is still there to be won", () => {
    const doc = page(today({ state: "revealed", canGuess: false, guess: null, outcome: { place: "The Toy Shop, Snowford", by: null, at: null, cracked: false } }));
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("Bauble is still waiting at The Toy Shop, Snowford");
    // Decision 1: the prize is what is won (final review, Important 7).
    expect(words(card)).toContain(
      "Nobody found Bauble in time. Bauble is still waiting at The Toy Shop, Snowford, and the first detective to type the word on its tag still wins the prize.",
    );
    expect(words(card)).not.toContain("Found first by");
  });
});

// Plan 2c-1, Task 7: Detective HQ catches up. At 7:05pm door 7's place has been shown since 7pm, and it closes
// at 8pm. A family that can see the place sees how the case turned out; one that may have a go is offered it.
const SEVEN_05 = at("2026-12-07T19:05:00.000Z");
const EIGHT = at("2026-12-07T20:00:00.000Z");
/** An open door's case: no clue ladder, no countdown and no guess. */
const OPEN: Partial<TodayView> = { canGuess: false, clues: [], nextClueAt: null, revealAt: null };
const MAY_GO = today({ ...OPEN, state: "found", outcome: null, goUrl: "/elf/hq/door/7", closesAt: EIGHT }, { now: SEVEN_05 });

describe("today's case for a family that may still have a go", () => {
  it("offers its one go in place of how the case turned out, under the case's own heading", () => {
    const card = page(MAY_GO).querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Case closed");
    expect(words(card)).toContain("You did not lock in a guess in time, but you can still crack this case, with one guess.");
    const go = card.querySelector('a[href="/elf/hq/door/7"]')!;
    expect(seen(go)).toBe("Have a go");
    expect(words(go)).toBe("Have a go at door 7");
    expect(go.className).toBe("elf-btn elf-btn--crimson");
    expect(words(card)).not.toContain("You did not lock in a guess for this one.");
    expect(words(card)).not.toContain("Visit the hiding place");
    expect(card.querySelector("form")).toBeNull();
  });

  it("keeps the heading of a door shown with nobody found", () => {
    const card = page(today({ ...MAY_GO.today!, state: "revealed" }, { now: SEVEN_05 })).querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Bauble is still out there");
    expect(seen(card.querySelector('a[href="/elf/hq/door/7"]')!)).toBe("Have a go");
  });

  it("offers no go beside how the case turned out", () => {
    const outcome = { place: "Corner Bakehouse", by: "Detective R. Tinselfoot", at: at("2026-12-07T17:47:00.000Z"), cracked: false };
    const doc = page(today({ ...OPEN, state: "found", outcome, goUrl: null }, { now: SEVEN_05 }));
    expect(doc.querySelector('a[href^="/elf/hq/door/"]')).toBeNull();
    expect(words(doc.querySelector(".elf-case"))).not.toContain("Have a go");
  });

  it("offers a go only on this site", () => {
    const doc = page(today({ ...MAY_GO.today!, goUrl: "https://elsewhere.example/go" }, { now: SEVEN_05 }));
    expect(doc.querySelector('.elf-case a[href^="https:"]')).toBeNull();
    expect(words(doc.querySelector(".elf-case"))).not.toContain("Have a go");
  });
});

// Task 9, from Task 7's review: once a head elf presses gone home the elf can no longer be found, and the poster
// refuses a visit, so today's case never promises the prize or a visit then, nor says the elf is still out there.
describe("today's case once the elf has gone home", () => {
  const where = { place: "Corner Bakehouse", by: null, at: null, cracked: false };

  it("says where a door shown with nobody found was hiding, with no prize and no visit, under a heading of its own", () => {
    const card = page(today({ ...OPEN, state: "revealed", goneHome: true, outcome: where }, { now: SEVEN_05 })).querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Bauble has gone home");
    expect(words(card)).toContain("Bauble was hiding at Corner Bakehouse.");
    for (const gone of ["still out there", "still waiting", "still wins the prize", "Visit the hiding place"]) expect(words(card), gone).not.toContain(gone);
  });

  it("offers a family that may still have a go its go, under the same heading", () => {
    const card = page(today({ ...MAY_GO.today!, state: "revealed", goneHome: true }, { now: SEVEN_05 })).querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Bauble has gone home");
    expect(card.querySelector('a[href="/elf/hq/door/7"]')).not.toBeNull();
  });

  it("still says who found a found elf, with no visit, under Case closed", () => {
    const outcome = { place: "Corner Bakehouse", by: "Detective R. Tinselfoot", at: at("2026-12-07T17:47:00.000Z"), cracked: true };
    const card = page(today({ ...OPEN, state: "found", goneHome: true, outcome }, { now: SEVEN_05 })).querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Case closed");
    expect(words(card)).toContain("Bauble was hiding at Corner Bakehouse.");
    expect(words(card)).toContain("Found first by Detective R. Tinselfoot at 5:47pm");
    expect(words(card)).not.toContain("Visit the hiding place");
    // Until the elf goes home, the visit is still there to make.
    expect(words(page(today({ ...OPEN, state: "found", outcome }, { now: SEVEN_05 })).querySelector(".elf-case"))).toContain("Visit the hiding place");
  });
});

describe("when the hiding place closes", () => {
  it("says so under the clue ladder while the hunt is on", () => {
    const doc = page(today({ closesAt: EIGHT }));
    expect(words(doc.querySelector(".elf-case .elf-ladder__closes"))).toBe("The hiding place closes at 8pm today.");
    // Under the clues, before the guess.
    expect(doc.querySelector(".elf-ladder__closes ~ form.elf-guess")).not.toBeNull();
  });

  it("says so while the elf is found with the place still hidden", () => {
    const doc = page(today({ state: "found-hidden", clues: [CLUE_1, CLUE_2], nextClueAt: CLUE_3.at, closesAt: EIGHT }, { now: SIX_10 }));
    expect(words(doc.querySelector(".elf-ladder__closes"))).toBe("The hiding place closes at 8pm today.");
  });

  it("names the place under how the case turned out, for a family that can see it", () => {
    const outcome = { place: "Corner Bakehouse", by: "Detective R. Tinselfoot", at: at("2026-12-07T17:47:00.000Z"), cracked: true };
    const card = page(today({ ...OPEN, state: "found", outcome, closesAt: EIGHT }, { now: SEVEN_05 })).querySelector(".elf-case")!;
    expect(words(card)).toContain("Corner Bakehouse closes at 8pm today.");
    expect(words(card)).not.toContain("The hiding place closes");
  });

  it("says nothing of closing without a closing time", () => {
    const outcome = { place: "Corner Bakehouse", by: null, at: null, cracked: false };
    for (const v of [hqView(), ALL_OUT, today({ ...OPEN, state: "revealed", outcome }, { now: SEVEN_05 })]) {
      expect(words(page(v).querySelector(".elf-case"))).not.toContain("closes at");
    }
  });
});

describe("the doors a family can still crack", () => {
  const TO_CRACK: HqView["toCrack"] = [
    { door: 5, elfName: "Sprout", clueAt: at("2026-12-05T10:00:00.000Z"), url: "/elf/hq/door/5" },
    { door: 3, elfName: "Pudding", clueAt: at("2026-12-03T17:30:00.000Z"), url: "/elf/hq/door/3" },
  ];

  it("come straight after today's case, under a gold strip, with what having a go is", () => {
    const doc = page(hqView({ toCrack: TO_CRACK }));
    const sections = [...doc.querySelectorAll("main > section")];
    const crack = doc.querySelector("main > section.elf-hq-crack")!;
    expect(sections.indexOf(crack)).toBe(sections.indexOf(doc.querySelector("main > section.elf-hq-case")!) + 1);
    const strip = crack.querySelector("h2")!;
    expect(words(strip)).toBe("Doors you can still crack");
    expect(strip.classList.contains("elf-strip--gold")).toBe(true);
    expect(crack.getAttribute("aria-labelledby")).toBe(strip.id);
    expect(words(crack)).toContain("Missed a door? Crack its case here, with one guess. You get the same three clues, one at a time.");
  });

  it("give each door its number, its day, its elf and a go, newest first", () => {
    const doors = [...page(hqView({ toCrack: TO_CRACK })).querySelectorAll(".elf-crack > .elf-crack__door")];
    expect(doors.map((d) => words(d.querySelector("h3")))).toEqual(["Door 5", "Door 3"]);
    expect(words(doors[0])).toContain("Sat 5 Dec");
    expect(words(doors[0])).toContain("Sprout");
    expect(words(doors[1])).toContain("Thu 3 Dec");
    expect(words(doors[1])).toContain("Pudding");
    const go = doors[0].querySelector('a[href="/elf/hq/door/5"]')!;
    expect(seen(go)).toBe("Have a go");
    expect(go.classList.contains("elf-btn")).toBe(true);
    expect(doors[1].querySelector('a[href="/elf/hq/door/3"]')).not.toBeNull();
  });

  // Task 9, from Task 7's review: today's case and the list can hold several Have a go links at once, so each
  // names its door to a screen reader, in words hidden from sight; the words people see stay "Have a go".
  it("name their door to a screen reader on every Have a go link, as today's case does", () => {
    const links = [...page({ ...MAY_GO, toCrack: TO_CRACK }).querySelectorAll('main a[href^="/elf/hq/door/"]')];
    expect(links.map(words)).toEqual(["Have a go at door 7", "Have a go at door 5", "Have a go at door 3"]);
    for (const a of links) {
      expect(seen(a)).toBe("Have a go");
      expect(words(a.querySelector(".sr-only"))).toMatch(/^at door [357]$/);
    }
    const practice = page(today({ ...MAY_GO.today!, door: 0, practice: true, goUrl: "/elf/hq/door/0" }, { now: SEVEN_05 }));
    expect(words(practice.querySelector('a[href="/elf/hq/door/0"]'))).toBe("Have a go at the practice door");
  });

  it("are not on the page when there are none", () => {
    const doc = page();
    expect(doc.querySelector(".elf-hq-crack, .elf-crack")).toBeNull();
    expect(words(doc.querySelector("main"))).not.toContain("Doors you can still crack");
  });

  it("leave out a door whose go is not on this site, and the whole list when none is", () => {
    const off = [{ ...TO_CRACK[0], url: "https://elsewhere.example/5" }, TO_CRACK[1]];
    expect([...page(hqView({ toCrack: off })).querySelectorAll(".elf-crack__door h3")].map((h) => words(h))).toEqual(["Door 3"]);
    expect(page(hqView({ toCrack: [off[0]] })).querySelector(".elf-hq-crack")).toBeNull();
  });
});

describe("a snow day", () => {
  it("says the elf got snowed in and the door counts for everyone, with no clue and no guess", () => {
    const doc = page(today({ state: "snow", clues: [], nextClueAt: null, canGuess: false }, { now: SIX_10 }));
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("Bauble got snowed in. This door counts as done for everyone.");
    expect(card.querySelector(".elf-clue, .elf-ladder")).toBeNull();
    expect(doc.querySelector("form")).toBeNull();
    expect(card.querySelector(".elf-cd")).toBeNull();
  });
});

describe("the practice door", () => {
  it("is plainly a practice, never door 0", () => {
    const doc = page(today({ door: 0, practice: true }));
    const card = doc.querySelector(".elf-case")!;
    expect(words(card.querySelector(".elf-practice"))).toContain("The practice door");
    expect(words(card.querySelector(".elf-practice .elf-chip"))).toBe("Practice");
    expect(words(card)).not.toMatch(/door 0/i);
    expect(doc.querySelector<HTMLInputElement>('form.elf-guess input[name="door"]')!.value).toBe("0");
  });

  it("is not called a practice on a real door", () => {
    expect(page().querySelector(".elf-practice")).toBeNull();
    expect(words(page().querySelector(".elf-case__door"))).toBe("Door 7");
  });
});

describe("a day with no case", () => {
  it("looks ahead to the next clue, and counts the sleeps", () => {
    const doc = page(hqView({ now: at("2026-11-20T10:00:00.000Z"), today: null, nextClueAt: at("2026-12-01T17:30:00.000Z") }));
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("The first clue comes out on Tuesday 1 December at 5:30pm");
    expect(words(card)).toContain("11 sleeps to go");
  });

  it("thanks the family when there are no more clues to come", () => {
    const doc = page(hqView({ now: at("2026-12-26T10:00:00.000Z"), today: null, nextClueAt: null }));
    expect(words(doc.querySelector(".elf-case"))).toContain("Every door is open");
  });
});

describe("the family's detectives", () => {
  it("gives each detective a card with their elf, badge number, rank and progress", () => {
    const cards = [...page().querySelectorAll(".elf-detective")];
    expect(cards.length).toBe(2);
    const ruby = cards[0];
    expect(words(ruby.querySelector("h3"))).toBe("Detective Ruby Tinselfoot");
    expect(words(ruby)).toContain("Badge 0427");
    expect(words(ruby)).toContain("Trainee");
    expect(words(ruby)).toContain("4 doors done");
    expect(words(ruby)).toContain("2 more to Junior Detective");
    const img = ruby.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/elf/pic/d1.svg");
    expect(img.getAttribute("alt")).toBe("Detective Ruby Tinselfoot's elf");
    expect(img.getAttribute("width")).not.toBeNull();
    const bar = ruby.querySelector("progress")!;
    expect(bar.getAttribute("max")).toBe("24");
    expect(bar.getAttribute("value")).toBe("4");
  });

  it("says one door, not one doors", () => {
    const one = hqView();
    one.detectives[0] = { ...one.detectives[0], doorsDone: 1, next: { rank: "Junior Detective", toGo: 5 } };
    expect(words(page(one).querySelector(".elf-detective"))).toContain("1 door done");
  });

  it("points to the wardrobe, and says when there are presents to open in it", () => {
    const [ruby, leo] = [...page().querySelectorAll(".elf-detective")];
    expect(ruby.querySelector('a[href="/elf/hq/wardrobe/d1"]')).not.toBeNull();
    expect(words(ruby.querySelector(".elf-new"))).toBe("3 presents to open");
    expect(leo.querySelector(".elf-new")).toBeNull();
    const presents = (n: number) => {
      const view = hqView();
      view.detectives[0] = { ...view.detectives[0], newThings: n };
      return words(page(view).querySelector(".elf-detective .elf-new"));
    };
    expect(presents(1)).toBe("A present to open");
    expect(presents(2)).toBe("Two presents to open");
  });

  it("tells the family when a first name is still waiting to be checked", () => {
    const [ruby, leo] = [...page().querySelectorAll(".elf-detective")];
    expect(ruby.querySelector(".elf-detective__note")).toBeNull();
    expect(words(leo.querySelector(".elf-detective__note"))).toContain("first letter");
  });

  it("marks a graduate and the gold seal", () => {
    const view = hqView();
    view.detectives[0] = { ...view.detectives[0], rank: "Graduate", doorsDone: 24, next: null, graduate: true, goldSeal: true };
    const ruby = page(view).querySelector(".elf-detective")!;
    expect(words(ruby)).toContain("Graduate");
    expect(words(ruby)).toContain("Gold seal");
    expect(words(ruby)).toContain("All 24 doors done");
  });
});

describe("the family's marks", () => {
  it("shows all 24 doors small, with the marks the family has earned", () => {
    const cells = [...page().querySelectorAll(".elf-marks li")];
    expect(cells.length).toBe(24);
    expect(cells[0].querySelectorAll(".elf-mark").length).toBe(2);
    expect(cells[1].querySelectorAll(".elf-mark").length).toBe(1);
    expect(cells[3].querySelectorAll(".elf-mark").length).toBe(1);
    expect(cells[8].querySelectorAll(".elf-mark").length).toBe(0);
  });

  it("says each door's marks in words for a screen reader", () => {
    const cells = [...page().querySelectorAll(".elf-marks li")];
    const said = (cell: Element) => words(cell.querySelector(".sr-only"));
    expect(said(cells[0])).toBe("Door 1: cracked and visited");
    expect(said(cells[1])).toBe("Door 2: cracked");
    expect(said(cells[3])).toBe("Door 4: visited");
    expect(said(cells[8])).toBe("Door 9: not done yet");
    expect(cells[0].hasAttribute("aria-label")).toBe(false);
  });

  it("adds them up", () => {
    expect(words(page().querySelector(".elf-marks__sum"))).toBe("2 cracked and 2 visited so far");
  });

  // Final review, Important 3: a snow day counts as done for every detective, so the family's marks
  // show it done, and say why.
  it("marks a snowed in door as done, and says so for a screen reader", () => {
    const view = hqView({ marks: { doors: [...hqView().marks.doors, { door: 5, cracked: false, visited: false, snow: true }], photos: [] } });
    const cells = [...page(view).querySelectorAll(".elf-marks li")];
    expect(cells[4].classList.contains("is-done")).toBe(true);
    expect(words(cells[4].querySelector(".sr-only"))).toBe("Door 5: snowed in, so it counts as done.");
    // Neither a magnifying glass nor a candy cane: nobody cracked it or went there.
    expect(cells[4].querySelectorAll(".elf-mark").length).toBe(0);
    expect(cells[8].classList.contains("is-done")).toBe(false);
    // The sum still counts only the cases cracked and the places visited.
    expect(words(page(view).querySelector(".elf-marks__sum"))).toBe("2 cracked and 2 visited so far");
  });
});

describe("data that is not what it should be", () => {
  it("still draws the page when today's clue time is not a real date", () => {
    const view = today({ state: "shut", nextClueAt: new Date("not a date"), clues: [], canGuess: false });
    const card = page(view).querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Today's clue is on its way");
    expect(card.querySelector(".elf-cd")).toBeNull();
    expect(() => renderHqPage(hqView({ now: new Date("nonsense") }))).not.toThrow();
    expect(() => renderHqPage({ ...view, now: new Date("nonsense") })).not.toThrow();
    expect(() => renderHqPage(today({ nextClueAt: new Date("nonsense") }))).not.toThrow();
  });

  it("writes counts as whole numbers, even when a database hands them over as text", () => {
    const view = hqView();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.detectives[0] = { ...view.detectives[0], doorsDone: '7"><b>x' as any, newThings: "2<i>" as any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.today = { ...view.today!, door: '7"><b>x' as any };
    const doc = page(view);
    expect(doc.querySelector("main b > b, main i")).toBeNull();
    expect(doc.querySelector<HTMLInputElement>('input[name="door"]')!.value).toBe("0");
  });

  it("names the progress bar for a screen reader", () => {
    expect(page().querySelector("progress")!.getAttribute("aria-label")).toBe("4 doors done");
  });

  it("keeps a clue picture that is not one of the site's own off the page", () => {
    const view = today({ clues: [{ ...CLUE_2, n: 1, pictureUrl: "https://example.com/x.jpg" }] });
    expect(page(view).querySelector(".elf-clue img")).toBeNull();
  });
});

describe("what comes from data", () => {
  it("is escaped wherever it is shown", () => {
    const view = hqView({ familyName: "<b>Sam</b>" });
    view.detectives[0] = { ...view.detectives[0], name: '<img src=x onerror="alert(1)">', badgeNumber: "<i>1</i>" };
    view.today = {
      ...view.today!,
      clues: [{ n: 1, at: at("2026-12-07T17:30:00.000Z"), words: "<script>alert(1)</script>", pictureUrl: "/elf/hq/clue/7/1.jpg", pictureAlt: '"><u>alt</u>' }],
      elfName: "<u>Elf</u>",
      guess: { text: "<b>Shop</b>", at: at("2026-12-07T17:45:00.000Z") },
    };
    const doc = page(view);
    expect(doc.querySelector("script:not([src])")).toBeNull();
    expect(doc.querySelector("main u, main i, [onerror]")).toBeNull();
    expect([...doc.querySelectorAll("main b")].map((b) => b.textContent)).not.toContain("Sam");
    expect(doc.querySelector(".elf-clue img")!.getAttribute("alt")).toBe('"><u>alt</u>');
    // The two elves' pictures and the clue's picture, and only the page's own painted decorations besides.
    expect(doc.querySelectorAll("main img:not(.elf-deco)").length).toBe(3);
  });
});

// The paper look (docs/superpowers/specs/2026-11-04-elf-paper-design.md): Detective HQ in paper.
describe("Detective HQ, in paper", () => {
  const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

  it("has its title on a torn strip, under the school's name on a torn label", () => {
    const doc = page();
    expect(words(doc.querySelector(".elf-top .elf-label"))).toBe("Elf Detective School");
    expect(words(doc.querySelector(".elf-title h1#elf-hq-heading"))).toBe("Detective HQ");
    expect(doc.querySelector(".elf-top .eyebrow")).toBeNull();
  });

  it("puts the day's case on a taped note, in every state", () => {
    const states: HqView[] = [
      hqView(),
      TWO_OUT,
      today({ state: "shut", clues: [], canGuess: false }),
      today({ state: "found-hidden", canGuess: true }),
      today({ state: "found", canGuess: false, outcome: { place: "The Toy Shop, Troon", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: true } }),
      today({ state: "snow", clues: [], nextClueAt: null, canGuess: false }),
      today({ door: 0, practice: true }),
      hqView({ today: null }),
    ];
    for (const v of states) {
      const card = page(v).querySelector(".elf-case")!;
      expect(card.classList.contains("elf-note")).toBe(true);
      expect(card.querySelector(":scope > .elf-tape")!.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("counts down on the candy cane strip, to the clue, to the next clue and to the next day's", () => {
    expect(page(today({ state: "shut", clues: [], canGuess: false })).querySelector(".elf-case .elf-cane-strip .elf-cd")).not.toBeNull();
    expect(page(TWO_OUT).querySelector(".elf-case .elf-cane-strip .elf-cd")).not.toBeNull();
    expect(words(page(hqView({ today: null })).querySelector(".elf-case .elf-cane-strip"))).toBe("1 sleep to go");
  });

  it("locks in a guess with a crimson torn paper button, and uses none of the site's own buttons", () => {
    const doc = page(hqView({ addDetectiveUrl: "/elf/join" }));
    expect(doc.querySelector('form.elf-guess button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(doc.querySelector(".site-main .btn")).toBeNull();
    expect(doc.querySelector('.elf-add-detective a[href="/elf/join"]')!.className).toBe("elf-btn");
    expect(doc.querySelector('.elf-hq-marks a[href="/elf"]')!.className).toBe("elf-btn");
  });

  it("lays the clue ladder out as a list of notes that wrap, never a box that scrolls", () => {
    expect(css).toMatch(/\.elf-ladder \{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.elf-clue__pic \{[^}]*max-width:\s*100%/);
  });

  it("sets each detective on a card sheet, with their elf in its chosen frame or a plain paper mount", () => {
    const view = hqView();
    view.detectives[0] = { ...view.detectives[0], frame: "candy" };
    const [ruby, leo] = [...page(view).querySelectorAll(".elf-detective")];
    expect(ruby.classList.contains("elf-card")).toBe(true);
    expect(leo.classList.contains("elf-card")).toBe(true);
    const frame = ruby.querySelector(".elf-frame")!;
    expect([...frame.classList]).toContain("elf-frame--candy");
    const img = frame.querySelector("img")!;
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["96", "144"]);
    expect([...leo.querySelector(".elf-frame")!.classList].filter((c) => c.startsWith("elf-frame--"))).toEqual([]);
  });

  it("keeps an unknown frame off the page", () => {
    const view = hqView();
    view.detectives[0] = { ...view.detectives[0], frame: 'x" onclick="alert(1)' };
    const frame = page(view).querySelector(".elf-detective .elf-frame")!;
    expect([...frame.classList].filter((c) => c.startsWith("elf-frame--"))).toEqual([]);
    expect(frame.getAttribute("onclick")).toBeNull();
  });

  it("shows each detective's rank, and the gold seal, on paper chips, and the doors done on the candy cane strip", () => {
    const view = hqView();
    view.detectives[0] = { ...view.detectives[0], goldSeal: true };
    const ruby = page(view).querySelector(".elf-detective")!;
    expect(words(ruby.querySelector(".elf-detective__rank .elf-chip"))).toBe("Trainee");
    expect(words(ruby.querySelector(".elf-chip.elf-chip--today"))).toBe("Gold seal");
    expect(ruby.querySelector(".elf-pill")).toBeNull();
    expect(ruby.querySelector("progress")!.classList.contains("elf-cane-progress")).toBe(true);
    expect(css).toMatch(/\.elf-cane-progress::-webkit-progress-value \{[^}]*repeating-linear-gradient\(45deg, var\(--crimson\)/);
    expect(css).toMatch(/\.elf-cane-progress::-moz-progress-bar \{[^}]*repeating-linear-gradient\(45deg, var\(--crimson\)/);
  });
});
