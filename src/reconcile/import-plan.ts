// TASK-430: deciding what to record, and who to write to, for supporters the charity never knew it
// had.
//
// Five paying Stripe customers had no record at all: £660 since late May. They signed up before
// this software existed (the first commit here is dated 23 June), so Stripe took the money and
// nothing on this side ever heard. Three of them are individuals who have given £10 a month since
// May and received nothing back at all: no thank-you, no receipt, no Gift Aid request.
//
// Pure on purpose. The decisions here are the ones worth being certain about — what enters the
// charity's financial records, and which of four people who have heard silence for four months
// gets which email — so they are decided in a file with no database and no mail server in it.

export type StripeCharge = {
  id: string;
  paidAt: Date;
  amountPence: number;
};

export type StripeCustomerDetail = {
  id: string;
  email: string | null;
  name: string | null;
  subscriptionId: string | null;
  charges: StripeCharge[];
};

export type Classification =
  | { kind: "company"; band: string }
  | { kind: "individual"; suppressEmails?: boolean };

export type PlannedDonation = {
  amountPence: number;
  /** The day the money actually moved. Recording these as "today" would be a lie in the accounts. */
  paidAt: Date;
  stripeChargeId: string;
  stripeSubscriptionId: string | null;
  /**
   * "monthly" when the charge came from a subscription, "once" otherwise.
   *
   * The donations table has `CHECK (mode IN ('once','monthly'))`. The first attempt at this import
   * hardcoded "subscription", which is not one of them, and every insert was rejected — so the
   * decision lives here, in the tested planner, rather than as a literal inside the DB write.
   */
  mode: "once" | "monthly";
  /**
   * Always false. A Gift Aid declaration is the DONOR's statement to HMRC; creating one on their
   * behalf would be fabricating a legal document. Individuals are invited to declare instead, and
   * their declaration can cover past gifts if they choose that scope.
   */
  giftAid: false;
};

export type PlannedDonor = {
  donorType: "individual" | "company";
  fullName: string;
  businessName: string | null;
  email: string;
  stripeCustomerId: string;
};

/** Which already-existing email each person gets. Nothing new is written for this. */
export type PlannedEmail = "thank-you" | "gift-aid-invite" | "business-invite";

export type ImportEntry = {
  donor: PlannedDonor;
  donations: PlannedDonation[];
  /** Companies get a supporter record so they can be listed and badged. Individuals do not. */
  fulfilment: { band: string } | null;
  emails: PlannedEmail[];
};

export type ImportPlan = {
  entries: ImportEntry[];
  skipped: { id: string; reason: string }[];
  donationCount: number;
  totalPence: number;
};

export type ImportRequest = {
  customer: StripeCustomerDetail;
  classification: Classification;
};

/**
 * Work out everything that would be created and sent, without doing any of it.
 *
 * Refuses rather than guesses. A customer with no email cannot be contacted or matched later; a
 * customer with no successful payment is not missing income; a company with no name has nothing to
 * be recorded under. Each is skipped WITH a reason, because a silent omission in a financial
 * import is the failure mode that matters.
 */
export function buildImportPlan(requests: ImportRequest[]): ImportPlan {
  const entries: ImportEntry[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const { customer, classification } of requests) {
    if (!customer.email) {
      skipped.push({ id: customer.id, reason: "no email address" });
      continue;
    }
    if (customer.charges.length === 0) {
      skipped.push({ id: customer.id, reason: "no successful payments" });
      continue;
    }
    if (classification.kind === "company" && !customer.name) {
      skipped.push({ id: customer.id, reason: "company has no name to record it under" });
      continue;
    }

    const donations: PlannedDonation[] = customer.charges.map((c) => ({
      amountPence: c.amountPence,
      paidAt: c.paidAt,
      stripeChargeId: c.id,
      stripeSubscriptionId: customer.subscriptionId,
      // A charge tied to a subscription is a monthly gift; anything else is a one-off. These five
      // are all standing orders bar the charity's own test, so this is almost always "monthly" —
      // but deriving it beats assuming it, and the schema only accepts these two words.
      mode: customer.subscriptionId ? "monthly" : "once",
      giftAid: false,
    }));

    const isCompany = classification.kind === "company";
    const emails: PlannedEmail[] =
      isCompany
        ? ["business-invite"]
        : classification.suppressEmails
          ? []
          : ["thank-you", "gift-aid-invite"];

    entries.push({
      donor: {
        donorType: isCompany ? "company" : "individual",
        fullName: customer.name ?? customer.email,
        businessName: isCompany ? customer.name : null,
        email: customer.email,
        stripeCustomerId: customer.id,
      },
      donations,
      fulfilment: isCompany ? { band: classification.band } : null,
      emails,
    });
  }

  const donationCount = entries.reduce((n, e) => n + e.donations.length, 0);
  const totalPence = entries.reduce(
    (n, e) => n + e.donations.reduce((m, d) => m + d.amountPence, 0),
    0,
  );

  return { entries, skipped, donationCount, totalPence };
}
