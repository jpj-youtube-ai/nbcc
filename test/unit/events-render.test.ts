// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  renderCard,
  renderMoreCard,
  renderDeck,
  renderEventsPage,
  renderPreviewDocument,
  DECK_MARKER,
  timeText,
} from "../../src/events/render";
import { SEED_EVENTS, seedWith } from "./helpers/events-seed";

// TASK-453: one renderer for the public page AND the admin's previews, so what staff see while
// building an event is exactly what the public will get. The markup is the approved prototype's:
// these tests pin the classes events.css and events.js depend on.

const fragment = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content;
};

const ball = () => fragment(renderCard(seedWith("festive-ball-2026", {})));
const empowher = () => fragment(renderCard(seedWith("empowher-2026", {})));

describe("a card", () => {
  it("has a front and a back that name themselves", () => {
    const card = ball().querySelector("li.ev-card#festive-ball-2026")!;
    expect(card).not.toBeNull();
    const front = card.querySelector(".ev-card__inner > .ev-front")!;
    const back = card.querySelector(".ev-card__inner > .ev-back#festive-ball-2026-back")!;
    expect(front.getAttribute("aria-labelledby")).toBe("festive-ball-2026-title");
    expect(back.getAttribute("aria-labelledby")).toBe("festive-ball-2026-back-title");
    expect(card.querySelector("#festive-ball-2026-title")?.textContent).toBe("Festive Ball 2026");
    // Where focus goes when the card turns over.
    expect(card.querySelector("#festive-ball-2026-back-title")?.getAttribute("tabindex")).toBe("-1");
    expect(front.querySelector(".ev-turn")?.getAttribute("aria-controls")).toBe("festive-ball-2026-back");
  });

  it("puts the date in the corner, hidden from screen readers because it is said in full below", () => {
    const index = ball().querySelector(".ev-front .ev-index")!;
    expect(index.getAttribute("aria-hidden")).toBe("true");
    expect(index.textContent).toBe("Sat7Nov");
  });

  it("shows a poster whole on its night sky, clear of the date", () => {
    const art = ball().querySelector(".ev-front .ev-art")!;
    expect(art.classList.contains("ev-art--whole")).toBe(true);
    expect(art.classList.contains("ev-art--night")).toBe(true);
    const img = art.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/assets/img/ball-lockup.svg");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("makes its own cover from the name when there is no picture, keeping the year in one piece", () => {
    const art = fragment(renderCard(seedWith("empowher-2026", { imageSrc: null }))).querySelector(".ev-front .ev-art")!;
    expect(art.classList.contains("ev-art--type")).toBe(true);
    expect(art.classList.contains("ev-art--holly")).toBe(true);
    expect(art.getAttribute("aria-hidden")).toBe("true");
    expect(art.querySelector(".ev-art__name")?.innerHTML).toBe("EmpowHer<span>’26</span>");
    expect(art.querySelector(".ev-art__place")?.textContent).toBe("AD Autocare · Heathfield");
  });

  it("does not say the town twice on the cover", () => {
    const html = renderCard(seedWith("empowher-2026", { imageSrc: null, venue: "Annbank Village Hall", town: "Annbank" }));
    expect(fragment(html).querySelector(".ev-art__place")?.textContent).toBe("Annbank Village Hall");
  });

  it("gives the front the gist and the three facts", () => {
    const front = empowher().querySelector(".ev-front")!;
    expect(front.querySelector(".ev-host")?.textContent).toBe("Organised by AD Autocare");
    expect(front.querySelector(".ev-flag")?.textContent).toBe("Spaces limited");
    expect(front.querySelector(".ev-tldr")?.textContent).toMatch(/^A free evening of car care/);
    const facts = [...front.querySelectorAll(".ev-facts li")].map((li) => li.textContent);
    expect(facts).toEqual([
      "When: Wed 4 Nov, 6pm to 10pm",
      "Where: AD Autocare, Heathfield, Ayr",
      "Cost: Free, but please book",
    ]);
  });

  it("gives the back the full date, the list, and the organiser in a band of their own", () => {
    const back = ball().querySelector(".ev-back")!;
    expect(back.querySelector(".ev-host")?.textContent).toBe("A Night to Remember");
    const when = back.querySelector(".ev-facts li")!;
    expect(when.textContent).toBe("When: Saturday 7 November 2026, from 7pm (to be confirmed)");
    expect(when.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-07T19:00");
    expect(back.querySelector(".ev-label")?.textContent).toBe("On the night");
    expect(back.querySelectorAll(".ev-list li")).toHaveLength(4);
    expect(back.querySelector(".ev-list li")?.innerHTML).toBe("<b>Michelle McManus</b>, your host for the evening");
    const band = back.querySelector(".ev-organiser")!;
    expect(band.querySelector(".ev-organiser__by")?.textContent?.trim()).toBe("Organised and sponsored by");
    expect(band.querySelector("img")?.getAttribute("alt")).toBe("The Designer Rooms");
    expect(back.querySelector("a.ev-book")?.getAttribute("href")).toBe("/ball#tickets");
  });

  it("names the organiser in words when there is no logo", () => {
    const by = empowher().querySelector(".ev-organiser__by")!;
    expect(by.querySelector("b")?.textContent).toBe("AD Autocare");
  });

  it("says when booking happens on someone else's website, and opens it in a new tab", () => {
    const back = empowher().querySelector(".ev-back")!;
    const link = back.querySelector("a.ev-book")!;
    expect(link.classList.contains("ev-book--away")).toBe(true);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener");
    expect(link.querySelector(".sr-only")?.textContent).toMatch(/new tab/);
    expect(back.querySelector(".ev-book-note")?.textContent).toBe("Booking is on the AD Autocare website.");
  });

  it("says so plainly when there is nothing to book", () => {
    const back = fragment(renderCard(seedWith("festive-ball-2026", { bookingHow: "none", bookingUrl: "" })));
    expect(back.querySelector("a.ev-book")).toBeNull();
    expect(back.querySelector(".ev-book-note")?.textContent).toBe("No need to book. Just come along.");
  });

  it("lists access in a sentence", () => {
    const html = renderCard(seedWith("festive-ball-2026", { access: ["step free entry", "accessible toilets", "a hearing loop"] }));
    expect(html).toContain("<b>Access:</b> step free entry, accessible toilets and a hearing loop.");
  });

  it("leaves out what is empty rather than printing a gap", () => {
    const html = renderCard(seedWith("festive-ball-2026", { flag: "", note: "", whatsOn: "", costFront: "", costBack: "", runBy: "nbcc" }));
    const f = fragment(html);
    expect(f.querySelector(".ev-flag")).toBeNull();
    expect(f.querySelector(".ev-list")).toBeNull();
    expect(f.querySelector(".ev-label")).toBeNull();
    expect(f.querySelector(".ev-organiser")).toBeNull();
    expect(f.querySelectorAll(".ev-front .ev-facts li")).toHaveLength(2);
    expect(f.querySelector(".ev-front .ev-host")?.textContent).toBe("Run by NBCC");
  });

  // Everything a volunteer types is text, never markup - including in the card's attributes.
  it("escapes everything staff type", () => {
    const html = renderCard(
      seedWith("festive-ball-2026", {
        name: '<script>alert("x")</script>',
        gist: "Tom & Jerry's <b>night</b>",
        imageAlt: '" onerror="alert(1)',
        whatsOn: "*<img src=x onerror=alert(1)>*",
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('" onerror="');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tom &amp; Jerry&#39;s &lt;b&gt;night&lt;/b&gt;");
    expect(html).toContain("<b>&lt;img src=x onerror=alert(1)&gt;</b>");
  });
});

describe("the time, in words", () => {
  const ev = (start: string | null, end: string | null, timeTbc = false) =>
    seedWith("festive-ball-2026", { start, end, timeTbc });
  it("reads a start and a finish as a range", () => {
    expect(timeText(ev("18:00", "22:00"), false)).toBe("6pm to 10pm");
  });
  it("reads a start alone as 'from', with minutes after a dot", () => {
    expect(timeText(ev("19:30", null), false)).toBe("from 7.30pm");
  });
  it("says midday the way people do", () => {
    expect(timeText(ev("12:00", null), false)).toBe("from 12 noon");
  });
  it("adds 'to be confirmed' on the back only", () => {
    expect(timeText(ev("19:00", null, true), false)).toBe("from 7pm");
    expect(timeText(ev("19:00", null, true), true)).toBe("from 7pm (to be confirmed)");
  });
  it("is empty with no time, unless the time is still to come", () => {
    expect(timeText(ev(null, null), true)).toBe("");
    expect(timeText(ev(null, null, true), true)).toBe("time to be confirmed");
  });
});

describe("the deck", () => {
  it("always ends with the face down card, and is only that when nothing is on", () => {
    expect(fragment(renderDeck([])).querySelectorAll(".ev-card")).toHaveLength(1);
    const deck = fragment(renderDeck(SEED_EVENTS));
    // The fragment's own children: ":scope" never matches a fragment, only an element.
    const cards = [...deck.children].filter((c) => c.classList.contains("ev-card"));
    expect(cards.map((c) => c.id)).toEqual(["empowher-2026", "festive-ball-2026", "more-events"]);
    expect(cards[2].classList.contains("ev-card--more")).toBe(true);
  });

  it("gives the face down card the elf and the invitation on its back", () => {
    const more = fragment(renderMoreCard());
    expect(more.querySelector(".ev-cardback__elf")?.getAttribute("src")).toBe("/assets/img/nbcc-elf.png");
    expect(more.querySelector(".ev-back a.ev-book")?.getAttribute("href")).toBe("/contact");
  });

  it("can prefix every id, so a preview inside the admin never clashes with the page's own", () => {
    const html = renderCard(seedWith("empowher-2026", {}), "preview-");
    expect(html).toContain('id="preview-empowher-2026"');
    expect(html).toContain('aria-controls="preview-empowher-2026-back"');
    expect(html).not.toMatch(/id="empowher-2026/);
  });
});

describe("filling the page", () => {
  it("puts the deck where the marker is and changes nothing else", () => {
    const template = `<main><ol class="deck">${DECK_MARKER}</ol></main>`;
    const out = renderEventsPage(template, SEED_EVENTS);
    expect(out.startsWith('<main><ol class="deck"><li class="ev-card" id="empowher-2026"')).toBe(true);
    expect(out.endsWith("</li></ol></main>")).toBe(true);
    expect(out).not.toContain(DECK_MARKER);
  });

  it("leaves a template without the marker alone", () => {
    expect(renderEventsPage("<main></main>", SEED_EVENTS)).toBe("<main></main>");
  });
});

describe("the admin preview document", () => {
  it("is a whole page that loads the site's own styles and card script", () => {
    const doc = renderPreviewDocument(renderDeck(SEED_EVENTS));
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain('href="/assets/css/styles.css"');
    expect(doc).toContain('href="/assets/css/events.css"');
    expect(doc).toContain('src="/assets/js/events.js"');
    expect(doc).toContain('class="deck" role="list" data-deck');
  });
});
