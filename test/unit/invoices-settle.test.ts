import { describe, expect, it } from "vitest";
import { donationWrite, giftAidFrom, receiptPlan, settleKind } from "../../src/invoices/settle";

// What a payment on an invoice becomes (invented details throughout).

const ga = { firstName: "Sam", lastName: "Example", houseNameNumber: "1", address: "Made Up Street, Exampletown", postcode: "KA1 1AA", nonUk: false };

const person = {
  payerKind: "person" as const,
  contactName: "Sam Example",
  orgName: null,
  email: "sam@example.com",
  address: null,
  postcode: null,
  considerationGiven: null,
  amountPence: 2500,
  giftAid: ga as unknown,
};
const business = {
  ...person,
  payerKind: "business" as const,
  contactName: "Alex Sample",
  orgName: "Example Joinery Ltd",
  email: "accounts@example.com",
  address: "1 Made Up Street\nExampletown",
  postcode: "KA1 1AA",
  considerationGiven: false,
  amountPence: 50000,
};
const group = { ...business, payerKind: "group" as const, orgName: "Example Primary School", considerationGiven: null };

describe("which kind of payment this is", () => {
  it("is the payment while waiting, a second payment once paid, and a late one once cancelled", () => {
    expect(settleKind("waiting")).toBe("paid");
    expect(settleKind("paid")).toBe("paid-twice");
    expect(settleKind("cancelled")).toBe("paid-after-cancel");
  });
});

describe("Gift Aid", () => {
  it("is taken only from a person's saved declaration that is complete", () => {
    expect(giftAidFrom(person)).toEqual(ga);
    expect(giftAidFrom({ ...person, giftAid: null })).toBeNull();
    expect(giftAidFrom({ ...person, giftAid: { ...ga, postcode: "nonsense" } })).toBeNull();
  });
  it("is never taken for a business or a group, whatever is stored", () => {
    expect(giftAidFrom({ ...business, giftAid: ga })).toBeNull();
    expect(giftAidFrom({ ...group, giftAid: ga })).toBeNull();
  });
});

describe("the donation a payment becomes", () => {
  const pay = { sessionId: "cs_test_1", paymentIntentId: "pi_test_1" };

  it("is a person's one off, paid, online gift with their Gift Aid declaration", () => {
    const w = donationWrite(person, pay);
    expect(w.donor).toMatchObject({ fullName: "Sam Example", email: "sam@example.com", emailConsent: false });
    expect(w.donation).toMatchObject({
      donorType: "individual",
      mode: "once",
      amountPence: 2500,
      giftAid: true,
      paymentChannel: "online",
      paymentStatus: "paid",
      gasdsEligible: false,
      stripeSessionId: "cs_test_1",
      stripePaymentIntentId: "pi_test_1",
    });
    expect(w.declaration?.fields).toEqual(ga);
    expect(w.declaration?.scope).toBe("this_donation");
    expect(w.declaration?.wording.wording_version).toBe("hmrc-single-2024-01");
    expect(w.declaration?.confirmedTaxpayer).toBe(true);
  });

  it("is a person's gift without Gift Aid when none was saved", () => {
    const w = donationWrite({ ...person, giftAid: null }, { sessionId: null, paymentIntentId: null });
    expect(w.donation.giftAid).toBe(false);
    expect(w.declaration).toBeUndefined();
  });

  it("is a company gift for a business, with its name and billing address, and never Gift Aid", () => {
    const w = donationWrite(business, pay);
    expect(w.donation.donorType).toBe("company");
    expect(w.donation.giftAid).toBe(false);
    expect(w.declaration).toBeUndefined();
    expect(w.donor).toMatchObject({
      fullName: "Alex Sample",
      businessName: "Example Joinery Ltd",
      billingAddress: "1 Made Up Street\nExampletown",
      billingPostcode: "KA1 1AA",
    });
  });

  it("is a company gift for a group too, so it can never be claimed for Gift Aid", () => {
    const w = donationWrite(group, pay);
    expect(w.donation.donorType).toBe("company");
    expect(w.donation.giftAid).toBe(false);
    expect(w.declaration).toBeUndefined();
  });
});

describe("which receipt goes", () => {
  it("a person gets the usual receipt, a business the Corporation Tax one, a group the plain one", () => {
    expect(receiptPlan(person)).toBe("person");
    expect(receiptPlan(business)).toBe("business");
    expect(receiptPlan(group)).toBe("group");
  });
  it("a business we give something to is flagged for the trustees instead", () => {
    expect(receiptPlan({ ...business, considerationGiven: true })).toBe("trustees");
  });
});
