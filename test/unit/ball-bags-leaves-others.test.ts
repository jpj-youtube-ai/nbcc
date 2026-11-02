import { describe, it, expect, vi, beforeEach } from "vitest";

// Red bags at the Festive Ball (/bag) adds one optional marker, ballBags, to the shared checkout.
// Jaimie's rule is that nothing else changes: these pin, field for field, the Stripe session that a
// donate page gift, a Ball donate page gift and a Fill a Red Bag gift made BEFORE the marker existed
// (the snapshots below were written by running this file against the code before the change), and
// what an ordinary gift that is refused is told. Every name and address here is invented.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
const cfg = vi.hoisted(() => ({
  STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
  STRIPE_CANCEL_URL: "https://nbcc.test/donate",
  STRIPE_DONATION_PRODUCT: undefined,
  STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
  PORTAL_BASE_URL: "https://nbcc.test/",
  ADMIN_SESSION_SECRET: "an-invented-secret-for-tests",
  NODE_ENV: "test",
}));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({ config: cfg }));

import { buildSessionParams, postCheckoutSession } from "../../src/routes/api";
import { DEFAULT_CARD_FEE } from "../../src/ball/pricing";

async function run(body: unknown) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body, headers: {} } as any, res as any);
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const params = (): any => create.mock.calls[create.mock.calls.length - 1][0];

const declaration = { firstName: "Alex", lastName: "Example", houseNameNumber: "12", address: "Example Street, Exampleton", postcode: "KA1 1AA" };
const gift = { mode: "once", plan: null, amount: 2500, giftAid: false, email: "alex@example.com", fullName: "Alex Example" };

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/1", client_secret: "s" });
});

