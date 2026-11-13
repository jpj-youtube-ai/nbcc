// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { goOutcomeWords, renderGoPage } from "../../src/elf/pages/go";
import type { GoView } from "../../src/elf/pages/types";
import { at, goDoneView, goOutcome, goView } from "./elf-fixtures";

// NBCC Elf Detective School, catching up on missed doors (Plan 2c-1, Task 6): having a go at a door the
// family missed, on its own page in Detective HQ. The clues one at a time, then one guess; once the family
// can see the place, how it went. Every family, detective, clue and business here is invented (see
// elf-fixtures.ts).

const page = (v: GoView = goView()) => new DOMParser().parseFromString(renderGoPage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Everything the page's own part says, the site's banner and footer left out. */
const said = (v: GoView) => words(page(v).querySelector("main"));
const CLUE_2 = { n: 2 as const, at: at("2026-12-07T18:00:00.000Z"), words: "Practice clue 2: it has a crust.", pictureUrl: "/elf/hq/clue/7/2.jpg", pictureAlt: "A pretend drawing of a loaf" };
const CLUE_3 = { n: 3 as const, at: at("2026-12-07T18:30:00.000Z"), words: "Practice clue 3: it smells of cinnamon.", pictureUrl: null, pictureAlt: null };
const ALL_THREE = goView({ clues: [goView().clues[0], CLUE_2, CLUE_3], nextUrl: null });

describe("the go page", () => {
  it("is a private page named for its door, never its place, under Detective HQ's label, with the door's elf", () => {
    const doc = page();
    expect(doc.title).toBe("Door 7 | Night Before Christmas Campaign");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(words(doc.querySelector("h1"))).toBe("Door 7");
    expect(words(doc.querySelector(".elf-label"))).toBe("Detective HQ");
    expect(words(doc.querySelector(".elf-go__elf"))).toBe("Twinkle, the elf behind door 7");
  });

  it("needs no script: the next clue is a link and the guess a plain form", () => {
    expect(page().querySelector('script[src^="/assets/js/elf-"]')).toBeNull();
  });

  it("leads back to Detective HQ, from the strip under the site's banner and from its foot", () => {
    const doc = page();
    expect(words(doc.querySelector('nav.elf-bar a.elf-bar__go[href="/elf/hq"]'))).toBe("Detective HQ");
    expect(words(doc.querySelector('.elf-go__back a[href="/elf/hq"]'))).toBe("Back to Detective HQ");
  });

  it("says who found the elf and when, or that nobody has found it yet", () => {
    expect(words(page().querySelector(".elf-go__found"))).toBe("Found by Detective R. Tinselfoot at 5:47pm.");
    expect(words(page(goView({ found: null, stillHiding: true })).querySelector(".elf-go__found"))).toBe("Nobody has found Twinkle yet.");
  });

  it("calls the practice door the practice door, with its chip, and never door 0", () => {
    const doc = page(goView({ door: 0, practice: true, nextUrl: "/elf/hq/door/0?clues=2", formUrl: "/elf/hq/door/0/go", closesAt: null }));
    expect(doc.title).toBe("The practice door | Night Before Christmas Campaign");
    expect(words(doc.querySelector("h1"))).toBe("The practice door");
    expect(words(doc.querySelector(".elf-go-top .elf-chip"))).toBe("Practice");
    expect(words(doc.querySelector(".elf-go__elf"))).toBe("Twinkle, the practice door's elf");
    expect(doc.documentElement.outerHTML).not.toMatch(/door 0|Door 0/);
    expect(page().querySelector(".elf-go-top .elf-chip")).toBeNull();
  });
});

describe("having a go", () => {
  // Ruling F12: the view's outcome holds the place, so these fail if the page shows it before its time.
  const going = goView({ outcome: goOutcome() });

  it("shows clue 1, the link to the next clue, and the form for the one guess", () => {
    const doc = page(going);
    expect(words(doc.querySelector("#elf-go-case-heading"))).toBe("Crack the case");
    expect(said(going)).toContain("The clues came out on Monday 7 December. Read them one at a time, then make your guess.");
    expect(doc.querySelectorAll(".elf-clue").length).toBe(1);
    expect(words(doc.querySelector(".elf-clue__n"))).toBe("Clue 1");
    expect(words(doc.querySelector(".elf-clue__words"))).toBe("I am hiding where the loaves cool. Follow your nose!");
    expect(words(doc.querySelector('a[href="/elf/hq/door/7?clues=2"]'))).toBe("Show me the next clue");
    const form = doc.querySelector('form[method="post"][action="/elf/hq/door/7/go"]');
    expect(form).not.toBeNull();
    expect(form!.querySelector('input[name="text"][maxlength="80"]')).not.toBeNull();
    expect(words(form!.querySelector("legend"))).toBe("Where was Twinkle hiding?");
    expect(words(form!.querySelector('label[for="go-text"]'))).toBe("Type the name of the place. Spelling does not have to be perfect.");
    expect(words(form!.querySelector(".elf-go__one"))).toBe("You get one guess at this door.");
    expect(words(form!.querySelector('button[type="submit"]'))).toBe("Lock in my guess");
    expect(said(going)).toContain("The hiding place closes at 8pm today.");
  });

  it("never names the place, even when the view holds it", () => {
    const html = renderGoPage(going);
    for (const secret of ["Corner Bakehouse", "Snowford"]) expect(html).not.toContain(secret);
    expect(page(going).querySelector(".elf-go__verdict")).toBeNull();
  });

  it("shows every clue asked for, each on its note, and no next link once all three show", () => {
    const doc = page(ALL_THREE);
    expect([...doc.querySelectorAll(".elf-clue .elf-clue__n")].map(words)).toEqual(["Clue 1", "Clue 2", "Clue 3"]);
    expect(doc.querySelector('.elf-clue img[src="/elf/hq/clue/7/2.jpg"]')!.getAttribute("alt")).toBe("A pretend drawing of a loaf");
    expect(doc.querySelector(".elf-go__next")).toBeNull();
    expect(said(ALL_THREE)).not.toContain("Show me the next clue");
  });

  it("sends how many clues are showing with the guess, so a refused go comes back as it was", () => {
    expect(page().querySelector('form input[type="hidden"][name="clues"]')!.getAttribute("value")).toBe("1");
    expect(page(ALL_THREE).querySelector('form input[type="hidden"][name="clues"]')!.getAttribute("value")).toBe("3");
  });

  // Ruling F8: "Where is" only while the elf is still out there unfound; "Where was" once it has gone home.
  it("asks where the elf is hiding while it is still out there unfound, and where it was otherwise", () => {
    expect(words(page(goView({ found: null, stillHiding: true })).querySelector("legend"))).toBe("Where is Twinkle hiding?");
    expect(words(page(goView({ found: null, stillHiding: false })).querySelector("legend"))).toBe("Where was Twinkle hiding?");
  });

  it("says nothing of a closing time on another day", () => {
    expect(said(goView({ closesAt: null }))).not.toContain("closes at");
  });

  it("says why a go sent with no script was not taken, in the form's status line", () => {
    const doc = page(goView({ guessError: "That is a bit long. Up to 80 letters is plenty." }));
    expect(words(doc.querySelector('form .elf-guess__status.is-error[role="status"]'))).toBe("That is a bit long. Up to 80 letters is plenty.");
    expect(page().querySelector(".is-error")).toBeNull();
  });
});

describe("how a go went", () => {
  it("says the family cracked it and where the elf was hiding, with no form and no clue", () => {
    const doc = page(goDoneView());
    expect(words(doc.querySelector(".elf-go__verdict"))).toBe("You cracked it! Twinkle was hiding at Corner Bakehouse, Snowford.");
    expect(doc.querySelector(".elf-go__verdict")!.classList.contains("is-cracked")).toBe(true);
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector(".elf-clue")).toBeNull();
    expect(said(goDoneView())).not.toContain("Show me the next clue");
  });

  it("says not this time for a wrong guess", () => {
    const doc = page(goDoneView({ verdict: "wrong" }));
    expect(words(doc.querySelector(".elf-go__verdict"))).toBe("Not this time. Twinkle was hiding at Corner Bakehouse, Snowford.");
    expect(doc.querySelector(".elf-go__verdict")!.classList.contains("is-cracked")).toBe(false);
  });

  it("says where the elf is, and that the first detective to find it still wins, while it is still hiding", () => {
    expect(said(goDoneView({ stillHiding: true }, { found: null, stillHiding: true }))).toContain(
      "You cracked it! Twinkle is hiding at Corner Bakehouse, Snowford, and nobody has found Twinkle yet. The first detective to type the word on its tag still wins the prize.",
    );
  });

  // Ruling F8: a door whose elf has gone home never says the first detective still wins.
  it("says the elf has gone home, and never that the first detective still wins", () => {
    const text = said(goDoneView({ goneHome: true }, { found: null }));
    expect(text).toContain("Twinkle has gone home now, so there is nothing to find there.");
    expect(text).not.toContain("still wins");
    expect(text).not.toContain("Visit the hiding place");
  });

  it("says the family has been there", () => {
    const text = said(goDoneView({ verdict: "none", visited: true }));
    expect(text).toContain("Twinkle was hiding at Corner Bakehouse, Snowford.");
    expect(text).toContain("Your family has been there. Candy cane collected.");
    expect(text).not.toContain("Visit the hiding place");
  });

  it("says the family has been there before anything about the elf going home", () => {
    const text = said(goDoneView({ verdict: "none", visited: true, goneHome: true }, { found: null }));
    expect(text).toContain("Your family has been there. Candy cane collected.");
    expect(text).not.toContain("gone home");
  });

  it("invites any other family to visit for its candy cane", () => {
    expect(said(goDoneView())).toContain("Visit the hiding place and scan its poster to collect your candy cane.");
  });

  it("says when the place closes on the door's own day, and not on another", () => {
    expect(said(goDoneView())).toContain("Corner Bakehouse closes at 8pm today.");
    expect(said(goDoneView({}, { closesAt: null }))).not.toContain("closes at");
  });
});

