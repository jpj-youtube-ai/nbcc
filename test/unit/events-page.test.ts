// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderEventsPage, DECK_MARKER } from "../../src/events/render";
import { SEED_EVENTS } from "./helpers/events-seed";

// TASK-453: the events page. A deck of playing cards: each event is a card with its picture and
// the gist on the front, and everything else on the back. Hover and it wobbles; click and it
// turns over.
//
// The things that must not quietly break:
//   - nothing ever scrolls inside a card (the client's standing rule for the whole site);
//   - without JavaScript every detail and every booking link is still on the page;
//   - a keyboard or screen reader user can turn a card over and back without losing their place;
//   - motion stays off for anyone who has asked their device for less of it;
//   - the deck is in date order, soonest first.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
// events.html is the TEMPLATE; the server fills its deck from the database. These tests run on the
// page as production will first serve it: the template with the two seeded events.
const template = readFileSync(resolve(ROOT, "events.html"), "utf8");
const html = renderEventsPage(template, SEED_EVENTS);
const css = readFileSync(resolve(ROOT, "assets/css/events.css"), "utf8");
const { initDeck } = require(resolve(ROOT, "assets/js/events.js"));

const parse = () => new DOMParser().parseFromString(html, "text/html");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the template", () => {
  // The cards come from the database, so the file itself must hold the marker and nothing else
  // in the deck: a card left in the template would sit on the page whatever staff did.
  it("holds exactly one deck marker and no cards of its own", () => {
    expect(template.split(DECK_MARKER)).toHaveLength(2);
    expect(template).not.toContain('class="ev-card');
  });
});

