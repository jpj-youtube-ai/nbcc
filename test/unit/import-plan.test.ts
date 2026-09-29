import { describe, it, expect } from "vitest";
import { buildImportPlan, type StripeCustomerDetail, type Classification } from "../../src/reconcile/import-plan";

// TASK-430. Five paying Stripe customers have no record at all: 660 pounds since late May. They
// all signed up before this software existed (first commit 23 June), so Stripe took the money and
// nothing on this side ever heard.
//
// This decides what to create and who to contact. It is pure, because the decisions are the part
// worth being sure about: what goes into the charity's financial records, and which of four people
// who have heard nothing for four months gets which email.

const charge = (id: string, iso: string, pence = 1000) => ({
  id,
  paidAt: new Date(iso),
  amountPence: pence,
});

const rmc: StripeCustomerDetail = {
  id: "cus_UaUbc78CEaRp1S",
  email: "stephanie@rmcdoubleglazing.com",
  name: "RMC Double Glazing (Ayr) Ltd",
  subscriptionId: "sub_1TbJcw4nlOtH58iwFa0PZW8h",
  charges: [
    charge("ch_1", "2026-05-26T11:58:00Z", 10000),
    charge("ch_2", "2026-06-26T12:59:00Z", 10000),
    charge("ch_3", "2026-07-26T12:59:00Z", 10000),
    charge("ch_4", "2026-08-26T12:59:00Z", 10000),
    charge("ch_5", "2026-09-26T12:58:00Z", 10000),
  ],
};

const fiona: StripeCustomerDetail = {
  id: "cus_UXrjR8e2vFKMWs",
  email: "fionamcilloney@btinternet.com",
  name: "Fiona McIlloney",
  subscriptionId: "sub_1TYm0P4nlOtH58iw4rtKst11",
  charges: [charge("ch_f1", "2026-05-20T10:00:00Z"), charge("ch_f2", "2026-06-20T10:00:00Z")],
};

const asCompany: Classification = { kind: "company", band: "platinum" };
const asIndividual: Classification = { kind: "individual" };

describe("what gets created", () => {
  it("records one donation per Stripe charge, on the day it actually happened", () => {
    const plan = buildImportPlan([{ customer: rmc, classification: asCompany }]);
    const [entry] = plan.entries;

    expect(entry.donations).toHaveLength(5);
    expect(entry.donations[0].paidAt.toISOString()).toBe("2026-05-26T11:58:00.000Z");
    expect(entry.donations[4].paidAt.toISOString()).toBe("2026-09-26T12:58:00.000Z");
    // Today's date would be a lie in the charity's accounts, which is the whole reason this
    // needs its own write path rather than the ordinary one.
    expect(entry.donations.every((d) => d.paidAt.getFullYear() === 2026)).toBe(true);
  });

  it("carries the Stripe charge id on every donation, so a second run cannot double-count", () => {
    const plan = buildImportPlan([{ customer: rmc, classification: asCompany }]);
    expect(plan.entries[0].donations.map((d) => d.stripeChargeId)).toEqual([
      "ch_1", "ch_2", "ch_3", "ch_4", "ch_5",
    ]);
  });

  // The donations table has CHECK (mode IN ('once','monthly')). The first version of this import
  // hardcoded 'subscription' in the INSERT, which is not one of them, so every row was rejected and
  // the whole run failed against production. These four tests exist so that cannot come back.
  it("records a subscription charge as monthly, which is a word the schema accepts", () => {
    const plan = buildImportPlan([{ customer: rmc, classification: asCompany }]);
    expect(plan.entries[0].donations.every((d) => d.mode === "monthly")).toBe(true);
  });

  it("records a charge with no subscription behind it as a one-off", () => {
    const oneOff: StripeCustomerDetail = { ...fiona, subscriptionId: null };
    const plan = buildImportPlan([{ customer: oneOff, classification: asIndividual }]);
    expect(plan.entries[0].donations.every((d) => d.mode === "once")).toBe(true);
  });

  it("never produces a mode the database would reject", () => {
    const plan = buildImportPlan([
      { customer: rmc, classification: asCompany },
      { customer: fiona, classification: asIndividual },
      { customer: { ...fiona, id: "cus_x", subscriptionId: null }, classification: asIndividual },
    ]);
    const modes = new Set(plan.entries.flatMap((e) => e.donations.map((d) => d.mode)));
    // Exactly the constraint in migrations/1782923222001_unified-donation-model.js.
    for (const m of modes) expect(["once", "monthly"]).toContain(m);
  });

  // The band reaches a column with CHECK (band IN ('bronze','silver','gold','platinum')). A typo
  // used to be possible because the planner took a plain string; it is a SupporterBand now, so this
  // is belt and braces — but the import already failed twice in production on exactly this class of
  // mistake, where a value the schema rejects is only found out at the INSERT.
  it("only ever plans a supporter band the database will accept", () => {
    const plan = buildImportPlan([{ customer: rmc, classification: asCompany }]);
    expect(["bronze", "silver", "gold", "platinum"]).toContain(plan.entries[0].fulfilment?.band);
  });

  it("totals what it is about to record, so the number can be checked against Stripe", () => {
    const plan = buildImportPlan([
      { customer: rmc, classification: asCompany },
      { customer: fiona, classification: asIndividual },
    ]);
    expect(plan.totalPence).toBe(50000 + 2000);
    expect(plan.donationCount).toBe(7);
  });
});

