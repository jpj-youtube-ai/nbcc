import type Stripe from "stripe";
import { pool } from "./pool";
import { payDetailsFromCharge, type PayDetails } from "../donations/pay-details";

// How a gift was paid (the Donations gift log, docs/superpowers/specs/2026-11-05-donations-screen-design.md),
// kept on the donation in pay_method, pay_wallet, card_brand, card_last4 and card_country
// (migration 1791200000370). Read from Stripe AFTER the gift is saved, never in the way of it:
//   - the webhook asks for a gift it has just recorded, after its commit, without waiting
//     (payDetailsLater), so Stripe's answer is never held up;
//   - an older gift is asked about the first time its details are opened in the admin.
// Stripe is asked once: pay_checked_at is stamped even when Stripe has nothing to say, except while a
// gift's invoice has no payment at all yet (a later look asks again). An older invoice gift with no
// Stripe ids at all was paid by bank transfer, and is noted so. Nothing here ever throws, and a failure
// only means the gift log says "Not noted".

type Query = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
type PayStripe = Pick<Stripe, "charges" | "paymentIntents" | "checkout" | "invoicePayments">;

export interface PayDetailsDeps {
  query?: Query;
  stripe?: PayStripe;
}

/** What else the caller knows that may lead to the payment: a renewal's invoice, from its webhook event. */
export interface PayDetailsHint {
  invoiceId?: string | null;
}

export const PAY_DETAILS_ROW_SQL = `SELECT stripe_charge_id, stripe_payment_intent_id, stripe_session_id, pay_method, source
  FROM donations WHERE id = $1`;

// $1 = donation id, $2..$6 = method, wallet, brand, last four, country. Only fills in a gift where
// nothing is noted yet, so a bank transfer or a second ask never overwrites what is there.
export const WRITE_PAY_DETAILS_SQL = `UPDATE donations SET pay_method = $2, pay_wallet = $3, card_brand = $4,
  card_last4 = $5, card_country = $6, pay_checked_at = now()
  WHERE id = $1 AND pay_method IS NULL`;

interface IdsRow {
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  pay_method: string | null;
  source: string | null;
}

// An invoice with no payment at all yet: not "nothing found", so pay_checked_at is not stamped.
const NOT_YET = Symbol("no payment yet");

const defaultQuery: Query = (sql, params) => pool.query(sql, params);

// The real client, loaded only when first needed. Null with the offline stand-in (no real Stripe key,
// outside production): it has no payments to look up, so nothing is asked and nothing is stamped.
// Null too when the client cannot be made at all (no key in a test's stand-in config): that is not
// this record keeping's to report, as every payment would be failing loudly elsewhere.
async function defaultStripe(): Promise<PayStripe | null> {
  try {
    const client = await import("../clients/stripe");
    return client.stripeIsOfflineStub ? null : client.stripe;
  } catch {
    return null;
  }
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

// A charge, or a reference to one: only an expanded charge object counts.
const chargeOf = (v: unknown): Stripe.Charge | null =>
  typeof v === "object" && v !== null && (v as { object?: unknown }).object === "charge" ? (v as Stripe.Charge) : null;

async function chargeOfIntent(stripe: PayStripe, intent: unknown): Promise<Stripe.Charge | null> {
  if (typeof intent === "object" && intent !== null) {
    const expanded = chargeOf((intent as { latest_charge?: unknown }).latest_charge);
    if (expanded) return expanded;
  }
  const id = idOf(intent);
  if (!id) return null;
  const pi = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
  return chargeOf(pi?.latest_charge);
}

// An invoice's payment: a monthly gift's first (its checkout's invoice) or a renewal's. Paid or not
// yet: a Direct Debit's first invoice is still open at checkout.session.completed, but its payment
// intent's charge already carries the bacs_debit details while pending.
async function chargeOfInvoice(stripe: PayStripe, invoiceId: string): Promise<Stripe.Charge | null | typeof NOT_YET> {
  const list = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 1 });
  const payment = list?.data?.[0]?.payment;
  if (!payment) return NOT_YET;
  if (payment.payment_intent) return chargeOfIntent(stripe, payment.payment_intent);
  const chargeId = idOf(payment.charge);
  return chargeId ? chargeOf(await stripe.charges.retrieve(chargeId)) : null;
}