describe("the deck markup", () => {
  const doc = parse();
  const cards = [...doc.querySelectorAll(".deck > .ev-card")];

  it("is an ordered list of cards", () => {
    const deck = doc.querySelector("[data-deck]");
    expect(deck?.tagName).toBe("OL");
    // list-style:none drops list semantics in Safari unless the role is explicit.
    expect(deck?.getAttribute("role")).toBe("list");
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it("gives every card a front and a back", () => {
    for (const card of cards) {
      expect(card.querySelectorAll(":scope > .ev-card__inner > .ev-front"), card.id).toHaveLength(1);
      expect(card.querySelectorAll(":scope > .ev-card__inner > .ev-back"), card.id).toHaveLength(1);
    }
  });

  it("names both faces of every card by a heading that exists", () => {
    for (const face of doc.querySelectorAll(".ev-face")) {
      const id = face.getAttribute("aria-labelledby");
      expect(id, "a face with no name").toBeTruthy();
      expect(doc.getElementById(id!), `aria-labelledby="${id}" points nowhere`).not.toBeNull();
    }
  });

  // Where focus lands when a card turns over: without tabindex="-1" the heading cannot take it and
  // a keyboard user is dropped at the top of the page.
  it("lets every back's heading take focus", () => {
    for (const back of doc.querySelectorAll(".ev-back")) {
      expect(back.querySelector(".ev-title")?.getAttribute("tabindex"), back.id).toBe("-1");
    }
  });

  it("points every front's button at its own back", () => {
    for (const card of cards) {
      const target = card.querySelector(".ev-front .ev-turn")?.getAttribute("aria-controls");
      expect(target, card.id).toBe(card.querySelector(".ev-back")?.id);
    }
  });

  it("puts the events in date order, soonest first", () => {
    const dates = [...doc.querySelectorAll(".ev-back time[datetime]")].map((t) =>
      Date.parse(t.getAttribute("datetime")!),
    );
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it("always ends with the face down 'more on the way' card", () => {
    expect(cards[cards.length - 1].classList.contains("ev-card--more")).toBe(true);
  });

  it("gives every event on the deck a way to book", () => {
    for (const card of cards) {
      expect(card.querySelector(".ev-back a.ev-book")?.getAttribute("href"), card.id).toBeTruthy();
    }
  });

  // A link that opens a new tab says so, for the people who would otherwise be stranded in it.
  it("warns before any link opens a new tab, and never leaks the opener", () => {
    for (const a of doc.querySelectorAll("main a[target=_blank]")) {
      expect(a.getAttribute("rel"), a.getAttribute("href")!).toContain("noopener");
      expect(a.querySelector(".sr-only")?.textContent, a.getAttribute("href")!).toMatch(/new tab/);
    }
  });

  // The corner index repeats the date for the eye. Read aloud it would be said twice.
  it("hides the decorative corner index from screen readers", () => {
    for (const index of doc.querySelectorAll(".ev-index")) {
      expect(index.getAttribute("aria-hidden")).toBe("true");
    }
  });

  // The Code of Fundraising Practice, as guarded on the ball's own surfaces (TASK-313): card fees
  // mean "every penny" is not literally true, so the absolute wording must not creep in here.
  // The copy-rules test scans the template; the cards' words come from the database, so the seeded
  // ones are held to the same house style here: no hyphens between words, no en or em dashes.
  it("keeps the seeded cards in house style", () => {
    const d = parse();
    d.querySelectorAll("svg, script, style").forEach((el) => el.remove());
    const text = d.querySelector("[data-deck]")?.textContent ?? "";
    expect(text).not.toMatch(/[–—]/);
    expect(text.match(/\w-\w/g) ?? []).toEqual([]);
  });

  it("makes no absolute money claim", () => {
    const text = parse().body.textContent ?? "";
    for (const banned of [/every penny/i, /every pound/i, /100% of your ticket/i]) {
      expect(text).not.toMatch(banned);
    }
  });
});

describe("the stylesheet", () => {
  // THE rule. The client asked, for the whole site, that nothing ever scrolls inside a box.
  it("never scrolls inside a card", () => {
    expect(cssNoComments).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
  });

  // Both faces in the same grid cell: the card is as tall as its longer face, so the back can
  // hold as much as an event needs without a scrollbar.
  it("stacks the two faces in one grid cell once the flip is on", () => {
    expect(cssNoComments).toMatch(/\.deck--flip \.ev-face\s*\{[^}]*grid-area:\s*1 \/ 1/);
  });

  // Without JavaScript nothing turns, so a "See the full details" button would be a lie.
  it("shows the turn buttons only once the flip is switched on", () => {
    expect(cssNoComments).toMatch(/\.ev-turn\s*\{[^}]*display:\s*none/);
    expect(cssNoComments).toMatch(/\.deck--flip \.ev-turn\s*\{[^}]*display:\s*inline-flex/);
  });

  it("wobbles only on a mouse or trackpad, and only for people who have not asked for less motion", () => {
    const hoverBlock = cssNoComments.match(
      /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/,
    );
    expect(hoverBlock?.[0]).toContain("ev-wobble");
    // The animation is not referenced anywhere outside that block.
    const outside = cssNoComments.replace(hoverBlock![0], "");
    expect(outside).not.toMatch(/animation:\s*ev-wobble/);
  });

  it("turns the card over without spinning it for people who have asked for less motion", () => {
    const reduced = cssNoComments.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0];
    expect(reduced).toBeTruthy();
    expect(reduced).toMatch(/\.ev-card__inner\s*\{[^}]*transform:\s*none/);
    expect(reduced).toMatch(/visibility:\s*hidden/);
  });

  // No bounce or elastic curves: they overshoot, and draw the eye to the animation, not the card.
  it("uses no overshooting easing curves", () => {
    for (const m of cssNoComments.matchAll(/cubic-bezier\(([^)]+)\)/g)) {
      const [, y1, , y2] = m[1].split(",").map((n) => Number(n.trim()));
      expect(y1, m[0]).toBeGreaterThanOrEqual(0);
      expect(y1, m[0]).toBeLessThanOrEqual(1);
      expect(y2, m[0]).toBeGreaterThanOrEqual(0);
      expect(y2, m[0]).toBeLessThanOrEqual(1);
    }
  });
});

describe("turning a card over (events.js)", () => {
  let doc: Document;
  let card: HTMLElement;
  let front: HTMLElement;
  let back: HTMLElement;

  beforeEach(() => {
    document.documentElement.innerHTML = parse().documentElement.innerHTML;
    doc = document;
    initDeck(doc, window);
    card = doc.getElementById("festive-ball-2026")!;
    front = card.querySelector(".ev-front")!;
    back = card.querySelector(".ev-back")!;
  });

  it("switches the deck into its card form and shows the hint", () => {
    expect(doc.querySelector("[data-deck]")!.classList.contains("deck--flip")).toBe(true);
    expect((doc.querySelector("[data-deck-hint]") as HTMLElement).hidden).toBe(false);
  });

  it("starts every card face up, with the back out of reach", () => {
    expect(card.classList.contains("is-flipped")).toBe(false);
    expect(back.getAttribute("aria-hidden")).toBe("true");
    expect((back as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect((front as HTMLElement & { inert: boolean }).inert).toBe(false);
  });

  it("turns over from the front's button, and puts focus on the back's heading", () => {
    (front.querySelector(".ev-turn") as HTMLButtonElement).click();
    expect(card.classList.contains("is-flipped")).toBe(true);
    expect(front.getAttribute("aria-hidden")).toBe("true");
    expect(back.getAttribute("aria-hidden")).toBe("false");
    expect(doc.activeElement).toBe(back.querySelector(".ev-title"));
  });

  it("turns back from the back's button, and returns focus to the front's", () => {
    (front.querySelector(".ev-turn") as HTMLButtonElement).click();
    (back.querySelector(".ev-turn") as HTMLButtonElement).click();
    expect(card.classList.contains("is-flipped")).toBe(false);
    expect(doc.activeElement).toBe(front.querySelector(".ev-turn"));
  });

  it("turns over when you click anywhere on the card", () => {
    front.querySelector(".ev-tldr")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(card.classList.contains("is-flipped")).toBe(true);
  });

  it("turns back over on Escape", () => {
    (front.querySelector(".ev-turn") as HTMLButtonElement).click();
    back.querySelector(".ev-title")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card.classList.contains("is-flipped")).toBe(false);
    expect(doc.activeElement).toBe(front.querySelector(".ev-turn"));
  });

  it("lets a link on the back go where it says, without turning the card", () => {
    (front.querySelector(".ev-turn") as HTMLButtonElement).click();
    const link = back.querySelector("a.ev-book") as HTMLAnchorElement;
    link.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(card.classList.contains("is-flipped")).toBe(true);
  });

  // Someone selecting the address to copy it must not have the card whipped away from under them.
  it("does not turn when the click is the end of selecting some text", () => {
    const tldr = front.querySelector(".ev-tldr")!;
    const range = doc.createRange();
    range.selectNodeContents(tldr);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    tldr.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(card.classList.contains("is-flipped")).toBe(false);
    window.getSelection()!.removeAllRanges();
  });

  it("turns each card on its own", () => {
    (front.querySelector(".ev-turn") as HTMLButtonElement).click();
    expect(doc.getElementById("empowher-2026")!.classList.contains("is-flipped")).toBe(false);
  });
});
