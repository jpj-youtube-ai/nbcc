// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderNewGetInvolvedPage } from "../../src/fundraising/get-involved-page";
import { renderWhatsOnPage, type GetInvolvedInput } from "../../src/fundraising/render";
import { meter, type PublicCard } from "../../src/fundraising/model";
import { SEED_EVENTS, seedWith } from "./helpers/events-seed";

// The new Get involved: what you can do for NBCC, fundraising first. What's on has the full list of
// events and fundraisers; this page shows the first six of the very same cards. Every name here is
// invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initChips } = require(resolve(ROOT, "assets/js/events.js"));
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const template = read("get-involved.html");
const whatsOnTemplate = read("whats-on.html");
const TODAY = "2026-10-02";

const fundraiser = (n: number): PublicCard => ({
  id: 100 + n,
  slug: `example-walk-${n}`,
  path: "raising",
  kind: "run_walk",
  kindLabel: "A run or walk",
  title: `Example Walk ${n}`,
  description: "Ten miles for NBCC.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Jo Example",
  url: `/fundraise/example-walk-${n}`,
  meter: meter({ onlinePence: 1000, cashPence: 0, targetPence: 10000 }),
});
const fundraisers = (count: number) => Array.from({ length: count }, (_, i) => fundraiser(i + 1));

const input = (over: Partial<GetInvolvedInput> = {}): GetInvolvedInput => ({
  events: SEED_EVENTS,
  fundraisers: fundraisers(2),
  fundraisingOn: true,
  today: TODAY,
  ...over,
});
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const page = (over: Partial<GetInvolvedInput> & { fillStage?: string } = {}) => renderNewGetInvolvedPage(template, { ...input(over), fillStage: over.fillStage });
const doc = (over: Partial<GetInvolvedInput> = {}) => parse(page(over));
const cards = (d: Document) => [...d.querySelectorAll<HTMLElement>(".deck > .ev-card")];
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The page's sections in order, by what each one starts with. */
function order(d: Document): string[] {
  return [...d.querySelector("main")!.children].map((s) => s.id || s.className);
}

