// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderCard, renderEventsPage } from "../../src/events/render";
import { fundraiserEventRecord, renderGetInvolvedPage } from "../../src/fundraising/render";
import type { PublicCard } from "../../src/fundraising/model";
import { SEED_EVENTS } from "./helpers/events-seed";
import { nbccCases, OLD_BOOKING_LINE, OLD_COMMUNITY, RAISING, TEMPLATE, TODAY } from "./helpers/card-golden-cases";

// TASK-499, the card fix. A "holding an event" sign up's card on Get involved is drawn from the
// answers to the new event questions: the line for the front, the finish time, the full address, the
// access ticks, the price and how people get in. Before, every community card said "No need to book.
// Just come along", even for a ticketed event.
//
// NBCC's own events are drawn by the same renderer, and must not change by a single byte:
// helpers/card-golden.json holds them exactly as they were drawn before this change. Every name here
// is invented.

const GOLDEN = JSON.parse(readFileSync(resolve(__dirname, "helpers/card-golden.json"), "utf8")) as Record<string, string>;
const sha = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const frag = (html: string) => new DOMParser().parseFromString(`<!doctype html><body><ol>${html}</ol></body>`, "text/html").body;

describe("NBCC's own events are drawn exactly as before", () => {
  it.each(nbccCases())("the card %s", (name, ev) => {
    expect(renderCard(ev)).toBe(GOLDEN[`card:${name}`]);
  });

  it("the whole events page", () => {
    expect(sha(renderEventsPage(TEMPLATE, SEED_EVENTS))).toBe(GOLDEN["page:events"]);
  });

  it("Get involved, with fundraising off and on", () => {
    const fundraisers = [RAISING as PublicCard];
    expect(sha(renderGetInvolvedPage(TEMPLATE, { events: SEED_EVENTS, fundraisers, fundraisingOn: false, today: TODAY }))).toBe(
      GOLDEN["page:get-involved-off"],
    );
    expect(sha(renderGetInvolvedPage(TEMPLATE, { events: SEED_EVENTS, fundraisers, fundraisingOn: true, today: TODAY }))).toBe(
      GOLDEN["page:get-involved-on"],
    );
  });
});

describe("a community event signed up before the event questions", () => {
  it.each(["short", "long"] as const)("is drawn as before (%s description), without promising there is no need to book", (which) => {
    const before = GOLDEN[`community:${which}`];
    expect(before).toContain(OLD_BOOKING_LINE);
    const now = renderCard(fundraiserEventRecord(OLD_COMMUNITY[which] as PublicCard)!);
    expect(now).toBe(before.replace(OLD_BOOKING_LINE, ""));
    expect(now).not.toContain("No need to book");
  });

  it("is the same when the empty answers are there, as they are when read from the database", () => {
    const empty = {
      cardLine: null, endTime: null, timeTbc: false, venueAddress: null, venuePostcode: null, access: [], price: null, booking: null,
      ticketUrl: null, ageLimit: null, dressCode: null, included: null,
    };
    const card = { ...OLD_COMMUNITY.long, ...empty } as PublicCard;
    expect(renderCard(fundraiserEventRecord(card)!)).toBe(GOLDEN["community:long"].replace(OLD_BOOKING_LINE, ""));
  });
});

