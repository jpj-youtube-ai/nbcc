// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHqPage } from "../../src/elf/pages/hq";
import type { HqView, TodayView } from "../../src/elf/pages/types";
import { at, hqView } from "./elf-fixtures";

// NBCC Elf Detective School: Detective HQ, a family's own page. Every family, detective and
// business here is invented (see elf-fixtures.ts).

const page = (v: HqView = hqView()) => new DOMParser().parseFromString(renderHqPage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const today = (over: Partial<TodayView>): HqView => hqView({ today: { ...hqView().today!, ...over } });

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

  it("links back to the calendar", () => {
    expect(page().querySelector('.nav-cta[href="/elf"]')).not.toBeNull();
  });
});

describe("today's case", () => {
  it("counts down to the clue before it is out, and shows no clue and no guess", () => {
    const doc = page(today({ state: "shut", clueAt: at("2026-12-07T19:00:00.000Z"), clue: "A clue that must not show yet" }));
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("Door 7");
    expect(words(card)).toContain("Clue out at 7pm");
    expect(card.querySelector(".elf-cd")!.getAttribute("data-until")).toBe("2026-12-07T19:00:00.000Z");
    expect(card.querySelector(".elf-cd")!.textContent).toBe("1:20:00");
    expect(doc.documentElement.outerHTML).not.toContain("must not show yet");
    expect(doc.querySelector("form")).toBeNull();
  });

  it("shows the clue once it is out, keeping its lines", () => {
    const clue = page().querySelector(".elf-clue")!;
    expect(words(clue)).toBe("I am hiding where stories sleep on shelves. Look up, not down!");
    expect(clue.querySelectorAll("br").length).toBe(1);
  });

  it("offers the places still in play as one choice, with a button to lock it in", () => {
    const form = page().querySelector<HTMLFormElement>("form.elf-guess")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/elf/hq/guess");
    expect(form.getAttribute("data-api")).toBe("/api/elf/guess");
    expect(form.querySelector<HTMLInputElement>('input[name="door"]')!.value).toBe("7");
    const radios = [...form.querySelectorAll<HTMLInputElement>('input[type="radio"][name="placeId"]')];
    expect(radios.map((r) => r.value)).toEqual(["p-toys", "p-books", "p-bakery"]);
    expect(radios.map((r) => words(form.querySelector(`label[for="${r.id}"]`)))).toEqual([
      "The Toy Shop, Troon",
      "The Bookshop, Ayr",
      "The Corner Bakery, Kilmarnock",
    ]);
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(radios[0].required).toBe(true);
    expect(words(form.querySelector("button"))).toBe("Lock in my guess");
    expect(form.querySelector("fieldset legend")).not.toBeNull();
  });

  it("shows the family's guess, and says it can still be changed", () => {
    const doc = page(today({ guess: { id: "p-books", name: "The Bookshop", town: "Ayr" } }));
    const form = doc.querySelector("form.elf-guess")!;
    expect(form.querySelector<HTMLInputElement>('input[value="p-books"]')!.checked).toBe(true);
    expect(words(form.querySelector(".elf-guess__status"))).toBe(
      "Your guess: The Bookshop, Ayr. You can change it until the elf is found.",
    );
    expect(words(form.querySelector("button"))).toBe("Change my guess");
  });

  it("says the family cracked the case once the door is open", () => {
    const doc = page(
      today({
        state: "found",
        options: [],
        guess: { id: "p-books", name: "The Bookshop", town: "Ayr" },
        outcome: { place: "The Bookshop, Ayr", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: true },
      }),
    );
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("You cracked it!");
    expect(words(card)).toContain("Bauble was hiding at The Bookshop, Ayr");
    expect(words(card)).toContain("Found first by Detective Orla Snowsleuth at 5:47pm");
    expect(doc.querySelector("form")).toBeNull();
  });

  it("is kind about a wrong guess, and about no guess at all", () => {
    const outcome = { place: "The Toy Shop, Troon", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: false };
    const wrong = page(today({ state: "found", options: [], guess: { id: "p-books", name: "The Bookshop", town: "Ayr" }, outcome }));
    expect(words(wrong.querySelector(".elf-case"))).toContain("Your guess was The Bookshop, Ayr. Not this time");
    const none = page(today({ state: "found", options: [], guess: null, outcome }));
    expect(words(none.querySelector(".elf-case"))).toContain("You did not lock in a guess for this one");
    expect(words(none.querySelector(".elf-case"))).not.toContain("You cracked it");
  });

  it("says a revealed elf is still there to be won", () => {
    const doc = page(
      today({ state: "revealed", options: [], guess: null, outcome: { place: "The Toy Shop, Troon", by: null, at: null, cracked: false } }),
    );
    const card = doc.querySelector(".elf-case")!;
    expect(words(card)).toContain("Bauble is still waiting at The Toy Shop, Troon");
    expect(words(card)).toContain("first detective");
    expect(words(card)).not.toContain("Found first by");
  });

  it("looks ahead to the next clue on a day with no door, and counts the sleeps", () => {
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
});

describe("data that is not what it should be", () => {
  it("still draws the page when today's clue time is not a real date", () => {
    const view = today({ state: "shut", clueAt: new Date("not a date"), clue: null, options: [] });
    const card = page(view).querySelector(".elf-case")!;
    expect(words(card.querySelector("h2"))).toBe("Today's clue is on its way");
    expect(card.querySelector(".elf-cd")).toBeNull();
    expect(() => renderHqPage(hqView({ now: new Date("nonsense") }))).not.toThrow();
    expect(() => renderHqPage({ ...view, now: new Date("nonsense") })).not.toThrow();
  });

  it("offers no empty form when there is nothing left to guess", () => {
    const doc = page(today({ options: [] }));
    expect(doc.querySelector("form.elf-guess")).toBeNull();
    expect(words(doc.querySelector(".elf-case"))).toContain("nothing left to guess");
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
});

describe("what comes from data", () => {
  it("is escaped wherever it is shown", () => {
    const view = hqView({ familyName: "<b>Sam</b>" });
    view.detectives[0] = { ...view.detectives[0], name: '<img src=x onerror="alert(1)">', badgeNumber: "<i>1</i>" };
    view.today = { ...view.today!, clue: "<script>alert(1)</script>", elfName: "<u>Elf</u>", options: [{ id: '"><script>', name: "<b>Shop</b>", town: "<i>Ayr</i>" }] };
    const doc = page(view);
    expect(doc.querySelector("script:not([src])")).toBeNull();
    expect(doc.querySelector("main u, main i, [onerror]")).toBeNull();
    expect([...doc.querySelectorAll("main b")].map((b) => b.textContent)).not.toContain("Sam");
    // The two elves' pictures, and only the page's own painted decorations besides.
    expect(doc.querySelectorAll("main img:not(.elf-deco)").length).toBe(2);
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
      today({ state: "shut", clue: null, options: [] }),
      today({ state: "found", outcome: { place: "The Toy Shop, Troon", by: "Detective Orla Snowsleuth", at: at("2026-12-07T17:47:00.000Z"), cracked: true } }),
      hqView({ today: null }),
    ];
    for (const v of states) {
      const card = page(v).querySelector(".elf-case")!;
      expect(card.classList.contains("elf-note")).toBe(true);
      expect(card.querySelector(":scope > .elf-tape")!.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("counts down on the candy cane strip, to the clue and to the next day's", () => {
    expect(page(today({ state: "shut", clue: null, options: [] })).querySelector(".elf-case .elf-cane-strip .elf-cd")).not.toBeNull();
    expect(words(page(hqView({ today: null })).querySelector(".elf-case .elf-cane-strip"))).toBe("1 sleep to go");
  });

  it("locks in a guess with a crimson torn paper button, and uses none of the site's own buttons", () => {
    const doc = page(hqView({ addDetectiveUrl: "/elf/join" }));
    expect(doc.querySelector('form.elf-guess button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(doc.querySelector(".site-main .btn")).toBeNull();
    expect(doc.querySelector('.elf-add-detective a[href="/elf/join"]')!.className).toBe("elf-btn");
    expect(doc.querySelector('.elf-hq-marks a[href="/elf"]')!.className).toBe("elf-btn");
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
