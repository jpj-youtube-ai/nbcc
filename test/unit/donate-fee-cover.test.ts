import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-321: donors may offer to cover Stripe's card fee.
//
// The money it raises is NOT a gift, and almost everything here exists to keep it from being
// mistaken for one. Two consequences if it were:
//
//   - Gift Aid would be claimed on it. That is an HMRC matter, not a rounding one.
//   - A £30 donation with fee cover on top would breach the GASDS £30 ceiling and silently
//     drop out of the small-donations scheme.

vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
  stripeConfigured: false,
}));
vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined as string | undefined,
    NODE_ENV: "test",
  },
}));

const { donationFeeCoverPence, buildSessionParams } = await import("../../src/routes/api");
const { feeCoverFromMetadata, donationFromCheckoutSession } = await import(
  "../../src/db/stripe-webhook-model"
);
const { DEFAULT_CARD_FEE_BP, DEFAULT_CARD_FEE_FIXED_PENCE } = await import("../../src/ball/pricing");

const RATE = { percentBp: 120, fixedPence: 20 };
const once = {
  mode: "once" as const,
  plan: null,
  amount: 5_000,
  giftAid: false,
  coverFee: true,
  uiMode: "hosted" as const,
  donorType: "individual" as const,
};

describe("donationFeeCoverPence", () => {
  it("is 1.2% + 20p, rounded up, on a one-off gift", () => {
    // TASK-348: grossed up. 80p was the fee on the GIFT, but Stripe charges its percentage on
      // the total it processes - which includes the fee - so covering 80p left the charity a
      // penny short of £50. 81p is the figure that nets £50 exactly.
    expect(donationFeeCoverPence(once, RATE)).toBe(81);
  });

  it("is nothing when the donor did not offer", () => {
    expect(donationFeeCoverPence({ ...once, coverFee: false }, RATE)).toBe(0);
  });

  // A monthly gift is charged again every month, so a recurring fee cover would have to be
  // split back out of every renewal invoice and every later claim. Offering it and getting it
  // wrong would corrupt a claim twelve times a year rather than once.
  it("is never charged on a monthly gift, even if the flag arrives set", () => {
    expect(donationFeeCoverPence({ ...once, mode: "monthly" }, RATE)).toBe(0);
  });

  it("is nothing when there is no amount to compute it from", () => {
    expect(donationFeeCoverPence({ ...once, amount: null }, RATE)).toBe(0);
  });
});

describe("the donation session", () => {
  it("puts the fee cover on its OWN line, so the donor sees what each part is", () => {
    const p = buildSessionParams(once, RATE);
    expect(p.line_items).toHaveLength(2);
    expect(p.line_items![1].price_data!.unit_amount).toBe(81);
    expect(p.line_items![1].price_data!.product_data!.name).toMatch(/card fee/i);
  });

  it("leaves the gift line at exactly what the donor chose", () => {
    const p = buildSessionParams(once, RATE);
    expect(p.line_items![0].price_data!.unit_amount).toBe(5_000);
  });

  it("is a single line when the fee is not covered — unchanged from before", () => {
    const p = buildSessionParams({ ...once, coverFee: false }, RATE);
    expect(p.line_items).toHaveLength(1);
    expect(p.metadata!.feeCoverPence).toBe("0");
  });

  // Stripe's amount_total is the sum of every line item, so the webhook has to be told what to
  // subtract. Without this stamp the fee cover is recorded as part of the gift.
  it("stamps the fee cover on the metadata for the webhook to subtract", () => {
    expect(buildSessionParams(once, RATE).metadata!.feeCoverPence).toBe("81");
  });

  it("never adds a fee line to a monthly subscription", () => {
    const p = buildSessionParams({ ...once, mode: "monthly", plan: null }, RATE);
    expect(p.line_items).toHaveLength(1);
    expect(p.metadata!.feeCoverPence).toBe("0");
  });
});

describe("feeCoverFromMetadata", () => {
  it("reads the stamped value", () => {
    expect(feeCoverFromMetadata({ feeCoverPence: "80" })).toBe(80);
  });

  // Fails to ZERO on anything unreadable. A wrong zero over-claims a few pence of Gift Aid; a
  // wrong LARGE value would subtract real donation money out of the record. Only one of those
  // loses the donor's money, so that is the one made impossible.
  it.each([
    ["absent", undefined],
    ["empty", { feeCoverPence: "" }],
    ["not a number", { feeCoverPence: "nonsense" }],
    ["negative", { feeCoverPence: "-500" }],
    ["fractional", { feeCoverPence: "12.5" }],
    ["null metadata", null],
  ])("is zero when the value is %s", (_label, metadata) => {
    expect(feeCoverFromMetadata(metadata as never)).toBe(0);
  });
});

describe("the figure the donate page shows before the server answers", () => {
  // main.js hard-codes the rate so the amount can update as the donor changes their gift. The
  // server prices the actual charge, so a stale display is a penny out rather than a mis-charge
  // — but it should still not silently disagree with the default it is copied from.
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const mainJs = readFileSync(resolve(ROOT, "assets/js/main.js"), "utf8");

  it("matches the server's default rate", () => {
    expect(mainJs).toContain(`var CARD_FEE_BP = ${DEFAULT_CARD_FEE_BP};`);
    expect(mainJs).toContain(`var CARD_FEE_FIXED_PENCE = ${DEFAULT_CARD_FEE_FIXED_PENCE};`);
  });
});

describe("what gets RECORDED as the donation", () => {
  // The whole point. Stripe's amount_total is the sum of every line item, so a £50 gift with
  // 80p of fee cover arrives as 5080. Recording that as the donation would claim Gift Aid on
  // the 80p and, at the GASDS boundary, push a £30 gift out of the small-donations scheme.
  const session = (amountTotal: number, feeCover: string) =>
    ({
      id: "cs_test_1",
      amount_total: amountTotal,
      currency: "gbp",
      payment_status: "paid",
      metadata: { mode: "once", giftAid: "true", donorType: "individual", feeCoverPence: feeCover },
      customer_details: { name: "Jo Smith", email: "jo@example.com" },
      payment_intent: "pi_1",
      subscription: null,
    }) as never;

  it("records the gift WITHOUT the fee cover, and keeps the fee cover beside it", () => {
    const write = donationFromCheckoutSession(session(5_080, "80"));
    expect(write.donation.amountPence).toBe(5_000);
    expect(write.donation.feeCoverPence).toBe(80);
  });

  it("is unchanged for a gift with no fee cover", () => {
    const write = donationFromCheckoutSession(session(5_000, "0"));
    expect(write.donation.amountPence).toBe(5_000);
    expect(write.donation.feeCoverPence).toBe(0);
  });

  // The boundary that matters: GASDS is judged per donation against £30.
  it("keeps a £30 gift at £30 so it stays inside the GASDS ceiling", () => {
    const write = donationFromCheckoutSession(session(3_056, "56"));
    expect(write.donation.amountPence).toBe(3_000);
  });
});
