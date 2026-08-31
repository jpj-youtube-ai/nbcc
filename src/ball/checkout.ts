import type StripeNS from "stripe";
import { ballMetadata, type Purchase } from "./booking";
import {
  orderTotalPence,
  SEAT_PRICE_PENCE,
  TABLE_PRICE_PENCE,
  DEFAULT_CARD_FEE,
  type CardFeeRate,
} from "./pricing";

// TASK-313: pure assembly of the Stripe Checkout session for a Festive Ball purchase.
// Config and the clock are INJECTED (baseUrl, now), so this is unit-tested DB-free and
// network-free, mirroring buildSessionParams in src/routes/api.ts for donations.

// Stripe's minimum session lifetime is 30 minutes. That is exactly what we want: it is the
// mechanism that returns seats from an abandoned checkout. The pending booking holds the
// seats, Stripe expires the session, checkout.session.expired cancels the booking, seats
// come back — with no sweeper of our own to go wrong unattended.
export const SESSION_TTL_MS = 30 * 60 * 1000;

export interface BallSessionInput {
  purchase: Purchase;
  reference: string;
  seats: number;
  baseUrl: string;
  now: Date;
  /** Embedded Checkout only engages when a publishable key is configured (see TASK-215). */
  embedded?: boolean;
  /** The live card rate from ball_settings. Omitted only in tests, where the default applies. */
  cardFee?: CardFeeRate;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

function ticketLine(purchase: Purchase): StripeNS.Checkout.SessionCreateParams.LineItem {
  const isTable = purchase.kind === "table";
  return {
    quantity: purchase.quantity,
    price_data: {
      currency: "gbp",
      unit_amount: isTable ? TABLE_PRICE_PENCE : SEAT_PRICE_PENCE,
      product_data: {
        name: isTable
          ? "A Night to Remember — Festive Ball 2026, table of 10"
          : "A Night to Remember — Festive Ball 2026, ticket",
        description: "Saturday 7th November 2026, The Park Hotel, Kilmarnock",
      },
    },
  };
}

// Donation and fee cover are their OWN lines rather than folded into the ticket price, so the
// buyer sees on Stripe's own page exactly what each part of the charge is. It also keeps the
// ticket line at the £100 that is printed in the magazine.
export function buildBallSessionParams(
  input: BallSessionInput,
): StripeNS.Checkout.SessionCreateParams {
  const { purchase, reference, seats, now, embedded } = input;
  const base = trimSlash(input.baseUrl);
  const totals = orderTotalPence({
    order: { kind: purchase.kind, quantity: purchase.quantity },
    donationPence: purchase.donationPence,
    coverFee: purchase.coverFee,
    cardFee: input.cardFee ?? DEFAULT_CARD_FEE,
  });

  const line_items: StripeNS.Checkout.SessionCreateParams.LineItem[] = [ticketLine(purchase)];
  if (totals.donationPence > 0) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: totals.donationPence,
        product_data: {
          name: "Donation to NBCC",
          description: "A voluntary gift on top of your ticket",
        },
      },
    });
  }
  if (totals.feeCoverPence > 0) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: totals.feeCoverPence,
        product_data: {
          name: "Card fee cover",
          description: "So the full ticket price reaches NBCC",
        },
      },
    });
  }

  const returnUrl = `${base}/ball/thank-you?session_id={CHECKOUT_SESSION_ID}`;

  const params: StripeNS.Checkout.SessionCreateParams = {
    mode: "payment",
    // Card only. BACS Direct Debit is offered on donations but is wrong here: it settles over
    // days, and a dated ticket cannot wait for a mandate to clear.
    payment_method_types: ["card"],
    line_items,
    customer_email: purchase.buyerEmail,
    metadata: ballMetadata(purchase, reference, seats, input.cardFee ?? DEFAULT_CARD_FEE),
    expires_at: Math.floor((now.getTime() + SESSION_TTL_MS) / 1000),
  };

  if (embedded) {
    // Stripe's SDK enum for inline checkout; it redirects the whole page to return_url and
    // must NOT be given success_url/cancel_url.
    params.ui_mode = "embedded_page";
    params.return_url = returnUrl;
  } else {
    params.success_url = returnUrl;
    params.cancel_url = `${base}/ball`;
  }
  return params;
}
