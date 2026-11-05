// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderBallBagsPage, renderBallBagsThanks } from "../../src/ball/bags-page";

// Red bags at the Festive Ball: the page's script (assets/js/ball-bags.js), driven in jsdom over the
// page as the server draws it. It moves from the welcome to "how many", keeps the count, the bags
// drawn, the total and the button in step, opens Gift Aid's questions when it is ticked, and sends
// only a number of bags to the checkout (the server prices it). Every name and address is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
type Api = { count: () => number; payload: () => Record<string, unknown> } | null;
const { initBallBags } = require(resolve(ROOT, "assets/js/ball-bags.js")) as {
  initBallBags: (doc: Document, win: unknown, nav?: { assign: (u: string) => void }) => Api;
};

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const click = (id: string, times = 1) => {
  for (let i = 0; i < times; i += 1) (document.getElementById(id) as HTMLButtonElement).click();
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
const fillDetails = () => {
  type("bbFirstName", "Robin");
  type("bbSurname", "Example");
  type("bbEmail", "robin@example.com");
};
const text = (id: string) => (document.getElementById(id)?.textContent ?? "").replace(/\s+/g, " ").trim();
const give = () => {
  ($("#bbForm") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};
const sent = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let api: Api;

function load(html: string, reduce = true) {
  document.open();
  document.write(html);
  document.close();
  fetchMock = vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ url: "https://checkout.stripe.test/bags" }) });
  assign = vi.fn();
  const win = {
    fetch: fetchMock,
    addEventListener: () => undefined,
    matchMedia: () => ({ matches: reduce }),
    location: { pathname: "/bag", search: "", hash: "" },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    innerWidth: 390,
    // The page's own clock, looked up when called so a test's fake timers take it over.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  };
  api = initBallBags(document, win, { assign });
}

beforeEach(() => load(renderBallBagsPage()));

