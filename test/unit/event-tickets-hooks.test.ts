// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOOKINGS, BOOKING_LABELS, checkOrganiserEdit, meter, signUpSchema, type FundraiserRecord, type PublicCard, type PublicPage } from "../../src/fundraising/model";
import { fundraiserEventRecord, renderFundraiserPage } from "../../src/fundraising/render";
import { NBCC_TICKETS_SHARED } from "../../src/tickets/model";

// Event tickets: the few small hooks into the shared fundraising code. "NBCC sells the tickets for
// me" is a fourth answer to "How do people get in?"; an organiser sharing with another cause cannot
// switch to it; the card on Get involved and the facts on the page point at Get tickets; and the
// page has room for the ticket section (apart from, and above, the give form), the ticket money in
// the summary, and the thank you after buying. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const TEMPLATE = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("How do people get in?", () => {
  it("has NBCC sells the tickets for me, after the four ways the form already had", () => {
    expect([...BOOKINGS]).toEqual(["away", "door", "free", "donations", "nbcc"]);
    expect(BOOKING_LABELS.nbcc).toBe("NBCC sells the tickets for me");
  });

  it("is taken by the sign up form", () => {
    const r = signUpSchema.safeParse({
      path: "event",
      kind: "other",
      kindOther: "A ceilidh",
      title: "Example Ceilidh",
      description: "Dancing.",
      eventDate: "2099-12-05",
      venue: "Example Hall",
      town: "Exampleton",
      public: true,
      firstName: "Kim",
      lastName: "Example",
      email: "kim@example.com",
      phone: "07700 900123",
      instagram: "",
      facebook: "",
      socialOk: false,
      over18: true,
      sharesWithOther: false,
      wants: { shoutOut: false, attend: false },
      cardLine: "A ceilidh for NBCC.",
      booking: "nbcc",
      ticketUrl: "",
    });
    expect(r.success && r.data.booking).toBe("nbcc");
    expect(r.success && r.data.ticketUrl).toBeNull();
  });
});

describe("an organiser's change to how people get in", () => {
  const stored = { path: "event", booking: "door", ticketUrl: null, sharesWithOther: true, startTime: null, endTime: null } as unknown as FundraiserRecord;

  it("refuses NBCC selling the tickets when what is raised is shared with another cause", () => {
    expect(checkOrganiserEdit(stored, { booking: "nbcc" }).fields.booking).toBe(NBCC_TICKETS_SHARED);
  });

  it("allows it when it is not shared", () => {
    expect(checkOrganiserEdit({ ...stored, sharesWithOther: false } as FundraiserRecord, { booking: "nbcc" }).fields).toEqual({});
  });
});

const card = (over: Partial<PublicCard> = {}): PublicCard => ({
  id: 12,
  slug: "eqn",
  path: "event",
  kind: "quiz",
  kindLabel: "A quiz night",
  title: "Exampleton Quiz Night",
  description: "Teams of up to four.",
  eventDate: "2026-12-05",
  startTime: "19:00",
  venue: "The Hall",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Exampleton Rotary",
  url: "/event/eqn",
  meter: meter({ onlinePence: 4000, cashPence: 0, targetPence: null }),
  cardLine: "A quiz for NBCC.",
  booking: "nbcc",
  ticketUrl: null,
  ...over,
});

describe("the card on Get involved", () => {
  it("has a Get tickets button to the page's ticket section", () => {
    const r = fundraiserEventRecord(card());
    expect(r?.bookingHow).toBe("site");
    expect(r?.bookingUrl).toBe("/event/eqn#tickets");
    expect(r?.bookingLabel).toBe("Get tickets");
  });
});

const page = (over: Partial<PublicPage> = {}): PublicPage => ({ ...card(), wall: [], giving: { fundraiserId: 12, minimumPence: 200 }, ...over });
const opts = { pageUrl: "https://nbcc.test/event/eqn", now: new Date(Date.UTC(2026, 10, 25, 12)) };

describe("the event's page", () => {
  it("says in its facts that NBCC sells the tickets here, with the way to them", () => {
    const facts = parse(renderFundraiserPage(TEMPLATE, page(), opts)).querySelector(".fr-facts");
    expect(facts?.textContent).toContain("Tickets are sold here, by NBCC. Get tickets");
    expect(facts?.querySelector('a[href="#tickets"]')).toBeTruthy();
  });

  it("puts the ticket section before the give form, and apart from it", () => {
    const d = parse(
      renderFundraiserPage(TEMPLATE, page(), {
        ...opts,
        tickets: { mainHtml: '<section id="tickets">TICKETS</section>', summaryHtml: '<p class="et-split">SPLIT</p>', introHtml: '<div data-et-thanks>THANKS</div>' },
      }),
    );
    const tickets = d.getElementById("tickets");
    const give = d.getElementById("give");
    expect(tickets && give).toBeTruthy();
    expect(tickets?.compareDocumentPosition(give as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(give?.contains(tickets as Node)).toBe(false);
    expect(d.querySelector(".fr-summary .et-split")?.textContent).toBe("SPLIT");
    expect(d.querySelector("[data-et-thanks]")?.textContent).toBe("THANKS");
  });

  it("is as it was without tickets", () => {
    const html = renderFundraiserPage(TEMPLATE, page({ booking: "door" }), opts);
    expect(html).not.toContain('id="tickets"');
    expect(html).not.toContain("et-split");
  });
});