describe("a company supporter", () => {
  const plan = buildImportPlan([{ customer: rmc, classification: asCompany }]);
  const entry = plan.entries[0];

  it("is recorded as a company with its trading name", () => {
    expect(entry.donor.donorType).toBe("company");
    expect(entry.donor.businessName).toBe("RMC Double Glazing (Ayr) Ltd");
  });

  it("gets a supporter record so it can be listed and badged", () => {
    expect(entry.fulfilment).toEqual({ band: "platinum" });
  });

  it("is invited as a business supporter, not thanked as an individual", () => {
    expect(entry.emails).toEqual(["business-invite"]);
  });

  // Companies cannot Gift Aid. Asking them to declare would be both wrong and embarrassing.
  it("is never asked for a Gift Aid declaration", () => {
    expect(entry.emails).not.toContain("gift-aid-invite");
    expect(entry.donations.every((d) => d.giftAid === false)).toBe(true);
  });
});

describe("an individual supporter", () => {
  const plan = buildImportPlan([{ customer: fiona, classification: asIndividual }]);
  const entry = plan.entries[0];

  it("is recorded as an individual, with no business name", () => {
    expect(entry.donor.donorType).toBe("individual");
    expect(entry.donor.businessName).toBeNull();
  });

  it("gets no supporter record, because that is a business thing", () => {
    expect(entry.fulfilment).toBeNull();
  });

  it("is thanked and invited to add Gift Aid, in that order", () => {
    expect(entry.emails).toEqual(["thank-you", "gift-aid-invite"]);
  });

  // The declaration is the donor's own statement to HMRC. Recording one on their behalf would be
  // fabricating a legal document, so the import only ever INVITES.
  it("never has a Gift Aid declaration created for them", () => {
    expect(entry.donations.every((d) => d.giftAid === false)).toBe(true);
    expect(entry).not.toHaveProperty("declaration");
  });
});

describe("the charity's own test payment", () => {
  const self: StripeCustomerDetail = {
    id: "cus_UXYZYfBAhV9Y70",
    email: "admin@nightbeforechristmas.co.uk",
    name: "Jaimie Wakefield",
    subscriptionId: "sub_1TYTSK4nlOtH58iw2CnTXHsw",
    charges: [charge("ch_self", "2026-05-21T09:00:00Z")],
  };

  it("is still recorded, because the money genuinely left a card", () => {
    const plan = buildImportPlan([{ customer: self, classification: { kind: "individual", suppressEmails: true } }]);
    expect(plan.entries[0].donations).toHaveLength(1);
    expect(plan.totalPence).toBe(1000);
  });

  // Emailing the charity a thank-you for its own test, and inviting it to Gift Aid it, is noise.
  it("sends nothing, because thanking yourself is not correspondence", () => {
    const plan = buildImportPlan([{ customer: self, classification: { kind: "individual", suppressEmails: true } }]);
    expect(plan.entries[0].emails).toEqual([]);
  });
});

describe("refusing to guess", () => {
  it("will not import a customer with no email, because it cannot be contacted or matched", () => {
    const noEmail: StripeCustomerDetail = { ...fiona, email: null };
    const plan = buildImportPlan([{ customer: noEmail, classification: asIndividual }]);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped).toEqual([{ id: noEmail.id, reason: "no email address" }]);
  });

  it("will not import a customer with no successful payments", () => {
    const unpaid: StripeCustomerDetail = { ...fiona, charges: [] };
    const plan = buildImportPlan([{ customer: unpaid, classification: asIndividual }]);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/no .*payments/i);
  });

  it("will not create a company without a name to record it under", () => {
    const nameless: StripeCustomerDetail = { ...rmc, name: null };
    const plan = buildImportPlan([{ customer: nameless, classification: asCompany }]);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/name/i);
  });
});
