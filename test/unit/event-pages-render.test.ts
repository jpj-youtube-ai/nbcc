// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fundraiserEventRecord, renderFundraiserPage, renderGetInvolvedPage } from "../../src/fundraising/render";
import { renderCard } from "../../src/events/render";
import { meter, type PublicCard, type PublicPage } from "../../src/fundraising/model";

// Event pages: an event's own page is drawn by the fundraiser page's code, with what an event needs
// (when, from and to, where, the cost, how people get in, and the good to know notes), and the Get
// involved card links to it. A fundraiser's page is untouched (fundraising-render.test.ts). Tickets
// are not sold here: how people get in is shown as words, with the seller's link if they gave one.
// Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const TEMPLATE = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const frag = (html: string) => parse(`<!doctype html><body><ol>${html}</ol></body>`).body;

const NOW = new Date(Date.UTC(2026, 10, 25, 12, 0, 0)); // 25 November 2026
const PAGE_URL = "https://nbcc.test/event/eqn";

const eventCard = (over: Partial<PublicCard> = {}): PublicCard => ({
  id: 12,
  slug: "eqn",
  path: "event",
  kind: "quiz",
  kindLabel: "A quiz night",
  title: "Exampleton Quiz Night",
  description: "Teams of up to four.\n\nPrizes for the winners and a raffle.",
  eventDate: "2026-12-05",
  startTime: "19:00",
  venue: "The Hall",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Exampleton Rotary",
  url: "/event/eqn",
  meter: meter({ onlinePence: 4000, cashPence: 6000, targetPence: null }),
  cardLine: "A quiz for NBCC.",
  endTime: "22:00",
  timeTbc: false,
  venueAddress: "1 Example Street, Exampleton",
  venuePostcode: "KA1 1AA",
  access: ["step free entry", "accessible toilets"],
  price: "£5 a head",
  booking: "door",
  ticketUrl: null,
  ageLimit: "18 and over",
  dressCode: null,
  included: "Tea and a biscuit",
  ...over,
});

const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  ...eventCard(),
  wall: [],
  giving: { fundraiserId: 12, minimumPence: 200 },
  ...over,
});

const render = (p: PublicPage = page(), now = NOW) => parse(renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now }));

describe("an event's page", () => {
  it("is titled and described as an event, for search and for sharing", () => {
    const d = render();
    expect(d.title).toBe("Exampleton Quiz Night | Night Before Christmas Campaign");
    expect(d.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "A community event raising money for NBCC, organised by Exampleton Rotary. Teams of up to four. Prizes for the winners and a raffle.",
    );
    expect(d.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(PAGE_URL);
  });

  it("says when, from and to", () => {
    const when = render().querySelector(".fr-facts time");
    expect(when?.getAttribute("datetime")).toBe("2026-12-05T19:00");
    expect(when?.parentElement?.textContent).toContain("Saturday 5 December 2026, 7pm to 10pm");
  });

  it("says when the time is still to be confirmed", () => {
    expect(render(page({ timeTbc: true })).querySelector(".fr-facts")?.textContent).toContain("7pm to 10pm (to be confirmed)");
  });

  it("says where, in full", () => {
    expect(render().querySelector(".fr-facts")?.textContent).toContain("1 Example Street, Exampleton, KA1 1AA");
  });

  it("says what it costs and how people get in, as words", () => {
    const facts = render().querySelector(".fr-facts")?.textContent ?? "";
    expect(facts).toContain("£5 a head");
    expect(facts).toContain("Pay on the door. No need to book.");
  });

  it("links to where tickets are sold, when they are sold on another website", () => {
    const d = render(page({ booking: "away", ticketUrl: "https://tickets.example.com/eqn" }));
    expect(d.querySelector(".fr-facts")?.textContent).toContain("Tickets are sold on another website.");
    const a = d.querySelector<HTMLAnchorElement>('.fr-facts a[href="https://tickets.example.com/eqn"]');
    expect(a?.textContent).toContain("Get tickets");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener");
  });

  it("promises nothing about getting in when it was never asked", () => {
    const facts = render(page({ booking: null })).querySelector(".fr-facts")?.textContent ?? "";
    expect(facts).not.toContain("No need to book");
    expect(facts).not.toContain("Tickets");
  });

  it("names who is running it", () => {
    expect(render().querySelector(".fr-facts")?.textContent).toContain("Organised by Exampleton Rotary");
  });

  it("tells the story, then the good to know notes and the access", () => {
    const story = render().querySelector(".fr-story");
    expect(story?.querySelector("h2")?.textContent).toBe("About this event");
    expect(story?.textContent).toContain("Prizes for the winners and a raffle.");
    expect(story?.textContent).toContain("Age limit: 18 and over.");
    expect(story?.textContent).toContain("Included: Tea and a biscuit.");
    expect(story?.textContent).toContain("Access: step free entry and accessible toilets.");
    expect(story?.textContent).not.toContain("Dress code");
  });

  it("shows the money raised at it and for it, with no target bar", () => {
    const d = render();
    expect(d.querySelector(".fr-summary .fr-meter__raised")?.textContent).toBe("£100");
    expect(d.querySelector(".fr-summary .fr-meter__bar")).toBeNull();
    expect(d.querySelector(".fr-summary__give")?.textContent).toBe("Give to this event");
  });

  it("takes gifts the same way as a fundraiser's page", () => {
    const form = render().querySelector("#frGiveForm");
    expect(form?.getAttribute("data-fundraiser-id")).toBe("12");
  });

  it("counts down to the day, and says nothing of it once it has passed", () => {
    expect(render().querySelector(".fr-countdown")?.textContent).toBe("10 days to go");
    expect(render(page(), new Date(Date.UTC(2026, 11, 6, 12))).querySelector(".fr-countdown, .fr-today")).toBeNull();
  });

  it("sends a giver who adds to the wall back to the event's own page", () => {
    const d = render(page(), NOW);
    const thanks = parse(
      renderFundraiserPage(TEMPLATE, page(), { pageUrl: PAGE_URL, now: NOW, thanks: { message: false, sessionId: "cs_test_abc" } }),
    );
    expect(d.querySelector("[data-wall-step]")).toBeNull();
    expect(thanks.querySelector("[data-wall-step]")?.getAttribute("data-page")).toBe("/event/eqn");
  });

  it("escapes everything they typed", () => {
    const html = renderFundraiserPage(TEMPLATE, page({ price: "<b>free</b>", ageLimit: '"><script>x</script>' }), { pageUrl: PAGE_URL, now: NOW });
    expect(html).not.toContain("<b>free</b>");
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("the Get involved card for an event", () => {
  it("links to the event's own page", () => {
    const a = frag(renderCard(fundraiserEventRecord(eventCard())!)).querySelector<HTMLAnchorElement>('a[href="/event/eqn"]');
    expect(a?.textContent).toContain("See the event page");
    expect(a?.closest(".ev-back")).not.toBeNull();
  });

  it("has no such link when it has no page", () => {
    expect(frag(renderCard(fundraiserEventRecord(eventCard({ url: null }))!)).querySelector('a[href^="/event/"]')).toBeNull();
  });

  it("is on Get involved with the link while fundraising is on", () => {
    const html = renderGetInvolvedPage(readFileSync(resolve(ROOT, "events.html"), "utf8"), {
      events: [],
      fundraisers: [eventCard()],
      fundraisingOn: true,
      today: "2026-11-25",
    });
    expect(parse(html).querySelector('#community-eqn a[href="/event/eqn"]')).not.toBeNull();
  });
});
