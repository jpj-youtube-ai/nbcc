// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderBallDonatePage } from "../../src/ball/donate-page";

// The Festive Ball's donate page script (assets/js/ball-donate.js), driven in jsdom over the page as
// the server draws it. It shows the form, keeps the amount, the button and the Gift Aid questions in
// step, and sends a once only gift to the donate page's checkout with the marker ball: true. Every
// name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initBallDonate } = require(resolve(ROOT, "assets/js/ball-donate.js")) as {
  initBallDonate: (doc: Document, win: unknown, nav?: { assign: (u: string) => void }) => { amount: () => number | null; payload: () => Record<string, unknown> } | null;
};
const page = renderBallDonatePage(readFileSync(resolve(ROOT, "ball-donate.html"), "utf8"));

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const type = (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string, on = true) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.checked = on;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const choose = (pence: number) => {
  const r = $<HTMLInputElement>(`input[name="bdAmount"][value="${pence}"]`);
  r.checked = true;
  r.dispatchEvent(new Event("change", { bubbles: true }));
};
const fillDetails = () => {
  type("bdFirstName", "Robin");
  type("bdSurname", "Example");
  type("bdEmail", "robin@example.com");
};

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let api: ReturnType<typeof initBallDonate>;

beforeEach(() => {
  document.open();
  document.write(page);
  document.close();
  fetchMock = vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ url: "https://checkout.stripe.test/1" }) });
  assign = vi.fn();
  const win = { fetch: fetchMock, addEventListener: () => undefined, sessionStorage: null };
  api = initBallDonate(document, win, { assign });
});

describe("the form", () => {
  it("shows itself and hides the no script line", () => {
    expect($("#bdGiveForm").hidden).toBe(false);
    expect($("[data-nojs]").hidden).toBe(true);
  });

  it("takes a preset or your own amount, never both", () => {
    choose(2500);
    expect(api!.amount()).toBe(2500);
    type("bdOwnAmount", "12.50");
    expect(api!.amount()).toBe(1250);
    expect($<HTMLInputElement>('input[name="bdAmount"][value="2500"]').checked).toBe(false);
    choose(5000);
    expect($<HTMLInputElement>("#bdOwnAmount").value).toBe("");
    expect(api!.amount()).toBe(5000);
  });

  it("says the amount on the button and in the Gift Aid headline, and the card fee", () => {
    choose(2500);
    expect($("[data-give-submit]").textContent).toBe("Give £25 now");
    expect($("[data-giftaid-headline]").textContent).toBe("Make your £25 worth £31.25");
    expect($("[data-cover-fee-amount]").textContent).toBe("£0.50");
  });

  it("asks for the Gift Aid address only when Gift Aid is ticked, and the postcode only for a UK address", () => {
    expect($("#bdDeclaration").hidden).toBe(true);
    tick("bdGiftAid");
    expect($("#bdDeclaration").hidden).toBe(false);
    tick("bdNonUk");
    expect($("#bdPostcodeField").hidden).toBe(true);
    expect($<HTMLInputElement>("#bdPostcode").disabled).toBe(true);
  });
});

describe("what it sends", () => {
  it("a once only gift, marked as the Ball's, with no Gift Aid details when not ticked", () => {
    choose(2500);
    fillDetails();
    tick("bdCoverFee");
    expect(api!.payload()).toEqual({
      mode: "once",
      plan: null,
      amount: 2500,
      giftAid: false,
      coverFee: true,
      donorType: "individual",
      fullName: "Robin Example",
      email: "robin@example.com",
      emailConsent: false,
      ball: true,
    });
  });

  it("the one off declaration when Gift Aid is ticked", () => {
    choose(1000);
    fillDetails();
    tick("bdGiftAid");
    type("bdHouse", "12");
    type("bdAddress", "Example Street, Annbank");
    type("bdPostcode", "KA1 1AA");
    expect(api!.payload().declaration).toEqual({
      firstName: "Robin",
      lastName: "Example",
      houseNameNumber: "12",
      address: "Example Street, Annbank",
      nonUk: false,
      scope: "this_donation",
      postcode: "KA1 1AA",
    });
  });

  it("goes to the checkout and on to Stripe's page when it cannot open on this one", async () => {
    choose(2500);
    fillDetails();
    $<HTMLFormElement>("#bdGiveForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/checkout-session");
    expect(JSON.parse(init.body)).toMatchObject({ ball: true, mode: "once", amount: 2500 });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/1");
  });

  it("asks for an amount before anything is sent, and refuses less than £2", async () => {
    fillDetails();
    $<HTMLFormElement>("#bdGiveForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($("[data-give-error]").textContent).toContain("Please choose an amount");
    type("bdOwnAmount", "1.50");
    $<HTMLFormElement>("#bdGiveForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($("[data-give-error]").textContent).toContain("The smallest donation here is £2.");
  });

  it("says so when payment is not working, and the button can be pressed again", async () => {
    fetchMock.mockResolvedValue({ status: 502, json: () => Promise.resolve({}) });
    choose(2500);
    fillDetails();
    $<HTMLFormElement>("#bdGiveForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect($("[data-give-error]").textContent).toContain("Payment is not working just now");
    expect($<HTMLButtonElement>("[data-give-submit]").disabled).toBe(false);
  });
});
