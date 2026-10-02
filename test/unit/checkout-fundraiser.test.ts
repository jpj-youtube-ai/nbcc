import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-493: giving on a fundraiser's page goes through the same POST /api/checkout-session as the
// donate page, with three more fields: fundraiserId, a short supporter message, and whether to show
// the giver's name (and the amount) on the supporter wall. One off gifts only, £2 at least. Without
// fundraiserId, the session is EXACTLY what it was before: the donate page must not change.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined,
    STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
    NODE_ENV: "test",
  },
}));

import { postCheckoutSession } from "../../src/routes/api";

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
const run = async (body: unknown): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body } as any, res as any);
  return res;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lastParams = (): any => create.mock.calls[create.mock.calls.length - 1][0];

const gift = { mode: "once", plan: null, amount: 2500, giftAid: false, email: "alex@example.com", fullName: "Alex Example" };

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/test_1", client_secret: "s" });
});

describe("a gift on a fundraiser's page", () => {
  it("carries the fundraiser, the message and the wall choices to the webhook", async () => {
    const res = await run({ ...gift, fundraiserId: 7, supporterMessage: "  Go Robin!  ", showName: false, showAmount: true });
    expect(res.statusCode).toBe(200);
    expect(lastParams().metadata).toMatchObject({
      fundraiserId: "7",
      supporterMessage: "Go Robin!",
      showName: "false",
      showAmount: "true",
    });
  });

  it("shows the name and the amount unless asked not to", async () => {
    await run({ ...gift, fundraiserId: 7 });
    expect(lastParams().metadata).toMatchObject({ fundraiserId: "7", supporterMessage: "", showName: "true", showAmount: "true" });
  });

  it.each([
    ["a monthly gift", { mode: "monthly", plan: "bronze", ageConfirmed: true }],
    ["a message over 200 characters", { supporterMessage: "a".repeat(201) }],
    ["a fundraiser id that is not one", { fundraiserId: -1 }],
    ["a fundraiser id in fractions", { fundraiserId: 1.5 }],
    ["less than £2", { amount: 150 }],
    ["a message with a word we would not put on the wall", { supporterMessage: "Go on you shite" }],
  ])("refuses %s", async (_what, over) => {
    const res = await run({ ...gift, fundraiserId: 7, ...over });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("a wall message we would not show", () => {
  it("is refused with friendly words, as a supporters wall name is", async () => {
    const res = await run({ ...gift, fundraiserId: 7, supporterMessage: "Go on you shite" });
    expect(res.statusCode).toBe(400);
    const details = (res.body as { details: { fieldErrors: Record<string, string[]> } }).details;
    expect(details.fieldErrors.supporterMessage[0]).toBe("Please choose different words for your message on the supporter wall.");
  });
});

describe("the donate page, without a fundraiser", () => {
  it("builds exactly the session it built before", async () => {
    await run(gift);
    const before = lastParams();
    // The wall fields mean nothing without a fundraiser, so they are dropped rather than stamped.
    await run({ ...gift, supporterMessage: "Hello", showName: false, showAmount: false });
    const after = lastParams();
    expect(after).toEqual(before);
    for (const key of ["fundraiserId", "supporterMessage", "showName", "showAmount"]) {
      expect(Object.keys(before.metadata)).not.toContain(key);
    }
  });

  it("still takes a monthly gift", async () => {
    const res = await run({ ...gift, mode: "monthly", plan: "bronze", amount: 1000, ageConfirmed: true });
    expect(res.statusCode).toBe(200);
    expect(lastParams().mode).toBe("subscription");
  });

  it("still takes a gift under £2", async () => {
    expect((await run({ ...gift, amount: 100 })).statusCode).toBe(200);
  });
});

// TASK-493: a supporter who ticks the newsletter box when giving on a fundraiser's page is handled
// exactly like a donate page giver: the same emailConsent field, stamped the same way.
describe("the newsletter tick box when giving on a fundraiser's page", () => {
  it.each([true, false])("stamps emailConsent %s exactly as the donate page does", async (consent) => {
    await run({ ...gift, emailConsent: consent });
    const donatePage = lastParams().metadata.emailConsent;
    await run({ ...gift, emailConsent: consent, fundraiserId: 7 });
    expect(lastParams().metadata.emailConsent).toBe(donatePage);
    expect(donatePage).toBe(String(consent));
  });
});