describe("the welcome", () => {
  it("throws a short burst of gold sparkles from Fill a bag, which takes itself away, and moves on at once", () => {
    vi.useFakeTimers();
    try {
      load(renderBallBagsPage(), false);
      click("bbStart");
      const burst = document.querySelector(".bb-burst");
      expect(burst).not.toBeNull();
      expect(burst?.getAttribute("aria-hidden")).toBe("true");
      expect(burst?.querySelectorAll("span").length).toBe(12);
      // Nothing waits for it: the next screen is already there.
      expect($("#bbHowMany").hidden).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(document.querySelector(".bb-burst")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws no sparkles for someone who asked for less motion", () => {
    click("bbStart");
    expect(document.querySelector(".bb-burst")).toBeNull();
  });

  it("shows the welcome first and moves to how many on Fill a bag, with the focus there", () => {
    expect($("#bbWelcome").hidden).toBe(false);
    expect($("#bbHowMany").hidden).toBe(true);
    click("bbStart");
    expect($("#bbWelcome").hidden).toBe(true);
    expect($("#bbHowMany").hidden).toBe(false);
    expect(document.activeElement?.id).toBe("bbHowManyTitle");
  });

  it("marks which screen the guest is on, so the snow stops once they are past the welcome", () => {
    click("bbStart");
    expect(document.body.getAttribute("data-bb-at")).toBe("how-many");
    click("bbBack");
    expect(document.body.getAttribute("data-bb-at")).toBe("welcome");
    const css = readFileSync(resolve(ROOT, "assets/css/ball-bags.css"), "utf8");
    expect(css).toContain('body[data-bb-at="how-many"] .bb-snow{display:none}');
  });
});

describe("how many bags", () => {
  beforeEach(() => click("bbStart"));

  it("starts at one bag, £50", () => {
    expect(api?.count()).toBe(1);
    expect(text("bbCount")).toBe("1");
    expect(text("bbWords")).toBe("1 full red bag");
    expect(text("bbTotal")).toBe("£50");
    expect(text("bbGive")).toBe("Give £50");
  });

  it("goes up with plus and keeps the words, the total and the button in step", () => {
    click("bbMore", 2);
    expect(api?.count()).toBe(3);
    expect(text("bbCount")).toBe("3");
    expect(text("bbWords")).toBe("3 full red bags");
    expect(text("bbTotal")).toBe("£150");
    expect(text("bbGive")).toBe("Give £150");
  });

  it("never goes below one", () => {
    click("bbLess", 3);
    expect(api?.count()).toBe(1);
    expect(text("bbWords")).toBe("1 full red bag");
  });

  it("never goes above twenty, £1,000", () => {
    click("bbMore", 25);
    expect(api?.count()).toBe(20);
    expect(text("bbTotal")).toBe("£1,000");
    expect(text("bbGive")).toBe("Give £1,000");
    click("bbLess");
    expect(api?.count()).toBe(19);
  });

  it("adds each new bag as a small copy of the bag's picture, popping in with a sparkle when motion is welcome", () => {
    load(renderBallBagsPage(), false);
    click("bbStart");
    click("bbMore");
    const bags = document.querySelectorAll("#bbRow .bb-bag");
    expect(bags.length).toBe(2);
    expect(bags[1].querySelector("img")?.getAttribute("src")).toBe("/assets/img/ball-bag-hero.webp");
    expect(bags[1].querySelector("img")?.getAttribute("alt")).toBe("");
    expect(bags[1].classList.contains("is-new")).toBe(true);
  });

  it("draws a bag for each, ten at most, then says how many more", () => {
    const drawn = () => document.querySelectorAll("#bbRow .bb-bag").length;
    expect(drawn()).toBe(1);
    click("bbMore", 2);
    expect(drawn()).toBe(3);
    click("bbMore", 11);
    expect(drawn()).toBe(10);
    expect($("#bbRowMore").hidden).toBe(false);
    expect(text("bbRowMore")).toBe("+4");
    click("bbLess", 4);
    expect(drawn()).toBe(10);
    expect($("#bbRowMore").hidden).toBe(true);
    click("bbLess", 9);
    expect(drawn()).toBe(1);
  });

  it("opens Gift Aid's questions only when it is ticked", () => {
    expect($("#bbDeclaration").hidden).toBe(true);
    expect(($("#bbHouse") as HTMLInputElement).disabled).toBe(true);
    tick("bbGiftAid");
    expect($("#bbDeclaration").hidden).toBe(false);
    expect(($("#bbHouse") as HTMLInputElement).disabled).toBe(false);
    tick("bbGiftAid", false);
    expect($("#bbDeclaration").hidden).toBe(true);
  });
});

describe("giving", () => {
  beforeEach(() => click("bbStart"));

  it("sends the number of bags and the guest's details, and no amount", async () => {
    click("bbMore", 2);
    fillDetails();
    give();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkout-session");
    const body = sent(fetchMock);
    expect(body.ballBags).toBe(3);
    expect(body.cameFrom).toBe("");
    expect(body.mode).toBe("once");
    expect(body.donorType).toBe("individual");
    expect(body.fullName).toBe("Robin Example");
    expect(body.email).toBe("robin@example.com");
    expect(body.giftAid).toBe(false);
    expect("amount" in body).toBe(false);
    expect("declaration" in body).toBe(false);
  });

  it("goes to Stripe's own page at the address the checkout returns", async () => {
    fillDetails();
    give();
    await flush();
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/bags");
  });

  it("sends the Gift Aid declaration only when Gift Aid is ticked", async () => {
    fillDetails();
    tick("bbGiftAid");
    type("bbHouse", "12");
    type("bbAddress", "Example Street, Exampletown");
    type("bbPostcode", "KA1 1AA");
    give();
    await flush();
    const body = sent(fetchMock);
    expect(body.giftAid).toBe(true);
    expect(body.declaration).toEqual({
      firstName: "Robin",
      lastName: "Example",
      houseNameNumber: "12",
      address: "Example Street, Exampletown",
      postcode: "KA1 1AA",
      nonUk: false,
      scope: "this_donation",
    });
  });

  it("asks again, sending nothing, when a detail is missing", async () => {
    type("bbFirstName", "Robin");
    give();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($("#bbStatus").classList.contains("is-error")).toBe(true);
    expect($("#bbSurname").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a plain message beside the button on a refusal, keeping everything typed", async () => {
    fetchMock.mockResolvedValue({ status: 400, json: () => Promise.resolve({ error: "Invalid checkout request" }) });
    click("bbMore");
    fillDetails();
    give();
    await flush();
    const status = $("#bbStatus");
    expect(status.hidden).toBe(false);
    expect(status.classList.contains("is-error")).toBe(true);
    expect(status.textContent?.length).toBeGreaterThan(10);
    expect(assign).not.toHaveBeenCalled();
    expect(($("#bbEmail") as HTMLInputElement).value).toBe("robin@example.com");
    expect(api?.count()).toBe(2);
    expect(($("#bbGive") as HTMLButtonElement).disabled).toBe(false);
    expect($("#bbGive").getAttribute("aria-disabled")).toBe("false");
    expect(text("bbGive")).toBe("Give £100");
  });

  it("announces a failed payment as an alert, with the focus still on the give button", async () => {
    fetchMock.mockResolvedValue({ status: 503, json: () => Promise.resolve({}) });
    fillDetails();
    const button = $<HTMLButtonElement>("#bbGive");
    button.focus();
    give();
    // While it waits the button is never disabled (that would drop the focus): it says it is busy.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
    await flush();
    const status = $("#bbStatus");
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.getAttribute("aria-live")).toBe("assertive");
    expect(status.textContent).toContain("Payment is not working just now");
    expect(document.activeElement).toBe(button);
  });

  it("sends nothing a second time while the first is still on its way", async () => {
    let answer: (v: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => (answer = r)));
    fillDetails();
    give();
    give();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer({ status: 200, json: () => Promise.resolve({ url: "https://checkout.stripe.test/bags" }) });
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("shows the email field's own message when the address has no dot after the @", async () => {
    type("bbFirstName", "Robin");
    type("bbSurname", "Example");
    type("bbEmail", "robin@example");
    give();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($("#bbEmail").getAttribute("aria-invalid")).toBe("true");
    expect(text("bbEmailError")).toBe("Please give an email address for your receipt");
  });

  it("shows a message too when the checkout is down or out of reach", async () => {
    fetchMock.mockResolvedValue({ status: 503, json: () => Promise.resolve({}) });
    fillDetails();
    give();
    await flush();
    expect($("#bbStatus").classList.contains("is-error")).toBe(true);
    fetchMock.mockRejectedValue(new Error("offline"));
    give();
    await flush();
    expect($("#bbStatus").classList.contains("is-error")).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("the thank you", () => {
  it("lands the focus on the heading and takes the payment's id out of the address bar", () => {
    document.open();
    document.write(renderBallBagsThanks(3));
    document.close();
    const replaceState = vi.fn();
    initBallBags(document, {
      addEventListener: () => undefined,
      matchMedia: () => ({ matches: true }),
      location: { pathname: "/bag/thank-you", search: "?session_id=cs_test_invented", hash: "" },
      history: { pushState: vi.fn(), replaceState },
      innerWidth: 390,
    });
    expect(document.activeElement?.id).toBe("bbThanksTitle");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/bag/thank-you");
  });
});