describe("the order of the page", () => {
  it("runs top, Fundraise, What's on, together, more ways, stay close", () => {
    const html = page();
    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const steps = [
      "What can",
      "7,657",
      "Raise money your way, and we will help.",
      "Upcoming events and fundraisers",
      "Coming as a business, school or group?",
      "More ways to help",
      "Not ready yet? Stay close.",
      "Together, we make sure nobody is forgotten",
    ].map(at);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("leads with the Fundraise section straight after the top", () => {
    const list = order(doc());
    expect(list[0]).toContain("band-hub");
    expect(list[1]).toBe("fundraise");
    expect(list[2]).toBe("whats-on");
  });

  it("does not show the four ways, the gift tags", () => {
    const d = doc();
    expect(d.querySelector(".gift")).toBeNull();
    expect(d.querySelector(".gifts")).toBeNull();
    expect(page()).not.toContain("Where would you like to start?");
  });

  it("has one main heading, which asks the question", () => {
    const d = doc();
    expect(d.querySelectorAll("h1")).toHaveLength(1);
    expect(text(d.querySelector("h1"))).toBe("What canI do?");
  });
});

describe("the top", () => {
  it("has the 7,657 line in the charity's own words", () => {
    expect(text(doc().querySelector(".proof"))).toBe(
      "Last Christmas, 7,657 children, young people and vulnerable adults woke up to a Red Bag Full of Joy. None of it happens without people like you.",
    );
  });

  it("has the photo, its size set and its words said", () => {
    const img = doc().querySelector(".hub-snap img")!;
    expect(img.getAttribute("src")).toBe("/assets/img/home-red-bags-handover.jpg");
    expect(img.getAttribute("alt")!.length).toBeGreaterThan(20);
    expect(img.getAttribute("width")).toBe("1400");
    expect(img.getAttribute("height")).toBe("732");
  });

  it("leaves out Who we are, in one minute: that film has no captions yet", () => {
    expect(page()).not.toContain("Who we are");
    expect(page()).not.toContain("vid-about");
    expect(doc().querySelector("#watchBtn")).toBeNull();
  });

  it("is on the site's own cream menu bar, so the menu can be read over the maroon", () => {
    expect(doc().body.classList.contains("page-hub")).toBe(true);
  });
});

describe("the Fundraise section", () => {
  const section = doc().querySelector("#fundraise")!;

  it("has the live wording", () => {
    expect(text(section.querySelector("h2"))).toBe("Raise money your way, and we will help.");
    expect(text(section.querySelector(".fund-lede"))).toBe("A sponsored walk, a bake sale, a quiz night or a birthday. Tell us your plans and we will be in touch.");
  });

  it("has the four points, the event one pointing to What's on", () => {
    expect([...section.querySelectorAll(".fund-list li")].map(text)).toEqual([
      "Your own page with a meter and a QR code, if you are raising money",
      "Your event on our What’s on page, if you would like it shown",
      "Posters, leaflets and a collection bucket or tin",
      "A shout out on our social media",
    ]);
  });

  it("has the way in, and the way back for someone already fundraising", () => {
    expect(text(section.querySelector('a[href="/fundraise"]'))).toBe("Fundraise for us");
    expect(text(section.querySelector('a[href="/fundraise/manage"]'))).toBe("Already fundraising? Change your page");
  });
});

describe("the film", () => {
  const html = page();
  const d = parse(html);

  it("is one film, in the Fundraise section", () => {
    expect(d.querySelectorAll("video")).toHaveLength(1);
    expect(d.querySelectorAll("[data-film]")).toHaveLength(1);
    expect(d.querySelector("#fundraise [data-film]")).not.toBeNull();
  });

  it("is the live film, with its captions", () => {
    expect(d.querySelector("video source")?.getAttribute("src")).toBe("/assets/video/get-involved-film.mp4");
    expect(d.querySelector("video track")?.getAttribute("src")).toBe("/assets/video/get-involved-film.en.vtt");
    expect(d.querySelector("video track")?.getAttribute("kind")).toBe("captions");
    expect(d.querySelector("video track")?.hasAttribute("default")).toBe(true);
  });

  it("decides a first visit from a later one in the head, before the page is drawn", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain("nbcc-film-seen");
    expect(head).toContain("film-first");
    expect(head.indexOf("nbcc-film-seen")).toBeLessThan(head.indexOf("/assets/css/styles.css"));
  });

  it("is run by the script that runs it", () => {
    expect(d.querySelector('script[src="/assets/js/events.js"]')).not.toBeNull();
    expect(d.querySelector("[data-film-sound]")).not.toBeNull();
    expect(d.querySelector("[data-film-open]")).not.toBeNull();
  });

  it("has the words under it, and the hand written line", () => {
    expect(d.querySelector("#fundraise .gi-film__words")).not.toBeNull();
    expect(text(d.querySelector("#fundraise .gi-film__caption"))).toBe("Got an idea? Let’s make it happen.");
  });

  it("is not in the template: the server adds it", () => {
    expect(template).not.toContain("<video");
    expect(template).not.toContain("<script>");
    expect(template.split("<!-- getinvolved:film-head -->")).toHaveLength(2);
  });
});

describe("What's on, on this page", () => {
  it("shows the first six cards, in the order What's on has them", () => {
    const over = { fundraisers: fundraisers(9) };
    const here = cards(doc(over)).map((c) => c.id);
    const there = cards(parse(renderWhatsOnPage(whatsOnTemplate, input(over)))).map((c) => c.id);
    expect(here).toHaveLength(6);
    expect(here).toEqual(there.slice(0, 6));
  });

  it("draws each card exactly as What's on does", () => {
    const here = cards(doc());
    const there = cards(parse(renderWhatsOnPage(whatsOnTemplate, input())));
    expect(here.length).toBeGreaterThan(2);
    here.forEach((card, i) => expect(card.outerHTML).toBe(there[i].outerHTML));
  });

  it("keeps the face down card while there is room for it", () => {
    const list = cards(doc({ fundraisers: [] }));
    expect(list.length).toBeLessThanOrEqual(6);
    expect(list[list.length - 1].classList.contains("ev-card--more")).toBe(true);
  });

  it("never holds more than six, the face down card included", () => {
    for (const count of [3, 4, 5, 6, 12]) {
      const list = cards(doc({ fundraisers: fundraisers(count) }));
      expect(list.length, String(count)).toBeLessThanOrEqual(6);
    }
    expect(cards(doc({ fundraisers: fundraisers(12) })).some((c) => c.classList.contains("ev-card--more"))).toBe(false);
  });

  it("links to everything that's on only when there is more to see than the six here", () => {
    const more = doc({ fundraisers: fundraisers(12) }).querySelector<HTMLAnchorElement>(".evs-more a");
    expect(more?.getAttribute("href")).toBe("/whats-on");
    expect(text(more)).toBe("See everything that’s on");
    expect(doc({ fundraisers: fundraisers(2) }).querySelector(".evs-more")).toBeNull();
    expect(doc({ fundraisers: fundraisers(12) }).body.innerHTML).not.toContain("getinvolved:see-all");
    expect(doc({ fundraisers: fundraisers(2) }).body.innerHTML).not.toContain("getinvolved:see-all");
  });

  it("has the chips, with the hint that only event cards turn over", () => {
    const d = doc();
    expect([...d.querySelectorAll("[data-chips] button")].map(text)).toEqual(["All", "Events", "Fundraisers"]);
    expect(text(d.querySelector("[data-deck-hint]"))).toBe("Turn any event card over for the full details.");
    expect(text(d.querySelector("#whats-on h2"))).toBe("Upcoming events and fundraisers");
  });

  it("carries the card styles the deck needs", () => {
    const d = doc();
    expect(d.querySelector("#whats-on")?.classList.contains("events-deck")).toBe(true);
    expect(d.querySelector('link[href="/assets/css/events.css"]')).not.toBeNull();
    expect(d.querySelector('link[href="/assets/css/fundraising.css"]')).not.toBeNull();
  });

  function loadChips(over: Partial<GetInvolvedInput>) {
    document.documentElement.innerHTML = parse(page(over)).documentElement.innerHTML;
    return initChips(document, window);
  }
  const chip = (show: string) => document.querySelector<HTMLButtonElement>(`[data-chips] [data-show="${show}"]`)!;
  const empty = (kind: string) => document.querySelector<HTMLElement>(`[data-chips-empty="${kind}"]`);
  const manyEvents = Array.from({ length: 7 }, (_, i) => seedWith("empowher-2026", { id: 50 + i, slug: `night-${i}`, date: `2026-12-1${i}` }));

  it("Fundraisers filters the cards here, with the same script", () => {
    loadChips({ fundraisers: fundraisers(2) });
    chip("fundraiser").click();
    expect([...document.querySelectorAll<HTMLElement>(".deck > .ev-card")].filter((c) => !c.hidden).map((c) => c.getAttribute("data-kind"))).toEqual([
      "fundraiser",
      "fundraiser",
    ]);
  });

  it("with no fundraisers anywhere, says so and offers the sign up", () => {
    loadChips({ fundraisers: [] });
    chip("fundraiser").click();
    expect(empty("fundraiser")?.hidden).toBe(false);
    expect(empty("fundraiser")?.querySelector("a")?.getAttribute("href")).toBe("/fundraise");
  });

  // The first six can all be events while fundraisers wait further down What's on. "No fundraisers"
  // would then disagree with the page one click away.
  it("with fundraisers only past the first six, never says there are none", () => {
    loadChips({ events: manyEvents, fundraisers: fundraisers(3) });
    chip("fundraiser").click();
    const line = empty("fundraiser");
    expect(line?.hidden).toBe(false);
    expect(text(line)).not.toContain("No fundraisers");
    expect(line?.querySelector("a")?.getAttribute("href")).toBe("/whats-on");
  });

  it("with six fundraisers and no events, Events is never a blank table", () => {
    loadChips({ events: [], fundraisers: fundraisers(6) });
    chip("event").click();
    expect(empty("event")?.hidden).toBe(false);
    expect(text(empty("event"))).toBe("More dates on the way.");
  });
});

describe("with fundraising switched off", () => {
  const off = () => page({ fundraisingOn: false });
  const d = parse(off());

  it("leaves the Fundraise section out and reads on from What's on", () => {
    expect(d.querySelector("#fundraise")).toBeNull();
    expect(order(d)[1]).toBe("whats-on");
  });

  it("leaves the film out, script and all", () => {
    expect(d.querySelector("video")).toBeNull();
    expect(off()).not.toContain("<script>");
    expect(off()).not.toContain("nbcc-film-seen");
    expect(off()).not.toContain("get-involved-film");
  });

  it("says nothing of fundraisers", () => {
    expect(d.querySelector(".ev-card--fundraiser")).toBeNull();
    expect(d.querySelector("[data-chips]")).toBeNull();
    expect(d.querySelector('link[href="/assets/css/fundraising.css"]')).toBeNull();
    expect(text(d.querySelector("#whats-on h2"))).toBe("Upcoming events");
    expect(text(d.querySelector("[data-deck-hint]"))).toBe("Turn any card over for the full details.");
    expect(off()).not.toContain('href="/fundraise');
  });

  it("still shows the events, and the rest of the page", () => {
    expect(cards(d).length).toBeGreaterThan(0);
    expect(off()).toContain("More ways to help");
    expect(off()).toContain("Not ready yet? Stay close.");
  });

  it("has no leftover markers, on or off", () => {
    expect(off()).not.toMatch(/<!-- (getinvolved|events):/);
    expect(page()).not.toMatch(/<!-- (getinvolved|events):/);
  });

  it("closes the top on cream rather than the crimson of a missing section", () => {
    expect(d.querySelector(".band-hub .fund-edge")).toBeNull();
    expect(d.querySelector(".band-hub > .drift")).not.toBeNull();
    expect(doc().querySelector(".band-hub .fund-edge")).not.toBeNull();
  });
});

describe("the ways to help together, and the rest", () => {
  const d = doc();
  const links = (label: string) =>
    [...d.querySelectorAll(`nav[aria-label="${label}"] a`)].map((a) => [text(a), a.getAttribute("href")]);

  it("offers the three together pages", () => {
    expect(links("Ways to help together")).toEqual([
      ["Your business", "/get-involved/business"],
      ["Your school", "/get-involved/schools"],
      ["Your club or group", "/get-involved/groups"],
    ]);
  });

  it("offers More ways to help, so nobody is stranded", () => {
    expect(links("More ways to help")).toEqual([
      ["Volunteer", "/get-involved/volunteer"],
      ["Drop-off points", "/get-involved/drop-off-points"],
      ["Referrals", "/get-involved/referrals"],
      ["Share your story", "/my-story"],
    ]);
  });

  it("offers the mailing list and the closing lines", () => {
    expect(d.querySelector('a[href="/newsletter"]')).not.toBeNull();
    expect(text(d.querySelector(".together"))).toBe("Together, we make sure nobody is forgotten, at Christmas and all year round.");
    expect(text(d.querySelector(".helpline"))).toContain("Need a little help yourself?");
  });
});

describe("what must not reach the public", () => {
  it("has no prototype marks", () => {
    for (const html of [page(), page({ fundraisingOn: false })]) {
      for (const word of ["tofill", "Photo to come", "Prototype", "proto-pill", "/files/", "families"]) expect(html, word).not.toContain(word);
    }
  });

  it("says nothing about Fill a Red Bag before Stage 2", () => {
    expect(page()).not.toMatch(/Fill a Red Bag|fbTitle|class="fb"/);
    expect(page()).not.toContain('href="/fill');
  });

  it("puts the stage after What's on, when it is given one", () => {
    const html = page({ fillStage: '<section id="stage-stub"></section>' } as never);
    expect(html.indexOf('id="stage-stub"')).toBeGreaterThan(html.indexOf('id="whats-on"'));
    expect(html.indexOf('id="stage-stub"')).toBeLessThan(html.indexOf("Coming as a business, school or group?"));
  });

  it("carries the master footer and no Fill a Red Bag link in it", () => {
    const footer = page().match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(footer).toContain("Ways to give");
    expect(footer).not.toContain("Fill a Red Bag");
  });
});

describe("the styles", () => {
  const css = read("assets/css/get-involved.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("never scroll inside a box", () => {
    expect(css).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
  });

  it("carry nothing of the prototype's paths or its placeholder marks", () => {
    expect(css).not.toContain("/files/");
    expect(css).not.toContain(".tofill");
    expect(css).not.toContain(".proto-");
  });

  it("use the site's own handwriting file", () => {
    expect(css).toContain("/assets/fonts/caveat-latin.woff2");
  });

  it("stop the movement for anyone who asks", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("leave nothing unused from the Fill a Red Bag stage, which comes later", () => {
    expect(css).not.toMatch(/\.fb[-{. ]/);
  });

  it("keep the film's still from sitting under the page: the frame fits its polaroid", () => {
    expect(css).toMatch(/\.fund-film \.gi-film__frame\s*\{[^}]*border-radius/);
  });

  it("do not move a thing the visitor has not asked to see move: every animation is opt out", () => {
    expect(css).not.toMatch(/@keyframes/);
  });
});

describe("the image", () => {
  it("ships the page", () => {
    const copy = read("Dockerfile").split(/\r?\n/).find((l) => l.startsWith("COPY index.html")) ?? "";
    expect(copy.split(/\s+/)).toContain("get-involved.html");
  });
});
