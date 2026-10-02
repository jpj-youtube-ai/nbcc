// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiserPage, NEWS_FIRST } from "../../src/fundraising/render";
import { meter, type PublicPage } from "../../src/fundraising/model";
import type { NewsEntry } from "../../src/fundraising/news";

// TASK-506: a fundraiser's page in the browser: the News section shows the newest few, then Show all
// grows the page; and on the day, the banner's own Copy the link button says so beside itself.
// Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initNews, initShare } = require(resolve(ROOT, "assets/js/fundraiser.js"));
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");

const news = (i: number): NewsEntry => ({ id: i, text: `Update ${i}`, createdAt: new Date(Date.UTC(2026, 9, 1) - i * 86_400_000).toISOString(), photoSrc: null });
const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  id: 41,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "A Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
  wall: [],
  giving: { fundraiserId: 41, minimumPence: 200 },
  ...over,
});

function load(p: PublicPage, now = new Date("2026-10-02T11:00:00Z")) {
  const html = renderFundraiserPage(template, p, { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now });
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the News section", () => {
  it("shows the newest few, and Show all grows the page with the rest", () => {
    load(page({ news: Array.from({ length: NEWS_FIRST + 2 }, (_, i) => news(i)) }));
    initNews(document);
    const items = [...document.querySelectorAll<HTMLElement>(".fr-news__item")];
    expect(items.filter((i) => !i.hidden)).toHaveLength(NEWS_FIRST);
    const more = document.querySelector<HTMLButtonElement>("[data-news-show-all]")!;
    expect(more.hidden).toBe(false);
    more.click();
    expect(items.filter((i) => !i.hidden)).toHaveLength(NEWS_FIRST + 2);
    expect(more.hidden).toBe(true);
    expect(document.activeElement).toBe(items[NEWS_FIRST]);
  });

  it("does nothing with only a few, or none", () => {
    load(page({ news: [news(1)] }));
    expect(initNews(document)).toBeNull();
    load(page());
    expect(initNews(document)).toBeNull();
  });
});

describe("on the day", () => {
  it("has a copy button of its own, which says it has copied beside itself", async () => {
    load(page({ eventDate: "2026-10-02" }));
    const writeText = vi.fn(() => Promise.resolve());
    initShare(document, { navigator: { clipboard: { writeText } } });
    const banner = document.querySelector(".fr-today")!;
    const btn = banner.querySelector<HTMLButtonElement>("[data-copy-link]")!;
    expect(btn.hidden).toBe(false);
    btn.click();
    await flush();
    expect(banner.querySelector("[data-copy-status]")!.textContent).toBe("Link copied. You can paste it anywhere.");
    expect(document.querySelector(".fr-share [data-copy-status]")!.textContent).toBe("");
  });
});
