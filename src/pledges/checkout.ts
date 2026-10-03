import type StripeNS from "stripe";
import { buildSessionParams, PAY_IN_SESSION_MINUTES } from "../routes/api";
import type { CardFeeRate } from "../ball/pricing";
import type { PledgeRecord } from "../db/pledges";

// Sponsor pledges (Jaimie, 2026-10-03): the Stripe Checkout session for paying a pledge.
//
// It is the SAME session a gift on the fundraiser's page makes (buildSessionParams, src/routes/api.ts),
// built from the pledge instead of from a form, so the ONE webhook does what it does for any gift:
// records the donation, links it to the fundraiser (the meter and the wall), writes the Gift Aid
// declaration, and sends the receipt. On top, three things the webhook and a claim read:
//
//   metadata.pledgeId           the pledge this pays; the webhook marks it paid in the same
//                               transaction (settlePledge, src/db/pledges.ts). Only ever stamped here,
//                               by the server, from a signed pay link.
//   metadata.giftAidWording     Gift Aid goes on only if it was declared WITH the pledge and the
//   metadata.giftAidWordingVersion   sponsor leaves it ticked on the pay page. Paying exactly what was
//                               pledged, the declaration kept is the pledge's own, word for word ("my
//                               donation of £10 when I pay it"). Paying more (never less: the pay
//                               page refuses it), it is the standard single donation declaration,
//                               which the pay page shows and they confirm by paying.
//   metadata.pledgeDeclaredAt   when the declaration was made with the pledge.
//
// Card only (with Apple Pay and Google Pay, which Stripe offers on card): a pledge is either paid or
// it is not, never a Direct Debit waiting to settle. The session closes after half an hour, like an
// organiser's pay in, so a payment left open cannot complete days later.

type CheckoutBody = Parameters<typeof buildSessionParams>[0];

export interface PledgeCheckoutInput {
  pledge: PledgeRecord;
  /** What they are paying, in pence: what they pledged, or more (parsePayAmount). */
  payPence: number;
  /** Gift Aid left ticked on the pay page. Only counts when it was declared with the pledge. */
  giftAid: boolean;
  coverFee: boolean;
  /** The pay page's own address, with its token: where a cancel on Stripe's page goes back to. */
  payUrl: string;
  /** The fundraiser's page, to come back to with a thank you; null when it has none just now. */
  fundraiserPage: string | null;
}

export function buildPledgeSessionParams(input: PledgeCheckoutInput, cardFee?: CardFeeRate, now: Date = new Date()): StripeNS.Checkout.SessionCreateParams {
  const p = input.pledge;
  // Never Gift Aid that was not declared with the pledge, or whose address has gone.
  const declared = p.giftAid && Boolean(p.gaWordingSnapshot) && Boolean(p.gaAddress) && (p.gaNonUk || Boolean(p.gaPostcode));
  const giftAid = input.giftAid && declared;
  const first = (p.firstName ?? "").trim();
  const last = (p.surname ?? "").trim();
  const body: CheckoutBody = {
    mode: "once",
    plan: null,
    amount: input.payPence,
    giftAid,
    coverFee: input.coverFee,
    uiMode: "hosted",
    donorType: "individual",
    fullName: `${first} ${last}`.trim(),
    email: p.email ?? undefined,
    emailConsent: false,
    anonymous: !p.showName,
    fundraiserId: p.fundraiserId,
    supporterMessage: p.messageHidden ? "" : (p.message ?? ""),
    showName: p.showName,
    showAmount: p.showAmount,
    ...(giftAid
      ? {
          declaration: {
            firstName: first,
            lastName: last,
            houseNameNumber: p.gaHouse ?? undefined,
            address: p.gaAddress as string,
            postcode: p.gaNonUk ? undefined : (p.gaPostcode ?? undefined),
            nonUk: p.gaNonUk,
          },
        }
      : {}),
  };
  const params = buildSessionParams(body, cardFee, input.fundraiserPage);
  const metadata: Record<string, string> = { ...(params.metadata as Record<string, string>), pledgeId: String(p.id) };
  if (giftAid) {
    if (input.payPence === p.amountPence) {
      metadata.giftAidWordingVersion = p.gaWordingVersion ?? metadata.giftAidWordingVersion;
      metadata.giftAidWording = p.gaWordingSnapshot as string;
    }
    if (p.gaDeclaredAt) metadata.pledgeDeclaredAt = p.gaDeclaredAt;
  }
  return {
    ...params,
    metadata,
    payment_method_types: ["card"],
    cancel_url: input.payUrl,
    expires_at: Math.floor(now.getTime() / 1000) + PAY_IN_SESSION_MINUTES * 60,
  };
}

export { parsePayAmount } from "./model";