describe("a community event signed up with the event questions", () => {
  const answered = (over: Partial<PublicCard> = {}): PublicCard =>
    ({
      ...OLD_COMMUNITY.short,
      organisedBy: "The Example Bakers",
      description: "Cakes, coffee and a tombola in the church hall, with everything baked by the group. Come hungry!",
      cardLine: "Home baking and a tombola, all for NBCC.",
      endTime: "12:30",
      timeTbc: false,
      venueAddress: "Main Street, Exampleton. Parking behind the hall.",
      venuePostcode: "KA1 1AA",
      access: ["step free entry", "accessible toilets"],
      price: "£3 on the door",
      booking: "door",
      ticketUrl: null,
      ageLimit: "All ages",
      dressCode: "Festive jumpers welcome",
      included: "A cuppa and a cake",
      ...over,
    }) as PublicCard;
  const draw = (over: Partial<PublicCard> = {}) => frag(renderCard(fundraiserEventRecord(answered(over))!));

  it("puts the line for the front on the front, and the longer description on the back", () => {
    const card = draw();
    expect(card.querySelector(".ev-front .ev-tldr")?.textContent).toBe("Home baking and a tombola, all for NBCC.");
    expect(card.querySelector(".ev-back .ev-note")?.textContent).toContain("Cakes, coffee and a tombola in the church hall");
  });

  it("shows the finish time, and the time still to be confirmed on the back", () => {
    expect(draw().querySelector(".ev-front .ev-facts")?.textContent).toContain("10am to 12.30pm");
    expect(draw({ timeTbc: true }).querySelector(".ev-back .ev-facts")?.textContent).toContain("10am to 12.30pm (to be confirmed)");
  });

  it("shows the full address with its postcode on the back", () => {
    expect(draw().querySelector(".ev-back .ev-facts")?.textContent).toContain("Main Street, Exampleton. Parking behind the hall. KA1 1AA");
    expect(draw({ venueAddress: "Main Street, Exampleton KA1 1AA" }).querySelector(".ev-back .ev-facts")?.textContent).not.toContain(
      "KA1 1AA, KA1 1AA",
    );
    expect(draw({ venueAddress: null }).querySelector(".ev-back .ev-facts")?.textContent).toContain(
      "Example Church Hall, Exampleton, KA1 1AA",
    );
  });

  it("shows the access ticks, in the words the events page uses", () => {
    const notes = [...draw().querySelectorAll(".ev-back .ev-note")].map((n) => n.textContent);
    expect(notes).toContain("Access: step free entry and accessible toilets.");
  });

  it("shows the price on the front and the back", () => {
    const card = draw();
    expect(card.querySelector(".ev-front .ev-facts")?.textContent).toContain("£3 on the door");
    expect(card.querySelector(".ev-back .ev-facts")?.textContent).toContain("£3 on the door");
  });

  it("puts the age limit, dress code and what is included with anything else worth knowing", () => {
    const note = draw().querySelector(".ev-back .ev-note")?.textContent ?? "";
    expect(note).toContain("Age limit: All ages.");
    expect(note).toContain("Dress code: Festive jumpers welcome.");
    expect(note).toContain("Included: A cuppa and a cake.");
  });

  it("credits it to the name they gave", () => {
    const card = draw();
    expect(card.querySelector(".ev-front .ev-host")?.textContent).toBe("Organised by The Example Bakers");
    expect(card.querySelector(".ev-organiser")?.textContent).toContain("The Example Bakers");
  });

  it("links to tickets sold on another website, saying so under the button", () => {
    const card = draw({ booking: "away", ticketUrl: "https://tickets.example.com/bake" });
    const button = card.querySelector<HTMLAnchorElement>("a.ev-book--away")!;
    expect(button.getAttribute("href")).toBe("https://tickets.example.com/bake");
    expect(button.textContent).toBe("Book tickets, opens in a new tab");
    expect(button.getAttribute("target")).toBe("_blank");
    expect(card.querySelector(".ev-book-note")?.textContent).toBe("Tickets are sold on another website");
    expect(card.textContent).not.toContain("No need to book");
  });

  it("says pay on the door when that is how people get in", () => {
    const card = draw({ booking: "door" });
    expect(card.querySelector(".ev-book-note--solo")?.textContent).toBe("Pay on the door. No need to book.");
    expect(card.querySelector("a.ev-book")).toBeNull();
  });

  it("says just come along only when it is free", () => {
    expect(draw({ booking: "free" }).querySelector(".ev-book-note--solo")?.textContent).toBe("No need to book. Just come along.");
  });

  it("never draws a ticket button without a link to put on it", () => {
    const card = draw({ booking: "away", ticketUrl: null });
    expect(card.querySelector("a.ev-book")).toBeNull();
    expect(card.querySelector(".ev-book-note--solo")?.textContent).toBe("Tickets are sold on another website.");
  });

  it("escapes everything they typed", () => {
    const html = renderCard(fundraiserEventRecord(answered({ cardLine: "<script>alert(1)</script>", price: '"><img src=x>' }))!);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><img src=x>');
  });
});
