// TASK-429: comparing what Stripe is charging against what the charity has recorded.
//
// RMC Double Glazing (Ayr) Ltd has paid 100 pounds a month since 26 May 2026. Five payments, 500
// pounds, and there is no donor, no donation, no supporter listing and no contact with them since
// they signed up. Not a bug: they signed up before this software existed. The first commit in this
// repository is dated 23 June; they started paying on 26 May. Stripe took the money and there was
// nothing on this side to hear about it.
//
// Which raises the question this file answers: who else? Comparing the two lists turns that from a
// worry into a number.

export type StripeCustomerSummary = {
  id: string;
  email: string | null;
  name: string | null;
  subscriptionIds: string[];
  totalPaidPence: number;
  paymentCount: number;
};

/** What the charity already knows about, from its own database. */
export type KnownRecords = {
  donorEmails: string[];
  /** Subscription ids already cited by a recorded donation. */
  subscriptionIds: string[];
};

export type UnrecordedCustomer = StripeCustomerSummary & {
  /**
   * false when the customer has no email, so no email comparison was possible. Reported anyway:
   * silently dropping it would hide real unrecorded income, which is the opposite of the job.
   */
  matchable: boolean;
};

/** Emails are compared case-insensitively and trimmed. The live data holds at least one donor in
 * capitals (RYAN@THEDESIGNERROOMS.COM), so comparing raw strings would report a supporter who is
 * already recorded, and an import built on that report would duplicate them. */
const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Stripe customers who have actually paid and whom the charity has no record of.
 *
 * A customer counts as recorded if EITHER their email matches a donor, OR one of their
 * subscriptions is already cited by a donation. The subscription is the stronger key: somebody may
 * have paid under one address and be recorded under another, and the money is what matters.
 *
 * Customers who have never paid are omitted. They are not missing income, and a report that lists
 * them alongside real gaps is a report people stop reading.
 */
export function findUnrecordedCustomers(
  customers: StripeCustomerSummary[],
  known: KnownRecords,
): UnrecordedCustomer[] {
  const knownEmails = new Set(known.donorEmails.map(normalise));
  const knownSubs = new Set(known.subscriptionIds);

  return customers
    .filter((c) => c.paymentCount > 0 && c.totalPaidPence > 0)
    .filter((c) => {
      if (c.subscriptionIds.some((s) => knownSubs.has(s))) return false;
      if (c.email && knownEmails.has(normalise(c.email))) return false;
      return true;
    })
    .map((c) => ({ ...c, matchable: Boolean(c.email) }))
    // Largest unrecorded amount first: the biggest discrepancy is the one to read.
    .sort((a, b) => b.totalPaidPence - a.totalPaidPence);
}
