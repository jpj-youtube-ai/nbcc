// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderFundraiserPage, NEWS_FIRST } from "../../src/fundraising/render";
import { meter, type PublicPage } from "../../src/fundraising/model";
import type { NewsEntry } from "../../src/fundraising/news";

// TASK-506: the countdown, the on the day banner and the News section on a fundraiser's page, drawn
// on the server so nothing flashes in after it loads. Every name and word here is invented.

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const PAGE_URL = "https://nbcc.test/fundraise/robins-santa-dash";
// Midday on 2 October 2026 in the UK (BST).
const NOW = new Date("2026-10-02T11:00:00Z");

const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  id: 41,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "A Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit for NBCC.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: 6000, cashPence: 0, targetPence: 25000 }),
  wall: [],
  giving: { fundraiserId: 41, minimumPence: 200 },
  ...over,
});

const draw = (p: PublicPage, now = NOW) => parse(renderFundraiserPage(template, p, { pageUrl: PAGE_URL, now }));

const news = (id: number, over: Partial<NewsEntry> = {}): NewsEntry => ({
  id,
  text: `Update number ${id}. We are getting there!`,
  createdAt: new Date(Date.UTC(2026, 8, 20 + id, 12)).toISOString(),
  photoSrc: null,
  ...over,
});

describe("the countdown", () => {
  it("says how many days to go while the date is still to come", () => {
    const doc = draw(page({ eventDate: "2026-10-14" }));
    const c = doc.querySelector(".fr-countdown");
    expect(c?.textContent?.replace(/\s+/g, " ").trim()).toBe("12 days to go");
    expect(doc.querySelector(".fr-today")).toBeNull();
  });

  it("says Tomorrow! the day before", () => {
    const doc = draw(page({ eventDate: "2026-10-03" }));
    expect(doc.querySelector(".fr-countdown")?.textContent?.trim()).toBe("Tomorrow!");
  });

  it("sits in the intro, under the date, so it is there as the page opens", () => {
    const doc = draw(page({ eventDate: "2026-10-14" }));
    const intro = doc.querySelector(".fr-intro");
    expect(intro?.querySelector(".fr-facts + .fr-countdown")).not.toBeNull();
  });

  it("is not there with no date, after the date, or once the fundraiser is finished", () => {
    expect(draw(page()).querySelector(".fr-countdown, .fr-today")).toBeNull();
    expect(draw(page({ eventDate: "2026-10-01" })).querySelector(".fr-countdown, .fr-today")).toBeNull();
    expect(draw(page({ eventDate: "2026-10-14", finished: true })).querySelector(".fr-countdown, .fr-today")).toBeNull();
    expect(draw(page({ eventDate: "2026-10-02", finished: true })).querySelector(".fr-countdown, .fr-today")).toBeNull();
  });
});

describe("on the day", () => {
  it("wishes the organiser luck by their first name, with the page's share links", () => {
    const doc = draw(page({ eventDate: "2026-10-02" }));
    const banner = doc.querySelector(".fr-today");
    expect(banner).not.toBeNull();
    expect(banner?.querySelector("h2")?.textContent).toBe("Today's the day! Good luck, Robin!");
    expect(banner?.hasAttribute("data-copy-scope")).toBe(true);
    expect(banner?.querySelector("[data-copy-link]")?.getAttribute("data-copy-link")).toBe(PAGE_URL);
    expect(banner?.querySelector(".fr-share__facebook")?.getAttribute("href")).toContain(encodeURIComponent(PAGE_URL));
    expect(banner?.querySelector(".fr-share__whatsapp")).not.toBeNull();
    expect(banner?.querySelector("[data-copy-status]")).not.toBeNull();
    expect(doc.querySelector(".fr-countdown")).toBeNull();
  });

  it("is the day all day long in the UK, late at night included", () => {
    // 23:30 on 1 October in UTC is 00:30 on 2 October in the UK.
    expect(draw(page({ eventDate: "2026-10-02" }), new Date("2026-10-01T23:30:00Z")).querySelector(".fr-today")).not.toBeNull();
  });

  it("leaves the name out rather than show one that is not a plain first name", () => {
    for (const organisedBy of ["<b>Robin</b> Q.", "R0bin Q.", "Anonymous"]) {
      const h = draw(page({ eventDate: "2026-10-02", organisedBy })).querySelector(".fr-today h2");
      expect(h?.textContent).toBe("Today's the day! Good luck!");
      expect(h?.innerHTML).not.toContain("<b>");
    }
  });
});