// The charge that took the money: by its id, else the payment intent's latest charge, else through
// the checkout session (its payment intent, or for a monthly gift its first invoice), else through an
// invoice the caller names. Null when none of them leads to one.
async function findCharge(stripe: PayStripe, row: IdsRow, hint: PayDetailsHint): Promise<Stripe.Charge | null | typeof NOT_YET> {
  if (row.stripe_charge_id) return chargeOf(await stripe.charges.retrieve(row.stripe_charge_id));
  if (row.stripe_payment_intent_id) return chargeOfIntent(stripe, row.stripe_payment_intent_id);
  if (row.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id, { expand: ["payment_intent.latest_charge"] });
    if (session?.payment_intent) return chargeOfIntent(stripe, session.payment_intent);
    const invoiceId = idOf(session?.invoice);
    if (invoiceId) return chargeOfInvoice(stripe, invoiceId);
  }
  if (hint.invoiceId) return chargeOfInvoice(stripe, hint.invoiceId);
  return null;
}

// Stripe saying the payment is not there (a test-mode id, say) is an answer, not a failure.
const isNotThere = (err: unknown): boolean => {
  const e = err as { statusCode?: unknown; code?: unknown } | null;
  return e?.statusCode === 404 || e?.code === "resource_missing";
};

// One line, with the donation id and the kind of failure only: no message text, no Stripe ids.
function sayNotNoted(donationId: number, err: unknown): void {
  const e = err as { type?: unknown; code?: unknown } | null;
  const kind = typeof e?.type === "string" ? e.type : typeof e?.code === "string" ? `database error code ${e.code}` : "unknown error";
  console.error("how a gift was paid not noted (the donation itself is saved and unaffected):", `donation ${donationId},`, kind);
}

const paramsFor = (donationId: number, d: PayDetails | null): unknown[] => [
  donationId,
  d?.method ?? null,
  d?.wallet ?? null,
  d?.brand ?? null,
  d?.last4 ?? null,
  d?.country ?? null,
];

/**
 * Ask Stripe how a gift was paid and keep it on the donation. Skips a gift already noted. Stamps
 * pay_checked_at even when nothing is found, so Stripe is asked once, but not while its invoice has
 * no payment yet. An invoice gift with no Stripe ids at all is noted as a bank transfer. Returns what was found, or null
 * (nothing found, already noted, or a failure). Never throws; a failure leaves the gift unchecked so a
 * later look can ask again.
 */
export async function fillPayDetails(donationId: number, hint: PayDetailsHint = {}, deps: PayDetailsDeps = {}): Promise<PayDetails | null> {
  const query = deps.query ?? defaultQuery;
  try {
    const stripe = deps.stripe ?? (await defaultStripe());
    if (!stripe) return null;
    const row = (await query(PAY_DETAILS_ROW_SQL, [donationId])).rows[0] as IdsRow | undefined;
    if (!row || row.pay_method !== null) return null;
    const noStripeIds = !row.stripe_payment_intent_id && !row.stripe_charge_id && !row.stripe_session_id;
    if (row.source === "invoice" && noStripeIds) {
      const transfer: PayDetails = { method: "bank_transfer", wallet: null, brand: null, last4: null, country: null };
      await query(WRITE_PAY_DETAILS_SQL, paramsFor(donationId, transfer));
      return transfer;
    }
    let details: PayDetails | null;
    try {
      const found = await findCharge(stripe, row, hint);
      if (found === NOT_YET) return null;
      details = payDetailsFromCharge(found);
    } catch (err) {
      if (!isNotThere(err)) throw err;
      details = null;
    }
    await query(WRITE_PAY_DETAILS_SQL, paramsFor(donationId, details));
    return details;
  } catch (err) {
    sayNotNoted(donationId, err);
    return null;
  }
}

/** Keep details already in hand (a card reader's charge is in its webhook event). True when written. Never throws. */
export async function recordPayDetails(donationId: number, details: PayDetails | null, deps: PayDetailsDeps = {}): Promise<boolean> {
  try {
    await (deps.query ?? defaultQuery)(WRITE_PAY_DETAILS_SQL, paramsFor(donationId, details));
    return true;
  } catch (err) {
    sayNotNoted(donationId, err);
    return false;
  }
}

/** Where the webhook gets a just recorded gift's details from: the charge in its event, else Stripe. */
export interface PayDetailsSource {
  charge?: Stripe.Charge | null;
  invoiceId?: string | null;
}

/**
 * Note how a just recorded gift was paid, without waiting: nothing runs in line, and the promise is
 * never handed back, so whatever called it (the webhook, before it answers Stripe) carries straight
 * on. Started as a microtask rather than a timer, so it holds no timer open. Never throws, now or later.
 */
export function payDetailsLater(donationId: number, from: PayDetailsSource = {}, deps: PayDetailsDeps = {}): void {
  void Promise.resolve()
    .then((): Promise<unknown> =>
      from.charge
        ? recordPayDetails(donationId, payDetailsFromCharge(from.charge), deps)
        : fillPayDetails(donationId, { invoiceId: from.invoiceId ?? null }, deps),
    )
    .catch(() => {});
}