describe("once having a go has closed", () => {
  const closed = (outcome: GoView["outcome"]) => goView({ stage: "closed", clues: [], nextUrl: null, closesAt: null, outcome });

  it("says so with no form, and where the elf was from Christmas Day until 1 January", () => {
    const doc = page(closed(goOutcome({ verdict: "none" })));
    expect(words(doc.querySelector("#elf-go-case-heading"))).toBe("Having a go closed on Christmas Day.");
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector(".elf-clue")).toBeNull();
    expect(words(doc.querySelector(".elf-go__verdict"))).toBe("Twinkle was hiding at Corner Bakehouse, Snowford.");
  });

  it("names no place from 1 January", () => {
    const html = renderGoPage(closed(null));
    expect(words(page(closed(null)).querySelector("#elf-go-case-heading"))).toBe("Having a go closed on Christmas Day.");
    expect(html).not.toContain("Corner Bakehouse");
    expect(page(closed(null)).querySelector("form")).toBeNull();
  });
});

describe("the words for how a go went", () => {
  const place = { name: "Corner Bakehouse", town: "Snowford" };
  const still = "Twinkle is hiding at Corner Bakehouse, Snowford, and nobody has found Twinkle yet. The first detective to type the word on its tag still wins the prize.";

  it("give the verdict, then where the elf was hiding", () => {
    expect(goOutcomeWords({ elfName: "Twinkle", verdict: "cracked", place, stillHiding: false })).toBe("You cracked it! Twinkle was hiding at Corner Bakehouse, Snowford.");
    expect(goOutcomeWords({ elfName: "Twinkle", verdict: "wrong", place, stillHiding: false })).toBe("Not this time. Twinkle was hiding at Corner Bakehouse, Snowford.");
    expect(goOutcomeWords({ elfName: "Twinkle", verdict: "none", place, stillHiding: false })).toBe("Twinkle was hiding at Corner Bakehouse, Snowford.");
  });

  it("say where the elf is, and that the prize is still to be won, while it is still hiding", () => {
    expect(goOutcomeWords({ elfName: "Twinkle", verdict: "cracked", place, stillHiding: true })).toBe(`You cracked it! ${still}`);
    expect(goOutcomeWords({ elfName: "Twinkle", verdict: "wrong", place, stillHiding: true })).toBe(`Not this time. ${still}`);
    expect(goOutcomeWords({ elfName: "Twinkle", verdict: "none", place, stillHiding: true })).toBe(still);
  });

  it("leave the town out for a place with none", () => {
    expect(goOutcomeWords({ elfName: "Twinkle", verdict: "wrong", place: { name: "Corner Bakehouse", town: "" }, stillHiding: false })).toBe("Not this time. Twinkle was hiding at Corner Bakehouse.");
  });
});