describe("the News section", () => {
  it("is not there without an approved update", () => {
    expect(draw(page()).querySelector(".fr-news")).toBeNull();
    expect(draw(page({ news: [] })).querySelector(".fr-news")).toBeNull();
  });

  it("shows each update in the order given (newest first), with its date", () => {
    const doc = draw(page({ news: [news(3), news(2)] }));
    const section = doc.querySelector("section.fr-news");
    expect(section?.querySelector("h2")?.textContent).toBe("News");
    const items = Array.from(section?.querySelectorAll(".fr-news__item") ?? []);
    expect(items.map((i) => i.querySelector(".fr-news__text")?.textContent)).toEqual([news(3).text, news(2).text]);
    const time = items[0].querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(news(3).createdAt);
    expect(time?.textContent).toBe("23 September 2026");
  });

  it("comes after the story, before the give form", () => {
    const doc = draw(page({ news: [news(1)] }));
    expect(doc.querySelector(".fr-story + .fr-news + .fr-give")).not.toBeNull();
  });

  it("escapes what the organiser wrote, and keeps their line breaks", () => {
    const doc = draw(page({ news: [news(1, { text: '<img src=x onerror="alert(1)">Line one\nLine two' })] }));
    const text = doc.querySelector(".fr-news__text");
    expect(text?.querySelector("img")).toBeNull();
    expect(text?.innerHTML).toContain("&lt;img");
    expect(text?.querySelectorAll("br").length).toBe(1);
  });

  it("puts a photo in a modest cropped frame, never across the page, with words from the update for its alt", () => {
    const src = "/media/fundraiser-news/0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
    const doc = draw(page({ news: [news(1, { photoSrc: src, text: "We reached the top of the hill in the snow, every one of us in a red suit." })] }));
    const figure = doc.querySelector(".fr-news__item .fr-news__photo");
    const img = figure?.querySelector("img");
    expect(img?.getAttribute("src")).toBe(src);
    expect(img?.getAttribute("alt")).toBe("A photo with the update: We reached the top of the hill in the snow, every one of us in a red suit.");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("width")).toBe("400");
    expect(img?.getAttribute("height")).toBe("300");
    // Not the full width photo the page has at the top.
    expect(figure?.classList.contains("fr-photo")).toBe(false);
  });

  it("shortens a long update for the photo's alt", () => {
    const long = "word ".repeat(100).trim();
    const alt = draw(page({ news: [news(1, { photoSrc: "/media/fundraiser-news/x", text: long })] }))
      .querySelector(".fr-news__photo img")
      ?.getAttribute("alt");
    expect(alt && alt.length).toBeLessThan(160);
    expect(alt?.endsWith("…")).toBe(true);
  });

  it("shows the first few, then Show all, so the page grows rather than a box scrolling", () => {
    const many = Array.from({ length: NEWS_FIRST + 2 }, (_, i) => news(10 - i));
    const doc = draw(page({ news: many }));
    const items = Array.from(doc.querySelectorAll(".fr-news__item"));
    expect(items.length).toBe(NEWS_FIRST + 2);
    expect(items.filter((i) => i.hasAttribute("data-news-more")).length).toBe(2);
    const more = doc.querySelector("[data-news-show-all]") as HTMLButtonElement | null;
    expect(more?.textContent).toBe(`Show all ${NEWS_FIRST + 2} updates`);
    expect(more?.hidden).toBe(true);
    expect(draw(page({ news: many.slice(0, NEWS_FIRST) })).querySelector("[data-news-show-all]")).toBeNull();
  });
});

describe("the words", () => {
  it("have no dashes, on the day or counting down, with news", () => {
    for (const eventDate of ["2026-10-02", "2026-10-03", "2026-10-20"]) {
      const doc = draw(page({ eventDate, news: [news(1, { text: "Thank you all", photoSrc: "/media/fundraiser-news/x" })] }));
      const words = ["fr-countdown", "fr-today", "fr-news"]
        .map((c) => doc.querySelector(`.${c}`)?.textContent ?? "")
        .join(" ");
      expect(words).not.toMatch(/\w-\w|[–—]/);
    }
  });
});
