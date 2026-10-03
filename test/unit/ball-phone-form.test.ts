// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Jaimie 2026-10-03: the Festive Ball booking form asks for the booker's phone number, required, so
// NBCC can contact them about menu choices for their table. ball.html with assets/js/ball.js in
// jsdom, with a stubbed fetch, like ball-transfer-form.test.ts. Every name and number is invented.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "ball.html"), "utf8");
const js = readFileSync(resolve(ROOT, "assets/js/ball.js"), "utf8");
const terms = readFileSync(resolve(ROOT, "ball-terms.html"), "utf8");
const privacy = readFileSync(resolve(ROOT, "privacy.html"), "utf8");
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let availability: Record<string, unknown> = {};

const answer = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = () => el<HTMLFormElement>("ballForm");
const phone = () => form().elements.namedItem("buyerPhone") as HTMLInputElement;

function fillIn(withPhone = "07700 900123") {
  const f = form();
  (f.elements.namedItem("buyerFirstName") as HTMLInputElement).value = "Ada";
  (f.elements.namedItem("buyerSurname") as HTMLInputElement).value = "Test";
  (f.elements.namedItem("buyerEmail") as HTMLInputElement).value = "ada@example.com";
  phone().value = withPhone;
  (f.elements.namedItem("termsAccepted") as HTMLInputElement).checked = true;
}
const submit = () => form().dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
const posts = () => calls.filter((c) => c.url.includes("/api/ball/checkout-session") || c.url.includes("/api/ball/bank-transfer"));

async function load(feed: Record<string, unknown> = {}) {
  availability = { salesOpen: true, soldOut: false, seatsRemaining: 300, tablesRemaining: 30, transferOpen: false, cardFeePercentBp: 120, cardFeeFixedPence: 20, ...feed };
  document.body.innerHTML = bodyHtml;
  // eslint-disable-next-line no-eval
  (0, eval)(js);
  await flush();
}

beforeEach(async () => {
  calls = [];
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true, addListener() {}, addEventListener() {} });
  Element.prototype.scrollIntoView = () => {};
  delete (window as unknown as { Stripe?: unknown }).Stripe;
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes("/api/ball/availability")) return answer(200, availability);
    if (url.includes("/api/ball/checkout-session")) {
      return answer(201, { reference: "BALL-CCCCCC", totalPence: 10000, url: "https://checkout.stripe.com/c/pay/x" });
    }
    if (url.includes("/api/ball/bank-transfer")) {
      return answer(201, { reference: "BALL-7KQ2MZ", totalPence: 10000, payBy: "2026-10-08", accountName: "N", sortCode: "12-34-56", accountNumber: "12345678" });
    }
    return answer(404, {});
  });
  await load();
});

describe("the phone number box on the booking form", () => {
  it("is labelled, explained, and set up for a phone keypad", () => {
    const input = phone();
    expect(input).not.toBeNull();
    expect(input.type).toBe("tel");
    expect(input.getAttribute("autocomplete")).toBe("tel");
    expect(input.getAttribute("inputmode")).toBe("tel");
    expect(input.required).toBe(true);
    expect(input.maxLength).toBe(40);
    const label = input.closest("label") as HTMLElement;
    expect(label.querySelector("span")?.textContent?.trim()).toBe("Your phone number");
    expect(label.textContent).toContain("So we can contact you about menu choices for your table.");
  });

  it("sits with the other details about the booker", () => {
    expect(phone().closest(".ball-row-fields")).toBe(
      (form().elements.namedItem("buyerEmail") as HTMLInputElement).closest(".ball-row-fields"),
    );
  });

  it("must be filled in before anything is sent", async () => {
    fillIn("");
    submit();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(el("ballError").hidden).toBe(false);
    expect(el("ballError").textContent).toBe("Please give your phone number, so we can contact you about menu choices for your table.");
  });

  it("must look like a phone number", async () => {
    fillIn("call me");
    submit();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(el("ballError").textContent).toBe("Please check your phone number. Use digits and spaces, for example 07700 900123.");
  });

  it("goes with a card booking", async () => {
    fillIn(" 07700 900123 ");
    submit();
    await flush();
    const post = calls.find((c) => c.url.includes("/api/ball/checkout-session"));
    expect(post?.body?.buyerPhone).toBe("07700 900123");
  });

  it("goes with a bank transfer booking", async () => {
    await load({ transferOpen: true });
    const radio = form().querySelector('input[name="payMethod"][value="transfer"]') as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    fillIn("01632 960123");
    submit();
    await flush();
    const post = calls.find((c) => c.url.includes("/api/ball/bank-transfer"));
    expect(post?.body?.buyerPhone).toBe("01632 960123");
  });
});

describe("what we say we do with it", () => {
  it("the ticket terms say it is for the booking and menu choices, stays with NBCC, and is not for marketing", () => {
    const section = terms
      .slice(terms.indexOf("<h2>Your information</h2>"), terms.indexOf("<h2>Photography"))
      .replace(/\s+/g, " ");
    expect(section).toMatch(/phone number/);
    expect(section).toMatch(/menu choices/);
    expect(section).toMatch(/not pass it to the venue or the organiser/);
    expect(section).toMatch(/never use it for marketing/);
  });

  it("the privacy notice lists a phone number among the contact details we may collect", () => {
    expect(privacy).toMatch(/your name and contact details, such as email address, phone number and postal address/);
  });
});
