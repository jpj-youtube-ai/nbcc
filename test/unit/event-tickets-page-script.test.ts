// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderTicketsSection, renderTicketsThanks } from "../../src/tickets/render";
import { grossedUpFeePence } from "../../src/ball/pricing";

// Event tickets: the script on an event's page (assets/js/event-tickets.js). It shows the form, adds
// up the total as tickets are chosen (the card fee cover by the server's own sum), and sends the
// order to POST /api/event-tickets/:id/checkout, going on to Stripe. Every name here is invented.

const tickets = createRequire(import.meta.url)(resolve(__dirname, "../../assets/js/event-tickets.js")) as {
  initEventTickets: (doc: Document, win: unknown) => unknown;
  feeCoverPence: (pence: number, bp: number, fixed: number) => number;
};

const HTML = renderTicketsSection({
  state: "open",
  fundraiserId: 12,
  slug: "example-quiz",
  title: "Example Quiz Night",
  types: [
    { id: 1, name: "Adult", pricePence: 1000, remaining: 3, soldOut: false },
    { id: 2, name: "Child", pricePence: 550, remaining: null, soldOut: false },
  ],
  cardFee: { percentBp: 120, fixedPence: 20 },
});

type Win = { fetch: ReturnType<typeof vi.fn>; location: { assign: ReturnType<typeof vi.fn>; pathname: string; search: string; hash: string }; history: { replaceState: ReturnType<typeof vi.fn> } };
let win: Win;

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const answer = (status: number, data: unknown) => Promise.resolve({ status, json: () => Promise.resolve(data) });
const flush = () => new Promise((done) => setTimeout(done, 0));

function start(html = HTML) {
  document.body.innerHTML = html;
  win = { fetch: vi.fn(), location: { assign: vi.fn(), pathname: "/event/example-quiz", search: "", hash: "" }, history: { replaceState: vi.fn() } };
  tickets.initEventTickets(document, win);
}

function fill() {
  ($("#etFirstName") as HTMLInputElement).value = "Robin";
  ($("#etSurname") as HTMLInputElement).value = "Example";
  ($("#etEmail") as HTMLInputElement).value = "robin@example.com";
}

