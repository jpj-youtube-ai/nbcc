import { availabilityOf, closeFields, getTicketState, orderForSession, ticketMoneyFor } from "../db/event-tickets";
import { getCardFeeRate } from "../db/ball";
import { captchaSiteKey } from "../clients/turnstile";
import { DEFAULT_CARD_FEE, type CardFeeRate } from "../ball/pricing";
import { isCheckoutSessionId, meter, type FundraiserRecord, type Meter } from "../fundraising/model";
import { TICKETS_BOOKING, closeWords, salesState } from "./model";
import { renderTicketsSection, renderTicketsSummary, renderTicketsThanks } from "./render";

// Event tickets on an event's page (/event/<short name>): what src/routes/fundraise-pages.ts adds,
// through the tickets slots of renderFundraiserPage (src/fundraising/render.ts).
//
//   - the meter: ticket money and gifts together, with "£X from tickets, £Y in gifts" under it
//     (Gift Aid stays on the gifts only, as ticket money never has any);
//   - the Get tickets section, its own and apart from the give form, saying where sales are up to;
//   - the thank you after buying (?tickets=thanks&ticket_session=), only for this event's own order.
//     `private` says the address carries a payment's id, so the route never lets the page be kept.
//
// The page is only ever drawn while fundraising is on, so that is taken as given. Best effort: if
// the tickets cannot be read, the page goes out as it was, without them, rather than not at all.

export interface TicketPageExtras {
  meter?: Meter;
  html?: { introHtml: string; summaryHtml: string; mainHtml: string };
  private?: boolean;
}

function siteKey(): string | null {
  try {
    return captchaSiteKey();
  } catch {
    return null;
  }
}

async function cardFee(): Promise<CardFeeRate> {
  try {
    return await getCardFeeRate();
  } catch {
    return DEFAULT_CARD_FEE;
  }
}

async function thanksFor(f: Pick<FundraiserRecord, "id">, query: Record<string, unknown>): Promise<string> {
  if (query.tickets !== "thanks") return "";
  const id = query.ticket_session;
  if (!isCheckoutSessionId(id)) return "";
  const order = await orderForSession(id);
  if (order && order.fundraiserId !== f.id) return "";
  return renderTicketsThanks({ reference: order?.reference ?? null, paid: order?.status === "paid" });
}

export async function ticketPageExtras(
  f: FundraiserRecord & { meter: Meter },
  query: Record<string, unknown>,
  now: Date,
): Promise<TicketPageExtras> {
  if (f.path !== "event") return {};
  try {
    // Only an event that sells through NBCC is asked about at all (nothing is read for any other).
    if (f.booking !== TICKETS_BOOKING || f.inMemory) return {};
    const ticketPence = await ticketMoneyFor(f.id);
    const together = meter({
      onlinePence: f.meter.onlinePence + ticketPence,
      cashPence: f.meter.cashPence,
      targetPence: f.meter.targetPence,
      giftAidPence: f.meter.giftAidPence,
    });
    const gifts = f.meter.raisedPence;
    const [state, rate, introHtml] = await Promise.all([getTicketState(f.id), cardFee(), thanksFor(f, query)]);
    const a = availabilityOf(state);
    const sales = salesState(
      { ...f, booking: f.booking, ...closeFields(state.settings) },
      { fundraisingOn: true, now, onSale: a.onSale, soldOut: a.soldOut },
    );
    return {
      meter: together,
      ...(query.ticket_session !== undefined ? { private: true } : {}),
      html: {
        introHtml,
        summaryHtml: renderTicketsSummary({ ticketsPence: ticketPence, giftsPence: gifts }, sales),
        mainHtml: renderTicketsSection({ state: sales, fundraiserId: f.id, slug: f.slug, title: f.title, types: a.types, cardFee: rate, captchaSiteKey: siteKey(), closeWords: closeWords({ mode: state.settings.salesCloseMode, at: state.settings.salesCloseAt }) }),
      },
    };
  } catch (err) {
    console.error("event tickets on the page failed:", err instanceof Error ? err.message : err);
    return {};
  }
}
