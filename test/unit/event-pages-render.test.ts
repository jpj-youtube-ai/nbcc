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
    expect(d.querySelector(".fr-summary__give")?.textContent).toBe("Make a donation");
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
    expect(a?.textContent).toBe("See the event page: Exampleton Quiz Night");
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

// Review fix: an event is often credited to a group or a business ("The Red Lion"), so its page
// never takes the first word of that name as a person's first name. It speaks of the event instead.
describe("an event credited to a group or a business", () => {
  const names = ["The Red Lion", "Exampleton Rotary"];
  const thanksPage = (p: PublicPage, thanks: { message: boolean; sessionId?: string | null; added?: boolean }, now = NOW) =>
    parse(renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now, thanks }));

  it.each(names)("never calls %s by its first word", (organisedBy) => {
    const p = page({ organisedBy });
    const first = organisedBy.split(" ")[0];
    const html = [
      renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now: NOW }),
      renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now: NOW, thanks: { message: false, sessionId: "cs_test_abc" } }),
      renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now: NOW, thanks: { message: false, added: true } }),
      renderFundraiserPage(TEMPLATE, { ...p, finished: true }, { pageUrl: PAGE_URL, now: NOW }),
      renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now: new Date(Date.UTC(2026, 11, 5, 12)) }),
    ].join("");
    expect(html).not.toContain(`${first}'s`);
    expect(html).not.toContain(`${first}&#39;s`);
    expect(html).not.toContain(`helps ${first} `);
    expect(html).not.toContain(`Good luck, ${first}`);
    expect(html).not.toContain(`${first} has finished`);
    expect(html).not.toContain(`Cheer ${first}`);
  });

  it("speaks of the event's total and the event's wall", () => {
    const d = render(page({ organisedBy: "The Red Lion" }));
    expect(d.querySelector(".give-step-sub")?.textContent).toBe(
      "This is a donation to NBCC, not a ticket. Entry is paid on the door on the day. Every gift here counts towards this event's total.",
    );
    expect(d.querySelector(".fr-share p")?.textContent).toBe("Every share helps this event reach more people.");
    const step = thanksPage(page({ organisedBy: "The Red Lion" }), { message: false, sessionId: "cs_test_abc" });
    expect(step.querySelector(".fr-after__title")?.textContent).toBe("Add a message to the wall (optional)");
    expect(step.querySelector(".fr-thanks-panel")?.textContent).toContain("Every share helps this event reach more people.");
    const added = thanksPage(page({ organisedBy: "The Red Lion" }), { message: false, added: true });
    expect(added.querySelector(".fr-thanks-panel")?.textContent).toContain("We have added that to the wall.");
  });

  it("says it has finished without a name", () => {
    const d = render(page({ organisedBy: "The Red Lion", finished: true }));
    expect(d.querySelector(".fr-finished")?.textContent).toContain("This event has finished, and together supporters raised £100 for NBCC.");
    expect(d.querySelector(".give-step-sub")?.textContent).toBe("Your donation goes to NBCC and still counts towards this event's total.");
  });

  it("wishes it well on the day without a name", () => {
    const d = render(page({ organisedBy: "Exampleton Rotary" }), new Date(Date.UTC(2026, 11, 5, 12)));
    expect(d.querySelector(".fr-today__title")?.textContent).toBe("Today's the day!");
    expect(d.querySelector(".fr-today p")?.textContent).toBe("A share today goes a long way.");
  });
});

