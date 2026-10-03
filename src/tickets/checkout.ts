import type StripeNS from "stripe";
import { CHECKOUT_MINUTES, type OrderMoney } from "./model";

// Event tickets: the Stripe Checkout session for an order already reserved (src/db/event-tickets.ts
// reserveOrder). Pure: the base address and the time are passed in, so it is unit tested without
// Stripe (test/unit/event-tickets-checkout.test.ts).
//
// One line per PAID ticket type at the price stored when the order was reserved (never a price the buyer
// sent), and the card fee cover on its own line, as the Festive Ball's checkout does, so the buyer
// sees on Stripe's own page what each part is. Card only (Apple Pay and Google Pay come with it): a
// Direct Debit settles over days, too slow for a dated ticket. It closes after 31 minutes, and its
// expired event gives the places back. Marked product=event_tickets with the order's reference: the
// webhook takes it to the tickets (src/tickets/webhook.ts) and it can never be read as a gift.

export interface TicketSessionInput {
  order: {
    reference: string;
    money: OrderMoney;
    lines: Array<{ typeId: number; name: string; unitPence: number; quantity: number }>;
  };
  event: { id: number; title: string; slug: string; when: string };
  buyerEmail: string;
  baseUrl: string;
  now: Date;
}

export function buildTicketSessionParams(input: TicketSessionInput): StripeNS.Checkout.SessionCreateParams {
  const base = input.baseUrl.replace(/\/+$/, "");
  const page = `${base}/event/${input.event.slug}`;
  // Free tickets on the order (a mixed order) are never a line at Stripe: they stay on our order, and
  // Stripe's page and the payment say they are there. What Stripe charges is still the order's total.
  const freeLines = input.order.lines.filter((l) => l.unitPence === 0);
  const freeWords = freeLines.map((l) => `${l.quantity} free ${l.name} ${l.quantity === 1 ? "ticket" : "tickets"}`);
  const plus = freeWords.length ? `${freeWords.slice(0, -1).join(", ")}${freeWords.length > 1 ? " and " : ""}${freeWords[freeWords.length - 1]}` : "";
  const line_items: StripeNS.Checkout.SessionCreateParams.LineItem[] = input.order.lines
    .filter((l) => l.unitPence > 0)
    .map((l, i) => {
      const description = [input.event.when ? `${input.event.when}${plus && i === 0 ? "." : ""}` : "", plus && i === 0 ? `Plus ${plus}.` : ""].filter(Boolean).join(" ");
      return {
        quantity: l.quantity,
        price_data: {
          currency: "gbp",
          unit_amount: l.unitPence,
          product_data: { name: `${input.event.title}: ${l.name} ticket`, ...(description ? { description } : {}) },
        },
      };
    });
  if (input.order.money.feeCoverPence > 0) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: input.order.money.feeCoverPence,
        product_data: { name: "Card fee cover", description: "So all your ticket money funds NBCC's work rather than the card company" },
      },
    });
  }
  const tag = { product: "event_tickets", orderReference: input.order.reference };
  return {
    mode: "payment",
    payment_method_types: ["card"],
    submit_type: "book",
    line_items,
    customer_email: input.buyerEmail,
    metadata: { ...tag, eventId: String(input.event.id) },
    payment_intent_data: { metadata: tag, description: `Tickets ${input.order.reference}: ${input.event.title}${plus ? ` (plus ${plus})` : ""}` },
    expires_at: Math.floor(input.now.getTime() / 1000) + CHECKOUT_MINUTES * 60,
    // Its own name, not session_id: the give form's script reads session_id as a gift's thank you.
    success_url: `${page}?tickets=thanks&ticket_session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${page}#tickets`,
  };
}
