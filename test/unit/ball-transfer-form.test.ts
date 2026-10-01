// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-484: the Festive Ball booking form (ball.html with assets/js/ball.js), driven in jsdom with a
// stubbed fetch. Two things: the card fallback no longer leaves a second booking holding seats, and
// the "How would you like to pay?" choice for bank transfer, shown only once an admin switches it on.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "ball.html"), "utf8");
const js = readFileSync(resolve(ROOT, "assets/js/ball.js"), "utf8");
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let availability: Record<string, unknown> = {};
let checkoutAnswers: Array<{ status: number; body: unknown }> = [];
let transferAnswer: { status: number; body: unknown } = { status: 500, body: {} };

const answer = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = () => el<HTMLFormElement>("ballForm");

function fillIn() {
  const f = form();
  (f.elements.namedItem("buyerFirstName") as HTMLInputElement).value = "Ada";
  (f.elements.namedItem("buyerSurname") as HTMLInputElement).value = "Test";
  (f.elements.namedItem("buyerEmail") as HTMLInputElement).value = "ada@example.com";
  (f.elements.namedItem("termsAccepted") as HTMLInputElement).checked = true;
}
const submit = () => form().dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

beforeEach(async () => {
  calls = [];
  availability = { salesOpen: true, soldOut: false, seatsRemaining: 300, tablesRemaining: 30, transferOpen: false, cardFeePercentBp: 120, cardFeeFixedPence: 20 };
  checkoutAnswers = [];
  document.body.innerHTML = bodyHtml;
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true, addListener() {}, addEventListener() {} });
  // jsdom lays nothing out, so it has no scrollIntoView; the error box scrolls itself into view.
  Element.prototype.scrollIntoView = () => {};
  delete (window as unknown as { Stripe?: unknown }).Stripe;
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.includes("/api/ball/availability")) return answer(200, availability);
    if (url.includes("/api/ball/checkout-session")) {
      const next = checkoutAnswers.shift() ?? { status: 500, body: { error: "unexpected" } };
      return answer(next.status, next.body);
    }
    if (url.includes("/api/ball/bank-transfer")) return answer(transferAnswer.status, transferAnswer.body);
    return answer(404, {});
  });
  // eslint-disable-next-line no-eval
  (0, eval)(js);
  await flush();
});

// Reload the page's script with the feed saying what this test needs.
async function reload(feed: Record<string, unknown>) {
  availability = { ...availability, ...feed };
  document.body.innerHTML = bodyHtml;
  // eslint-disable-next-line no-eval
  (0, eval)(js);
  await flush();
}
const chooseTransfer = () => {
  const radio = form().querySelector('input[name="payMethod"][value="transfer"]') as HTMLInputElement;
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
};
const coverFeeLabel = () => (form().querySelector('input[name="coverFee"]') as HTMLInputElement).closest("label") as HTMLElement;

