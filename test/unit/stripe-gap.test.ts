import { describe, it, expect } from "vitest";
import { findUnrecordedCustomers, type StripeCustomerSummary, type KnownRecords } from "../../src/reconcile/stripe-gap";

// TASK-429. RMC Double Glazing (Ayr) Ltd has paid 100 pounds a month since 26 May 2026. Five
// payments, 500 pounds, and the charity has no record of any of it: no donor, no donations, no
// supporter listing, and no contact with them since they signed up.
//
// The cause is simply that they signed up before this software existed. The first commit in this
// repository is 23 June; they started paying on 26 May. Stripe took the money and there was
// nothing on this side to hear about it.
//
// Which raises the real question: who ELSE? This compares what Stripe is charging against what the
// charity has recorded, so the answer stops being a guess.

const RMC: StripeCustomerSummary = {
  id: "cus_UaUbc78CEaRp1S",
  email: "stephanie@rmcdoubleglazing.com",
  name: "RMC Double Glazing (Ayr) Ltd",
  subscriptionIds: ["sub_rmc"],
  totalPaidPence: 50000,
  paymentCount: 5,
};

const known = (over: Partial<KnownRecords> = {}): KnownRecords => ({
  donorEmails: [],
  subscriptionIds: [],
  ...over,
});

describe("finding customers Stripe charges that the charity has never recorded", () => {
  it("flags a paying customer with no donor and no known subscription", () => {
    const gaps = findUnrecordedCustomers([RMC], known());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      id: "cus_UaUbc78CEaRp1S",
      totalPaidPence: 50000,
      paymentCount: 5,
    });
  });

  it("says nothing about a customer whose email is already a donor", () => {
    expect(
      findUnrecordedCustomers([RMC], known({ donorEmails: ["stephanie@rmcdoubleglazing.com"] })),
    ).toEqual([]);
  });

  // THE trap, and it is in the live data. One donor is stored as RYAN@THEDESIGNERROOMS.COM in
  // capitals. Comparing raw strings would report that supporter as unrecorded, and an import
  // built on that report would duplicate a donor who is already there.
  it("matches emails regardless of case, because the live data has a donor in capitals", () => {
    const ryan: StripeCustomerSummary = {
      id: "cus_ryan",
      email: "ryan@thedesignerrooms.com",
      name: "The Designer Rooms",
      subscriptionIds: ["sub_ryan"],
      totalPaidPence: 10000,
      paymentCount: 1,
    };
    expect(
      findUnrecordedCustomers([ryan], known({ donorEmails: ["RYAN@THEDESIGNERROOMS.COM"] })),
    ).toEqual([]);
  });

  it("ignores stray whitespace around an email", () => {
    expect(
      findUnrecordedCustomers([RMC], known({ donorEmails: ["  stephanie@rmcdoubleglazing.com  "] })),
    ).toEqual([]);
  });

  // A donor may have paid under one address and be recorded under another, so the subscription is
  // the stronger key: if a donation already cites it, the money is recorded whatever the email says.
  it("treats a known subscription as recorded even when the email differs", () => {
    expect(findUnrecordedCustomers([RMC], known({ subscriptionIds: ["sub_rmc"] }))).toEqual([]);
  });

  // Somebody who set up a card and never paid is not missing money, and putting them in a "you
  // have unrecorded income" report would teach the reader to ignore it.
  it("ignores a customer who has never actually paid", () => {
    const browsing: StripeCustomerSummary = {
      id: "cus_never_paid",
      email: "someone@example.com",
      name: "Someone",
      subscriptionIds: [],
      totalPaidPence: 0,
      paymentCount: 0,
    };
    expect(findUnrecordedCustomers([browsing], known())).toEqual([]);
  });

  // Rare, but a Stripe customer can exist with no email. It cannot be matched, and silently
  // dropping it would hide real unrecorded money, so it is reported and flagged as unmatchable.
  it("reports a paying customer with no email rather than silently dropping it", () => {
    const anon: StripeCustomerSummary = {
      id: "cus_no_email",
      email: null,
      name: "No Email Ltd",
      subscriptionIds: ["sub_x"],
      totalPaidPence: 20000,
      paymentCount: 2,
    };
    const gaps = findUnrecordedCustomers([anon], known());
    expect(gaps).toHaveLength(1);
    expect(gaps[0].matchable).toBe(false);
  });

  it("sorts the biggest unrecorded amounts first, so the worst gap is read first", () => {
    const small: StripeCustomerSummary = { ...RMC, id: "cus_small", email: "a@b.c", totalPaidPence: 1000, paymentCount: 1, subscriptionIds: [] };
    const gaps = findUnrecordedCustomers([small, RMC], known());
    expect(gaps.map((g) => g.id)).toEqual(["cus_UaUbc78CEaRp1S", "cus_small"]);
  });

  it("returns nothing at all when everything reconciles", () => {
    expect(
      findUnrecordedCustomers([RMC], known({ donorEmails: ["stephanie@rmcdoubleglazing.com"] })),
    ).toEqual([]);
  });
});
