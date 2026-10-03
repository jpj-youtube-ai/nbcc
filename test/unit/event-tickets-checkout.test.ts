import { describe, it, expect } from "vitest";
import { buildTicketSessionParams } from "../../src/tickets/checkout";

// Event tickets: the Stripe Checkout session for an order. Pure, so the money is checked here: one
// line per ticket type at its stored price, the card fee cover as its own line, card only, closing
// after 31 minutes, and metadata that marks it as tickets (never a fundraiserId, which the donations
// handler reads). Every name here is invented.

const NOW = new Date("2026-11-20T12:00:00Z");

const input = (over: Record<string, unknown> = {}) => ({
  order: {
    reference: "TIX-ABCDEF",
    money: { ticketsPence: 2500, feeCoverPence: 52, totalPence: 2552 },
    lines: [
      { typeId: 1, name: "Adult", unitPence: 1000, quantity: 2 },
      { typeId: 2, name: "Child", unitPence: 500, quantity: 1 },
    ],
  },
  event: { id: 12, title: "Example Quiz Night", slug: "example-quiz", when: "Saturday 5 December 2026, from 7.30pm" },
  buyerEmail: "robin@example.com",
  baseUrl: "https://nbcc.test/",
  now: NOW,
  ...over,
});

describe("the ticket checkout", () => {
  const p = buildTicketSessionParams(input());

  it("charges each type at its stored price, and the fee cover on its own line", () => {
    expect(p.line_items).toEqual([
      { quantity: 2, price_data: { currency: "gbp", unit_amount: 1000, product_data: { name: "Example Quiz Night: Adult ticket", description: "Saturday 5 December 2026, from 7.30pm" } } },
      { quantity: 1, price_data: { currency: "gbp", unit_amount: 500, product_data: { name: "Example Quiz Night: Child ticket", description: "Saturday 5 December 2026, from 7.30pm" } } },
      { quantity: 1, price_data: { currency: "gbp", unit_amount: 52, product_data: { name: "Card fee cover", description: "So all your ticket money funds NBCC's work rather than the card company" } } },
    ]);
    const sum = (p.line_items ?? []).reduce((n, l) => n + (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 0), 0);
    expect(sum).toBe(2552);
  });

  it("has no fee line when the fee is not covered", () => {
    const q = buildTicketSessionParams(input({ order: { ...input().order, money: { ticketsPence: 2500, feeCoverPence: 0, totalPence: 2500 } } }));
    expect(q.line_items).toHaveLength(2);
  });

  it("is a card payment that closes after 31 minutes", () => {
    expect(p.mode).toBe("payment");
    expect(p.payment_method_types).toEqual(["card"]);
    expect(p.expires_at).toBe(Math.floor(NOW.getTime() / 1000) + 31 * 60);
    expect(p.customer_email).toBe("robin@example.com");
  });

  it("is marked as tickets, with the order's reference, and never as a gift", () => {
    expect(p.metadata).toEqual({ product: "event_tickets", orderReference: "TIX-ABCDEF", eventId: "12" });
    expect(p.metadata).not.toHaveProperty("fundraiserId");
    expect(p.metadata).not.toHaveProperty("giftAid");
    expect(p.payment_intent_data?.metadata).toEqual({ product: "event_tickets", orderReference: "TIX-ABCDEF" });
  });

  it("comes back to the event's page, to the thank you or to the tickets", () => {
    expect(p.success_url).toBe("https://nbcc.test/event/example-quiz?tickets=thanks&ticket_session={CHECKOUT_SESSION_ID}");
    expect(p.cancel_url).toBe("https://nbcc.test/event/example-quiz#tickets");
  });
});

describe("an order with free tickets and paid ones", () => {
  const mixed = buildTicketSessionParams(
    input({
      order: {
        reference: "TIX-ABCDEF",
        money: { ticketsPence: 2000, feeCoverPence: 0, totalPence: 2000 },
        lines: [
          { typeId: 1, name: "Adult", unitPence: 1000, quantity: 2 },
          { typeId: 2, name: "Child", unitPence: 0, quantity: 2 },
          { typeId: 3, name: "Under 5", unitPence: 0, quantity: 1 },
        ],
      },
    }),
  );

  it("sends Stripe only the paid tickets: a free one is never a line there", () => {
    expect(mixed.line_items).toHaveLength(1);
    expect(mixed.line_items?.every((l) => (l.price_data?.unit_amount ?? 0) > 0)).toBe(true);
  });

  it("still charges exactly what the order comes to", () => {
    const sum = (mixed.line_items ?? []).reduce((n, l) => n + (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 0), 0);
    expect(sum).toBe(2000);
  });

  it("says the free tickets are on the booking, on Stripe's page and on the payment", () => {
    expect(mixed.line_items?.[0].price_data?.product_data?.description).toBe("Saturday 5 December 2026, from 7.30pm. Plus 2 free Child tickets and 1 free Under 5 ticket.");
    expect(mixed.payment_intent_data?.description).toBe("Tickets TIX-ABCDEF: Example Quiz Night (plus 2 free Child tickets and 1 free Under 5 ticket)");
  });
});
