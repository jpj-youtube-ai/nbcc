import { pool } from "../db/pool";
import { stripe, stripeConfigured } from "../clients/stripe";
import {
  findUnrecordedCustomers,
  type StripeCustomerSummary,
} from "../reconcile/stripe-gap";

// TASK-429: what is Stripe charging that the charity has no record of?
//
// READ ONLY. This writes nothing, to either system. It exists to answer a question that was a
// worry and is now a number, after RMC Double Glazing (Ayr) Ltd turned out to have paid 100 pounds
// a month since 26 May with no donor, no donations and no contact since. They signed up a month
// before this software existed, so Stripe took the money and nothing on this side ever heard.
//
// Anyone else in that position is equally invisible, and the only way to know is to compare the
// two lists. Run as a one-off Fargate task, the same way as the reminders and backup jobs:
// `npm run reconcile:stripe`.

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

/** Everything the charity already has on record. Two cheap reads. */
async function knownRecords(): Promise<{ donorEmails: string[]; subscriptionIds: string[] }> {
  const donors = await pool.query<{ email: string }>(
    `SELECT email FROM donors WHERE email IS NOT NULL AND email <> ''`,
  );
  const subs = await pool.query<{ stripe_subscription_id: string }>(
    `SELECT DISTINCT stripe_subscription_id FROM donations
      WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> ''`,
  );
  return {
    donorEmails: donors.rows.map((r) => r.email),
    subscriptionIds: subs.rows.map((r) => r.stripe_subscription_id),
  };
}

/** Every Stripe customer, with what they have actually paid. */
async function stripeCustomers(): Promise<StripeCustomerSummary[]> {
  const out: StripeCustomerSummary[] = [];

  for await (const customer of stripe.customers.list({ limit: 100 })) {
    if (customer.deleted) continue;

    // Succeeded charges only. An attempted-and-failed payment is not income, and listing it as
    // unrecorded would send somebody looking for money that never arrived.
    let totalPaidPence = 0;
    let paymentCount = 0;
    for await (const charge of stripe.charges.list({ customer: customer.id, limit: 100 })) {
      if (charge.status !== "succeeded" || charge.refunded) continue;
      totalPaidPence += charge.amount - (charge.amount_refunded ?? 0);
      paymentCount += 1;
    }

    const subscriptionIds: string[] = [];
    for await (const sub of stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 100,
    })) {
      subscriptionIds.push(sub.id);
    }

    out.push({
      id: customer.id,
      email: customer.email ?? null,
      name: customer.name ?? null,
      subscriptionIds,
      totalPaidPence,
      paymentCount,
    });
  }

  return out;
}

async function main(): Promise<void> {
  if (!stripeConfigured) {
    console.error("Stripe is not configured (no live key); nothing to reconcile.");
    process.exitCode = 1;
    return;
  }

  const [customers, known] = await Promise.all([stripeCustomers(), knownRecords()]);
  const gaps = findUnrecordedCustomers(customers, known);

  console.log("");
  console.log(`Stripe customers          : ${customers.length}`);
  console.log(`  of whom have paid       : ${customers.filter((c) => c.paymentCount > 0).length}`);
  console.log(`Donors on record          : ${known.donorEmails.length}`);
  console.log(`Subscriptions on record   : ${known.subscriptionIds.length}`);
  console.log("");

  if (gaps.length === 0) {
    console.log("RECONCILED: every paying Stripe customer has a record. Nothing is missing.");
    return;
  }

  const totalMissing = gaps.reduce((n, g) => n + g.totalPaidPence, 0);
  console.log(`UNRECORDED: ${gaps.length} paying customer(s), ${money(totalMissing)} in total.`);
  console.log("");
  for (const g of gaps) {
    console.log(
      `  ${money(g.totalPaidPence).padStart(10)}  ${String(g.paymentCount).padStart(2)} payment(s)  ` +
        `${(g.name ?? "(no name)").padEnd(34)} ${g.email ?? "(NO EMAIL - cannot be matched)"}`,
    );
    console.log(`              ${g.id}${g.subscriptionIds.length ? `  ${g.subscriptionIds.join(", ")}` : ""}`);
  }
  console.log("");
  console.log("This report writes nothing. Importing these is a separate, deliberate step.");
}

main()
  .catch((err) => {
    console.error("RECONCILE_FAILED", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