// Jaimie, 2026-10-03 (TASK-519): an event shared with another cause says so, as a fundraiser's page
// does: the statement the 2009 regulations ask for under the meter, above the Give button, and in the
// give intro that everything given on the page is NBCC's share. Its card and materials carry it too.
describe("an event shared with another cause", () => {
  const SPLIT = {
    nbccSharePercent: 60,
    otherCauseName: "The Exampleton <Lifeboat>",
    statement: "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to The Exampleton <Lifeboat>.",
  };

  it("shows the statement, escaped, under the meter and above the Give button", () => {
    const d = render(page({ split: SPLIT }));
    const summary = d.querySelector(".fr-summary")!;
    const statement = summary.querySelector(".fr-split");
    expect(statement?.textContent).toBe(SPLIT.statement);
    const order = [...summary.children].map((e) => e.className);
    expect(order.indexOf("fr-split")).toBeGreaterThan(order.findIndex((c) => c.includes("fr-meter")));
    expect(order.indexOf("fr-split")).toBeLessThan(order.findIndex((c) => c.includes("fr-summary__give")));
    expect(renderFundraiserPage(TEMPLATE, page({ split: SPLIT }), { pageUrl: PAGE_URL, now: NOW })).not.toContain("<Lifeboat>");
  });

  // Jaimie, 2026-10-03 (event clarity): the give box says, as a line of its own, that everything
  // given on the page goes to NBCC (in place of the fundraiser's "as NBCC's share" sentence).
  it("says in the give box, as a line of its own, that everything given on the page goes to NBCC", () => {
    const d = render(page({ split: SPLIT }));
    expect(d.querySelector(".give-step-sub")?.textContent).toBe(
      "This is a donation to NBCC, not a ticket. Entry is paid on the door on the day. Every gift here counts towards this event's total.",
    );
    expect(d.querySelector(".fr-give .fr-give-share")?.textContent).toBe("Everything you give on this page goes to NBCC.");
    expect(render(page({ split: SPLIT, finished: true })).querySelector(".fr-give .fr-give-share")?.textContent).toBe(
      "Everything you give on this page goes to NBCC.",
    );
    expect(render(page()).querySelector(".fr-give-share")).toBeNull();
    expect(render(page()).querySelector(".give-step-sub")?.textContent).not.toContain("NBCC's share");
  });

  it("has the statement and the way to its page on the back of its Get involved card", () => {
    const card = frag(renderCard(fundraiserEventRecord(eventCard({ split: SPLIT }))!));
    expect(card.querySelector(".ev-back")?.textContent).toContain(SPLIT.statement);
    expect(card.querySelector('.ev-back a[href="/event/eqn"]')).not.toBeNull();
  });
});