describe("a donate page gift, after the Ball's red bags marker", () => {
  it("one off with Gift Aid, on Stripe's own page, is exactly as it was", async () => {
    const res = await run({ ...gift, giftAid: true, declaration });
    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({ url: "https://checkout.stripe.test/1" });
    expect(params()).toMatchInlineSnapshot(`
      {
        "cancel_url": "https://nbcc.test/donate",
        "customer_email": "alex@example.com",
        "line_items": [
          {
            "price_data": {
              "currency": "gbp",
              "product_data": {
                "name": "Donation to NBCC",
              },
              "unit_amount": 2500,
            },
            "quantity": 1,
          },
        ],
        "metadata": {
          "ageConfirmed": "false",
          "anonymous": "false",
          "businessName": "",
          "creditName": "",
          "declAddress": "Example Street, Exampleton",
          "declFirstName": "Alex",
          "declHouseNameNumber": "12",
          "declLastName": "Example",
          "declNonUk": "false",
          "declPostcode": "KA1 1AA",
          "declTitle": "",
          "declarationScope": "this_donation",
          "donorType": "individual",
          "email": "alex@example.com",
          "emailConsent": "false",
          "feeCoverPence": "0",
          "fullName": "Alex Example",
          "giftAid": "true",
          "giftAidWording": "I want to Gift Aid my donation to the Night Before Christmas Campaign. I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.",
          "giftAidWordingVersion": "hmrc-single-2024-01",
          "listOnSupporters": "false",
          "mode": "once",
          "plan": "",
        },
        "mode": "payment",
        "payment_method_types": [
          "card",
          "bacs_debit",
        ],
        "success_url": "https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}",
      }
    `);
  });

  it("one off with the card fee covered, on our page, is exactly as it was", async () => {
    const res = await run({ ...gift, coverFee: true, uiMode: "embedded" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({ clientSecret: "s", publishableKey: "pk_test_dummy_pk" });
    expect(params()).toMatchInlineSnapshot(`
      {
        "customer_email": "alex@example.com",
        "line_items": [
          {
            "price_data": {
              "currency": "gbp",
              "product_data": {
                "name": "Donation to NBCC",
              },
              "unit_amount": 2500,
            },
            "quantity": 1,
          },
          {
            "price_data": {
              "currency": "gbp",
              "product_data": {
                "description": "So your full gift reaches NBCC",
                "name": "Covering the card fee",
              },
              "unit_amount": 51,
            },
            "quantity": 1,
          },
        ],
        "metadata": {
          "ageConfirmed": "false",
          "anonymous": "false",
          "businessName": "",
          "creditName": "",
          "declarationScope": "this_donation",
          "donorType": "individual",
          "email": "alex@example.com",
          "emailConsent": "false",
          "feeCoverPence": "51",
          "fullName": "Alex Example",
          "giftAid": "false",
          "listOnSupporters": "false",
          "mode": "once",
          "plan": "",
        },
        "mode": "payment",
        "payment_method_types": [
          "card",
          "bacs_debit",
        ],
        "return_url": "https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}",
        "ui_mode": "embedded_page",
      }
    `);
  });

  it("monthly is exactly as it was", async () => {
    const res = await run({ ...gift, mode: "monthly", plan: "gold", ageConfirmed: true });
    expect(res.statusCode).toBe(200);
    expect(params()).toMatchInlineSnapshot(`
      {
        "cancel_url": "https://nbcc.test/donate",
        "customer_email": "alex@example.com",
        "line_items": [
          {
            "price_data": {
              "currency": "gbp",
              "product_data": {
                "name": "Monthly donation to NBCC",
              },
              "recurring": {
                "interval": "month",
              },
              "unit_amount": 2500,
            },
            "quantity": 1,
          },
        ],
        "metadata": {
          "ageConfirmed": "true",
          "anonymous": "false",
          "businessName": "",
          "creditName": "",
          "declarationScope": "enduring",
          "donorType": "individual",
          "email": "alex@example.com",
          "emailConsent": "false",
          "feeCoverPence": "0",
          "fullName": "Alex Example",
          "giftAid": "false",
          "listOnSupporters": "false",
          "mode": "monthly",
          "plan": "gold",
        },
        "mode": "subscription",
        "payment_method_types": [
          "card",
          "bacs_debit",
        ],
        "success_url": "https://nbcc.test/donate/thank-you?mode=monthly&donor=individual&session_id={CHECKOUT_SESSION_ID}",
      }
    `);
  });

  it("a gift with no amount is refused, and told exactly what it was told before", async () => {
    const res = await run({ mode: "once", plan: null, giftAid: false, email: "alex@example.com" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchInlineSnapshot(`
      {
        "details": {
          "fieldErrors": {
            "amount": [
              "Required",
            ],
          },
          "formErrors": [],
        },
        "error": "Invalid checkout request",
      }
    `);
    expect(create).not.toHaveBeenCalled();
  });

  it("a gift with an amount of null is refused, and told exactly what it was told before", async () => {
    const res = await run({ ...gift, amount: null });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchInlineSnapshot(`
      {
        "details": {
          "fieldErrors": {
            "amount": [
              "a one-off gift requires an amount",
            ],
          },
          "formErrors": [],
        },
        "error": "Invalid checkout request",
      }
    `);
  });
});

describe("a Ball donate page gift, after the Ball's red bags marker", () => {
  it("on Stripe's own page is exactly as it was", async () => {
    const res = await run({ ...gift, ball: true, giftAid: true, declaration });
    expect(res.statusCode).toBe(200);
    expect(params()).toMatchInlineSnapshot(`
      {
        "cancel_url": "https://nbcc.test/ball/donate",
        "customer_email": "alex@example.com",
        "line_items": [
          {
            "price_data": {
              "currency": "gbp",
              "product_data": {
                "name": "Donation to NBCC",
              },
              "unit_amount": 2500,
            },
            "quantity": 1,
          },
        ],
        "metadata": {
          "ageConfirmed": "false",
          "anonymous": "false",
          "ball": "true",
          "businessName": "",
          "creditName": "",
          "declAddress": "Example Street, Exampleton",
          "declFirstName": "Alex",
          "declHouseNameNumber": "12",
          "declLastName": "Example",
          "declNonUk": "false",
          "declPostcode": "KA1 1AA",
          "declTitle": "",
          "declarationScope": "this_donation",
          "donorType": "individual",
          "email": "alex@example.com",
          "emailConsent": "false",
          "feeCoverPence": "0",
          "fullName": "Alex Example",
          "giftAid": "true",
          "giftAidWording": "I want to Gift Aid my donation to the Night Before Christmas Campaign. I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.",
          "giftAidWordingVersion": "hmrc-single-2024-01",
          "listOnSupporters": "false",
          "mode": "once",
          "plan": "",
        },
        "mode": "payment",
        "payment_method_types": [
          "card",
          "bacs_debit",
        ],
        "success_url": "https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}",
      }
    `);
  });

  it("on our page is exactly as it was", async () => {
    const res = await run({ ...gift, ball: true, uiMode: "embedded" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({ clientSecret: "s", publishableKey: "pk_test_dummy_pk" });
    expect(params()).toMatchInlineSnapshot(`
      {
        "customer_email": "alex@example.com",
        "line_items": [
          {
            "price_data": {
              "currency": "gbp",
              "product_data": {
                "name": "Donation to NBCC",
              },
              "unit_amount": 2500,
            },
            "quantity": 1,
          },
        ],
        "metadata": {
          "ageConfirmed": "false",
          "anonymous": "false",
          "ball": "true",
          "businessName": "",
          "creditName": "",
          "declarationScope": "this_donation",
          "donorType": "individual",
          "email": "alex@example.com",
          "emailConsent": "false",
          "feeCoverPence": "0",
          "fullName": "Alex Example",
          "giftAid": "false",
          "listOnSupporters": "false",
          "mode": "once",
          "plan": "",
        },
        "mode": "payment",
        "payment_method_types": [
          "card",
          "bacs_debit",
        ],
        "return_url": "https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}",
        "ui_mode": "embedded_page",
      }
    `);
  });
});

describe("a Fill a Red Bag gift, after the Ball's red bags marker", () => {
  it("is exactly as it was", () => {
    const p = buildSessionParams(
      { ...gift, mode: "once", amount: 5410, coverFee: false, uiMode: "hosted", donorType: "individual", redBag: true } as never,
      DEFAULT_CARD_FEE,
    );
    expect(p).toMatchInlineSnapshot(`
      {
        "cancel_url": "https://nbcc.test/fill",
        "customer_email": "alex@example.com",
        "line_items": [
          {
            "price_data": {
              "currency": "gbp",
              "product_data": {
                "name": "Donation to NBCC",
              },
              "unit_amount": 5410,
            },
            "quantity": 1,
          },
        ],
        "metadata": {
          "ageConfirmed": "false",
          "anonymous": "false",
          "businessName": "",
          "creditName": "",
          "declarationScope": "this_donation",
          "donorType": "individual",
          "email": "alex@example.com",
          "emailConsent": "false",
          "feeCoverPence": "0",
          "fullName": "Alex Example",
          "giftAid": "false",
          "listOnSupporters": "false",
          "mode": "once",
          "plan": "",
          "redBag": "true",
        },
        "mode": "payment",
        "payment_method_types": [
          "card",
          "bacs_debit",
        ],
        "success_url": "https://nbcc.test/fill/thank-you?session_id={CHECKOUT_SESSION_ID}",
      }
    `);
  });
});