describe("paying by bank transfer, on the form (TASK-484)", () => {
  it("is not offered until an admin switches it on", async () => {
    expect(el("ballPayMethod").hidden).toBe(true);
    checkoutAnswers = [{ status: 201, body: { reference: "BALL-CCCCCC", totalPence: 10000, url: "https://checkout.stripe.com/c/pay/x" } }];
    fillIn();
    submit();
    await flush();
    expect(calls.some((c) => c.url.includes("/api/ball/checkout-session"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/api/ball/bank-transfer"))).toBe(false);
  });

  it("is offered once switched on, with card chosen first", async () => {
    await reload({ transferOpen: true });
    expect(el("ballPayMethod").hidden).toBe(false);
    expect((form().querySelector('input[name="payMethod"]:checked') as HTMLInputElement).value).toBe("card");
  });

  // No card, no card fee.
  it("drops the card fee, from the form and from the total", async () => {
    await reload({ transferOpen: true });
    const fee = form().querySelector('input[name="coverFee"]') as HTMLInputElement;
    fee.checked = true;
    fee.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el("ballTotal").textContent).not.toBe("£100");
    chooseTransfer();
    expect(coverFeeLabel().hidden).toBe(true);
    expect(fee.checked).toBe(false);
    expect(el("ballTotal").textContent).toBe("£100");
    expect(el("ballSubmit").textContent?.trim()).toBe("Book and get bank details");
  });

  it("goes back to card as it was", async () => {
    await reload({ transferOpen: true });
    chooseTransfer();
    const card = form().querySelector('input[name="payMethod"][value="card"]') as HTMLInputElement;
    card.checked = true;
    card.dispatchEvent(new Event("change", { bubbles: true }));
    expect(coverFeeLabel().hidden).toBe(false);
    expect(el("ballSubmit").textContent?.trim()).toBe("Continue to payment");
  });

  it("books, then shows everything needed to pay", async () => {
    await reload({ transferOpen: true });
    transferAnswer = {
      status: 201,
      body: {
        reference: "BALL-7KQ2MZ", totalPence: 10000, payBy: "2026-10-08",
        accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678",
      },
    };
    chooseTransfer();
    fillIn();
    submit();
    await flush();
    const post = calls.find((c) => c.url.includes("/api/ball/bank-transfer"));
    expect(post?.body).toMatchObject({ kind: "seat", quantity: 1, buyerFirstName: "Ada", buyerEmail: "ada@example.com", termsAccepted: true });
    expect(post?.body?.coverFee).toBeFalsy();
    expect(calls.some((c) => c.url.includes("/api/ball/checkout-session"))).toBe(false);

    const done = el("ballTransferDone");
    expect(done.hidden).toBe(false);
    expect(form().hidden).toBe(true);
    for (const part of ["BALL-7KQ2MZ", "£100.00", "Night Before Christmas Campaign", "12-34-56", "12345678", "Thursday 8 October"]) {
      expect(done.textContent, part).toContain(part);
    }
    expect(document.activeElement).toBe(el("ballTransferDoneHeading"));
  });

  it("says what went wrong, and keeps the form", async () => {
    await reload({ transferOpen: true });
    transferAnswer = { status: 409, body: { error: "There are not enough whole tables left for that booking" } };
    chooseTransfer();
    fillIn();
    submit();
    await flush();
    expect(el("ballError").hidden).toBe(false);
    expect(el("ballError").textContent).toBe("There are not enough whole tables left for that booking");
    expect(form().hidden).toBe(false);
    expect(el("ballTransferDone").hidden).toBe(true);
  });
});

describe("the card fallback (TASK-484)", () => {
  // The inline payment was created, then could not be shown. The fallback to Stripe's own page used
  // to make a second booking while the first went on holding seats for half an hour.
  it("tells the server which checkout it replaces", async () => {
    (window as unknown as { Stripe: unknown }).Stripe = () => ({
      initEmbeddedCheckout: () => Promise.reject(new Error("could not mount")),
    });
    checkoutAnswers = [
      { status: 201, body: { reference: "BALL-AAAAAA", totalPence: 10000, clientSecret: "cs_x_secret_y", publishableKey: "pk_test_x" } },
      { status: 201, body: { reference: "BALL-BBBBBB", totalPence: 10000, url: "https://checkout.stripe.com/c/pay/x" } },
    ];
    fillIn();
    submit();
    await flush();
    const posts = calls.filter((c) => c.url.includes("/api/ball/checkout-session"));
    expect(posts.length).toBe(2);
    expect(posts[0].body?.replaces).toBeUndefined();
    expect(posts[1].body?.replaces).toEqual({ reference: "BALL-AAAAAA", clientSecret: "cs_x_secret_y" });
  });

  // The server answers an inline request with Stripe's own page when it cannot embed: follow it,
  // rather than asking for a second checkout beside the first.
  it("follows the link it was given instead of making a second checkout", async () => {
    (window as unknown as { Stripe: unknown }).Stripe = () => ({ initEmbeddedCheckout: () => new Promise(() => {}) });
    checkoutAnswers = [{ status: 201, body: { reference: "BALL-DDDDDD", totalPence: 10000, url: "https://checkout.stripe.com/c/pay/x" } }];
    fillIn();
    submit();
    await flush();
    expect(calls.filter((c) => c.url.includes("/api/ball/checkout-session")).length).toBe(1);
  });

  it("replaces nothing when there was no inline checkout to replace", async () => {
    checkoutAnswers = [{ status: 201, body: { reference: "BALL-CCCCCC", totalPence: 10000, url: "https://checkout.stripe.com/c/pay/x" } }];
    fillIn();
    submit();
    await flush();
    const posts = calls.filter((c) => c.url.includes("/api/ball/checkout-session"));
    expect(posts.length).toBe(1);
    expect(posts[0].body?.replaces).toBeUndefined();
  });
});