// Jaimie, 2026-10-03: an event's page shows the entry price at the top, then a give box whose first
// amount can match it, so a visitor could take giving for paying to get in, and Gift Aid must never
// go on entry or ticket money. An event's page says plainly that giving is a donation, not a ticket,
// and how people do get in. A fundraiser's page is unchanged (fundraiser-page.test.ts).
describe("an event's page: giving is a donation, not a ticket", () => {
  const AWAY = { booking: "away" as const, ticketUrl: "https://www.tickets.example.com/eqn" };
  const sub = (p: PublicPage) => render(p).querySelector(".give-step-sub")?.textContent;
  const entry = (p: PublicPage) => render(p).querySelector(".fr-summary__entry");

  it("has a Make a donation button, with how to get in directly above it", () => {
    const d = render();
    const button = d.querySelector(".fr-summary__give");
    expect(button?.textContent).toBe("Make a donation");
    expect(button?.previousElementSibling?.classList.contains("fr-summary__entry")).toBe(true);
    expect(button?.previousElementSibling?.textContent).toBe("Entry: £5 a head, paid on the door");
  });

  it("says paid on the door without a price when none was given", () => {
    expect(entry(page({ price: null }))?.textContent).toBe("Entry: paid on the door");
  });

  it("links the seller when tickets are sold on another website", () => {
    const line = entry(page({ ...AWAY, price: "£10" }));
    expect(line?.textContent).toBe("Tickets: £10, from tickets.example.com, opens in a new tab");
    const a = line?.querySelector<HTMLAnchorElement>("a");
    expect(a?.getAttribute("href")).toBe("https://www.tickets.example.com/eqn");
    expect(a?.getAttribute("rel")).toBe("noopener");
    expect(entry(page({ ...AWAY, price: null }))?.textContent).toBe("Tickets: from tickets.example.com, opens in a new tab");
  });

  it("says entry is free for a free event", () => {
    expect(entry(page({ booking: "free", price: null }))?.textContent).toBe("Entry: free");
  });

  it("has no entry line when how people get in was never asked", () => {
    expect(entry(page({ booking: null }))).toBeNull();
  });

  it("heads the give box Make a donation", () => {
    expect(render().querySelector("#fr-give-heading")?.textContent).toBe("Make a donation");
  });

  it("says under the heading that it is not a ticket, by how people get in", () => {
    expect(sub(page())).toBe(
      "This is a donation to NBCC, not a ticket. Entry is paid on the door on the day. Every gift here counts towards this event's total.",
    );
    expect(sub(page(AWAY))).toBe(
      "This is a donation to NBCC, not a ticket. To get in, please get your ticket from the seller's website, opens in a new tab. Every gift here counts towards this event's total.",
    );
    expect(render(page(AWAY)).querySelector<HTMLAnchorElement>(".give-step-sub a")?.getAttribute("href")).toBe(AWAY.ticketUrl);
    expect(sub(page({ booking: "away", ticketUrl: null }))).toBe(
      "This is a donation to NBCC, not a ticket. To get in, please get your ticket from the seller's website. Every gift here counts towards this event's total.",
    );
    expect(render(page({ booking: "away", ticketUrl: null })).querySelector(".give-step-sub a")).toBeNull();
    expect(render(page({ booking: "away", ticketUrl: "http://tickets.example.com/eqn" })).querySelector(".give-step-sub a")).toBeNull();
    expect(sub(page({ booking: "free" }))).toBe(
      "Entry is free, so giving is entirely up to you. Every gift here goes to NBCC and counts towards this event's total.",
    );
    expect(sub(page({ booking: null }))).toBe("This is a donation to NBCC, not a ticket. Every gift here counts towards this event's total.");
  });

  it("keeps the Gift Aid headline fixed, and says Gift Aid is never for entry or ticket money", () => {
    const d = render();
    const headline = d.querySelector("[data-giftaid-headline]");
    expect(headline?.textContent).toBe("Make your donation worth 25% more");
    expect(headline?.hasAttribute("data-giftaid-fixed")).toBe(true);
    expect(d.querySelector(".giftaid-entry")?.textContent).toBe("Gift Aid is only for donations, never for entry or ticket money.");
  });

  it("says on the meter that it includes any money the organiser has paid in", () => {
    expect(render().querySelector(".fr-summary .fr-meter__paidin")?.textContent).toBe("Includes any money the organiser has paid in.");
  });

  const thanksText = (p: PublicPage) =>
    parse(renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now: NOW, thanks: { message: false } })).querySelector(".fr-thanks-panel")
      ?.textContent ?? "";

  it("reminds a giver after giving that it was a donation, not a ticket", () => {
    expect(thanksText(page())).toContain("Just so you know, this was a donation rather than a ticket, so please still pay on the door as usual.");
    expect(thanksText(page(AWAY))).toContain("Just so you know, this was a donation rather than a ticket, so please still get your ticket as usual.");
    expect(thanksText(page({ booking: null }))).toContain("Just so you know, this was a donation rather than a ticket.");
    expect(thanksText(page({ booking: "free" }))).not.toContain("rather than a ticket");
  });
});

// Event clarity review: once an event has finished, or its day has passed, there is no door to pay
// on or ticket to get, so the reminder after giving keeps only that it was a donation.
describe("the reminder after giving, once the event is over", () => {
  const thanksText = (p: PublicPage, now = NOW) =>
    parse(renderFundraiserPage(TEMPLATE, p, { pageUrl: PAGE_URL, now, thanks: { message: false } })).querySelector(".fr-thanks-panel")
      ?.textContent ?? "";
  const PLAIN = "Just so you know, this was a donation rather than a ticket.";

  it("drops the pay on the door or get your ticket clause for a finished event", () => {
    expect(thanksText(page({ finished: true }))).toContain(PLAIN);
    expect(thanksText(page({ finished: true, booking: "away", ticketUrl: "https://tickets.example.com/eqn" }))).toContain(PLAIN);
  });

  it("drops it once the event's day has passed", () => {
    expect(thanksText(page(), new Date(Date.UTC(2026, 11, 6, 12)))).toContain(PLAIN);
  });

  it("keeps it on the day itself", () => {
    expect(thanksText(page(), new Date(Date.UTC(2026, 11, 5, 12)))).toContain("so please still pay on the door as usual.");
  });
});