const plus = (id: number) => ($(`[data-et-type="${id}"] [data-et-step="1"]`) as HTMLButtonElement).click();
const submit = () => $("form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

beforeEach(() => start());

describe("the card fee cover sum", () => {
  it("is the server's own, to the penny", () => {
    for (const pence of [100, 550, 1000, 2550, 9999, 50000, 400000]) {
      expect(tickets.feeCoverPence(pence, 120, 20)).toBe(grossedUpFeePence(pence, { percentBp: 120, fixedPence: 20 }));
      expect(tickets.feeCoverPence(pence, 290, 30)).toBe(grossedUpFeePence(pence, { percentBp: 290, fixedPence: 30 }));
    }
    expect(tickets.feeCoverPence(0, 120, 20)).toBe(0);
  });
});

describe("choosing tickets", () => {
  it("shows the form, with nothing chosen and the button off", () => {
    expect(($("form") as HTMLFormElement).hidden).toBe(false);
    expect(($("[data-nojs]") as HTMLElement).hidden).toBe(true);
    expect($("[data-et-total]").textContent).toBe("£0");
    expect(($("[data-et-submit]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds up the total as tickets are added, and never past what is left", () => {
    plus(1);
    plus(2);
    expect($("[data-et-total]").textContent).toBe("£15.50");
    expect(($("[data-et-submit]") as HTMLButtonElement).disabled).toBe(false);
    plus(1);
    plus(1);
    plus(1);
    expect(($("#etQty-1") as HTMLInputElement).value).toBe("3");
    expect($('[data-et-type="1"]').classList.contains("is-chosen")).toBe(true);
  });

  it("shows the fee and adds it when covering the card fee", () => {
    plus(1);
    const box = $("#etCoverFee") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const fee = grossedUpFeePence(1000, { percentBp: 120, fixedPence: 20 });
    expect($("[data-et-fee]").textContent).toBe(`£${(fee / 100).toFixed(2)}`);
    expect($("[data-et-total]").textContent).toBe(`£${((1000 + fee) / 100).toFixed(2)}`);
  });
});

describe("buying", () => {
  it("asks for a name and email before sending anything", () => {
    plus(1);
    submit();
    expect(win.fetch).not.toHaveBeenCalled();
    expect($("[data-et-error]").textContent).toBe("Please tell us your first name, your surname and your email address.");
  });

  it("sends the order and goes on to Stripe", async () => {
    win.fetch.mockReturnValue(answer(200, { url: "https://checkout.stripe.test/pay/x" }));
    plus(1);
    plus(1);
    fill();
    submit();
    const [url, opts] = win.fetch.mock.calls[0];
    expect(url).toBe("/api/event-tickets/12/checkout");
    expect(JSON.parse(opts.body)).toEqual({
      lines: [{ typeId: 1, quantity: 2, pricePence: 1000 }],
      firstName: "Robin",
      lastName: "Example",
      email: "robin@example.com",
      phone: "",
      coverFee: false,
      company: "",
      captchaToken: "",
    });
    await flush();
    expect(win.location.assign).toHaveBeenCalledWith("https://checkout.stripe.test/pay/x");
  });

  it("says why when the tickets have gone, and reads what is left", async () => {
    win.fetch
      .mockReturnValueOnce(answer(409, { error: "Sorry, there is only 1 Adult ticket left.", refresh: true }))
      .mockReturnValueOnce(answer(200, { state: "open", types: [{ id: 1, name: "Adult", pricePence: 1000, remaining: 1, soldOut: false }, { id: 2, name: "Child", pricePence: 550, remaining: null, soldOut: false }] }));
    plus(1);
    plus(1);
    fill();
    submit();
    await flush();
    expect($("[data-et-error]").textContent).toBe("Sorry, there is only 1 Adult ticket left.");
    expect(win.fetch.mock.calls[1][0]).toBe("/api/event-tickets/12");
    expect(($("#etQty-1") as HTMLInputElement).max).toBe("1");
    expect(($("#etQty-1") as HTMLInputElement).value).toBe("1");
    expect(($("[data-et-submit]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's words for a field", async () => {
    win.fetch.mockReturnValue(answer(400, { error: "Some of the form needs another look", fields: { email: "Please check your email address." } }));
    plus(1);
    fill();
    submit();
    await flush();
    expect($("[data-et-error]").textContent).toBe("Please check your email address.");
  });
});

describe("the thank you after buying", () => {
  it("takes the payment's id out of the address bar", () => {
    document.body.innerHTML = renderTicketsThanks({ reference: "TIX-ABCDEF", paid: true }) + HTML;
    win = { fetch: vi.fn(), location: { assign: vi.fn(), pathname: "/event/example-quiz", search: "?tickets=thanks&ticket_session=cs_test_1", hash: "" }, history: { replaceState: vi.fn() } };
    tickets.initEventTickets(document, win);
    expect(win.history.replaceState).toHaveBeenCalledWith(null, "", "/event/example-quiz");
  });
});

describe("the spam check", () => {
  it("asks for the pass before sending, when the check is on", () => {
    start(HTML.replace("data-et-form ", 'data-et-form data-captcha-key="0x-site-key" '));
    plus(1);
    fill();
    submit();
    expect(win.fetch).not.toHaveBeenCalled();
    expect($("[data-et-error]").textContent).toBe("One moment: we are checking you are not a robot. Then press Buy tickets again.");
  });

  it("says when the server refused the pass", async () => {
    win.fetch.mockReturnValue(answer(400, { error: "captcha" }));
    plus(1);
    fill();
    submit();
    await flush();
    expect($("[data-et-error]").textContent).toBe("We could not check you are not a robot. Please try again.");
  });
});

describe("free tickets", () => {
  const FREE = renderTicketsSection({
    state: "open",
    fundraiserId: 12,
    slug: "example-quiz",
    title: "Example Quiz Night",
    types: [
      { id: 5, name: "Under 5", pricePence: 0, remaining: null, soldOut: false },
      { id: 1, name: "Adult", pricePence: 1000, remaining: null, soldOut: false },
    ],
    cardFee: { percentBp: 120, fixedPence: 20 },
  });

  it("say Free and Book tickets when there is nothing to pay, and Buy tickets once there is", () => {
    start(FREE);
    plus(5);
    expect($("[data-et-total]").textContent).toBe("Free");
    expect($("[data-et-submit]").textContent).toBe("Book tickets");
    expect(($("[data-et-submit]") as HTMLButtonElement).disabled).toBe(false);
    plus(1);
    expect($("[data-et-total]").textContent).toBe("£10");
    expect($("[data-et-submit]").textContent).toBe("Buy tickets");
  });

  it("are booked by the server and go straight to the thank you", async () => {
    start(FREE);
    win.fetch.mockReturnValue(answer(200, { url: "/event/example-quiz?tickets=thanks&ticket_session=cs_free_abc", free: true }));
    plus(5);
    fill();
    submit();
    expect(JSON.parse(win.fetch.mock.calls[0][1].body).lines).toEqual([{ typeId: 5, quantity: 1, pricePence: 0 }]);
    await flush();
    expect(win.location.assign).toHaveBeenCalledWith("/event/example-quiz?tickets=thanks&ticket_session=cs_free_abc");
  });
});
