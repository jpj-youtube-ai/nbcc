// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Event tickets on an event's page: what src/routes/fundraise-pages.ts gets from src/tickets/page.ts.
// The database is mocked. Checked: the meter counts ticket money and gifts together and says each
// apart; the section shows where sales are up to; the thank you after buying only ever for this
// event's own order; and a failure leaves the page as it was. Every name here is invented.

const db = vi.hoisted(() => ({ getTicketState: vi.fn(), ticketMoneyFor: vi.fn(), orderForSession: vi.fn() }));
vi.mock("../../src/db/event-tickets", async () => {
  const real = await vi.importActual<typeof import("../../src/db/event-tickets")>("../../src/db/event-tickets");
  return { ...db, availabilityOf: real.availabilityOf, closeFields: real.closeFields };
});
vi.mock("../../src/db/ball", () => ({ getCardFeeRate: vi.fn(async () => ({ percentBp: 120, fixedPence: 20 })) }));
vi.mock("../../src/db/pool", () => ({ pool: {} }));
vi.mock("../../src/clients/turnstile", () => ({ captchaSiteKey: () => "0x-site-key" }));
vi.mock("../../src/config", () => ({ config: { DATABASE_URL: "postgres://localhost/test" } }));

import { ticketPageExtras } from "../../src/tickets/page";
import { meter, type FundraiserRecord, type Meter } from "../../src/fundraising/model";

const parse = (html: string) => new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");

const ev = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 12,
    slug: "eqn",
    path: "event",
    status: "approved",
    public: true,
    booking: "nbcc",
    inMemory: false,
    title: "Exampleton Quiz Night",
    eventDate: "2026-12-05",
    startTime: "19:30",
    meter: meter({ onlinePence: 2500, cashPence: 1000, targetPence: null, giftAidPence: 625 }),
    ...over,
  }) as FundraiserRecord & { meter: Meter };

const NOW = new Date("2026-11-20T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.getTicketState.mockResolvedValue({
    types: [{ id: 1, name: "Adult", pricePence: 1000, quantity: 50, status: "approved", position: 0 }],
    settings: { salesLimit: null, proposedSalesLimit: null, salesClosedAt: null, salesClosedBy: null, salesCloseMode: null, salesCloseAt: null, proposedCloseMode: null, proposedCloseAt: null },
    taken: { 1: 4 },
  });
  db.ticketMoneyFor.mockResolvedValue(4000);
});

describe("an event selling tickets through NBCC", () => {
  it("counts ticket money and gifts together on the meter, and says each apart", async () => {
    const x = await ticketPageExtras(ev(), {}, NOW);
    expect(x.meter?.raisedPence).toBe(4000 + 3500);
    expect(x.meter?.giftAidPence).toBe(625);
    expect(parse(x.html?.summaryHtml ?? "").querySelector(".et-split")?.textContent).toBe("£40 from tickets, £35 in gifts");
  });

  it("draws the Get tickets form while sales are open", async () => {
    const x = await ticketPageExtras(ev(), {}, NOW);
    const d = parse(x.html?.mainHtml ?? "");
    expect(d.querySelector("form[data-et-form]")).toBeTruthy();
    expect(d.querySelector('[data-et-type="1"] input')).toBeTruthy();
    expect(d.querySelector("form[data-et-form]")?.getAttribute("data-captcha-key")).toBe("0x-site-key");
  });

  it("says sales have closed once the event has started", async () => {
    const x = await ticketPageExtras(ev(), {}, new Date("2026-12-05T19:30:00Z"));
    expect(parse(x.html?.mainHtml ?? "").body.textContent).toContain("Ticket sales have closed.");
  });

  it("says sold out when every ticket has gone", async () => {
    db.getTicketState.mockResolvedValue({
      types: [{ id: 1, name: "Adult", pricePence: 1000, quantity: 4, status: "approved", position: 0 }],
      settings: { salesLimit: null, proposedSalesLimit: null, salesClosedAt: null, salesClosedBy: null, salesCloseMode: null, salesCloseAt: null, proposedCloseMode: null, proposedCloseAt: null },
      taken: { 1: 4 },
    });
    const x = await ticketPageExtras(ev(), {}, NOW);
    expect(parse(x.html?.mainHtml ?? "").querySelector(".et-badge")?.textContent).toBe("Sold out");
  });
});

describe("the thank you after buying", () => {
  it("shows this event's order, with its reference", async () => {
    db.orderForSession.mockResolvedValue({ reference: "TIX-ABCDEF", status: "paid", fundraiserId: 12 });
    const x = await ticketPageExtras(ev(), { tickets: "thanks", ticket_session: "cs_test_abc" }, NOW);
    expect(parse(x.html?.introHtml ?? "").body.textContent).toContain("TIX-ABCDEF");
    // The payment's id is in the address: the page must never be kept or indexed.
    expect(x.private).toBe(true);
  });

  it("never shows another event's order", async () => {
    db.orderForSession.mockResolvedValue({ reference: "TIX-ZZZZZZ", status: "paid", fundraiserId: 99 });
    const x = await ticketPageExtras(ev(), { tickets: "thanks", ticket_session: "cs_test_abc" }, NOW);
    expect(x.html?.introHtml ?? "").not.toContain("TIX-ZZZZZZ");
  });

  it("is not looked up for an address that is not Stripe's", async () => {
    await ticketPageExtras(ev(), { tickets: "thanks", ticket_session: "<x>" }, NOW);
    expect(db.orderForSession).not.toHaveBeenCalled();
  });
});

describe("any other page", () => {
  it("adds nothing to a fundraiser raising money", async () => {
    expect(await ticketPageExtras(ev({ path: "raising", booking: null }), {}, NOW)).toEqual({});
    expect(db.getTicketState).not.toHaveBeenCalled();
  });

  it("adds nothing, and asks the database nothing, for an event not selling through NBCC", async () => {
    expect(await ticketPageExtras(ev({ booking: "door" }), {}, NOW)).toEqual({});
    expect(db.ticketMoneyFor).not.toHaveBeenCalled();
    expect(db.getTicketState).not.toHaveBeenCalled();
  });

  it("sells nothing for an event that shares with another cause", async () => {
    const x = await ticketPageExtras(ev({ sharesWithOther: true }), {}, NOW);
    expect(x.html?.mainHtml ?? "").toBe("");
  });

  it("leaves the page as it was when the tickets cannot be read", async () => {
    db.getTicketState.mockRejectedValue(new Error("db down"));
    expect(await ticketPageExtras(ev(), {}, NOW)).toEqual({});
  });
});

describe("when sales close, as the host chose", () => {
  it("is said in the section, and closes it once passed", async () => {
    db.getTicketState.mockResolvedValue({
      types: [{ id: 1, name: "Adult", pricePence: 1000, quantity: 50, status: "approved", position: 0 }],
      settings: { salesLimit: null, proposedSalesLimit: null, salesClosedAt: null, salesClosedBy: null, salesCloseMode: "day_before", salesCloseAt: null, proposedCloseMode: null, proposedCloseAt: null },
      taken: {},
    });
    const open = await ticketPageExtras(ev(), {}, NOW);
    expect(parse(open.html?.mainHtml ?? "").body.textContent).toContain("Sales close at midnight the day before.");
    const closed = await ticketPageExtras(ev(), {}, new Date("2026-12-05T08:00:00Z"));
    expect(parse(closed.html?.mainHtml ?? "").body.textContent).toContain("Ticket sales have closed.");
  });
});
