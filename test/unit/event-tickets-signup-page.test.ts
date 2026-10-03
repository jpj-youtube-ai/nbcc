// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_MONEY_NOTE, COSTS_NOTE, NBCC_SELLS_LABEL } from "../../src/tickets/model";

// Event tickets on the sign up form (/fundraise): "How do people get in?" has a fourth answer, "NBCC
// sells the tickets for me", which says when to choose it and asks for the kinds of ticket (a name, a
// price, an optional number each) and an optional limit, sent with the sign up as ticketTypes and
// ticketLimit. Every name, address and number here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const editor = require(resolve(ROOT, "assets/js/event-tickets-editor.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

function load() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderFundraiseSignUp(template, true), "text/html").documentElement.innerHTML;
  calls = [];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    return Promise.resolve({ ok: a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  (window as any).NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  (window as any).NBCCTicketEditor = editor;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  editor.mount(document.querySelector("[data-nbcc-tickets]"));
  return initFundraiseForm(document, window);
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const type = (sel: string, value: string) => {
  const el = $<HTMLInputElement>(sel);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const submit = async () => {
  $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
  await flush();
};
const sent = () => JSON.parse(String(calls.filter((c) => c.url === "/api/fundraise")[0].init?.body));

function fillEvent() {
  tick("pathEvent");
  tick("over18Yes");
  tick("sharesNo");
  tick("publicYes");
  type("#title", "Example Quiz Night");
  tick("kind-quiz");
  type("#description", "Eight rounds and a raffle.");
  type("#eventDate", "2099-12-05");
  type("#town", "Exampleton");
  type("#firstName", "Kim");
  type("#lastName", "Example");
  type("#email", "kim@example.com");
  type("#phone", "07700 900222");
  tick("socialOkNo");
  tick("shoutOutNo");
  tick("attendNo");
  type("#venue", "Example Village Hall");
  type("#cardLine", "Eight rounds, a raffle and a bar, all for NBCC.");
}

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
  load();
});

describe("How do people get in?", () => {
  it("offers NBCC selling the tickets as the fourth answer", () => {
    const labels = [...document.querySelectorAll('input[name="booking"]')].map((i) => i.closest("label")?.textContent?.trim());
    expect(labels).toEqual(["Tickets are sold on another website", "Pay on the door, no booking needed", "Free, just come along", NBCC_SELLS_LABEL]);
  });

  it("says when to choose it and how costs are repaid, only once it is chosen", () => {
    const block = $<HTMLElement>("[data-nbcc-tickets]");
    expect(block.hidden).toBe(true);
    tick("pathEvent");
    tick("booking-nbcc");
    expect(block.hidden).toBe(false);
    expect(block.textContent).toContain(ALL_MONEY_NOTE.replace(/'/g, "’"));
    expect(block.textContent).toContain(COSTS_NOTE);
    tick("booking-door");
    expect(block.hidden).toBe(true);
  });
});

describe("the kinds of ticket", () => {
  it("starts with one row, adds more and removes them", () => {
    expect(document.querySelectorAll("[data-et-row]")).toHaveLength(1);
    $<HTMLButtonElement>("[data-et-add]").click();
    expect(document.querySelectorAll("[data-et-row]")).toHaveLength(2);
    $<HTMLButtonElement>("[data-et-row]:last-child [data-et-remove]").click();
    expect(document.querySelectorAll("[data-et-row]")).toHaveLength(1);
  });

  it("are sent with the sign up, prices in whole pence", async () => {
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "12.50");
    type("[data-et-row] [data-et-quantity]", "80");
    $<HTMLButtonElement>("[data-et-add]").click();
    type("[data-et-row]:last-child [data-et-name]", "Child");
    type("[data-et-row]:last-child [data-et-price]", "5");
    type("#ticketLimit", "100");
    await submit();
    expect(sent()).toMatchObject({
      booking: "nbcc",
      ticketUrl: "",
      ticketTypes: [
        { name: "Adult", pricePence: 1250, quantity: 80 },
        { name: "Child", pricePence: 500, quantity: null },
      ],
      ticketLimit: 100,
      ticketClose: "start",
    });
  });

  it("can be free: a price of 0", async () => {
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Under 5");
    type("[data-et-row] [data-et-price]", "0");
    await submit();
    expect(sent().ticketTypes).toEqual([{ name: "Under 5", pricePence: 0, quantity: null }]);
  });

  it("ask when ticket sales should close, with a date and time only for their own choice", async () => {
    const block = $<HTMLElement>("[data-nbcc-tickets]");
    expect(block.textContent).toContain("When should ticket sales close?");
    const labels = [...block.querySelectorAll('input[name="ticketClose"]')].map((i) => i.closest("label")?.textContent?.trim());
    expect(labels).toEqual(["When the event starts", "The day before (midnight)", "A date and time I choose"]);
    const when = $<HTMLElement>("[data-et-close-at-field]");
    expect(when.hidden).toBe(true);
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "10");
    tick("ticketClose-custom");
    expect(when.hidden).toBe(false);
    type("#ticketCloseAt", "2099-12-03T18:00");
    await submit();
    expect(sent()).toMatchObject({ ticketClose: "custom", ticketCloseAt: "2099-12-03T18:00" });
  });

  it("are not sent for any other way in", async () => {
    fillEvent();
    tick("booking-door");
    await submit();
    expect(sent().ticketTypes).toBeUndefined();
  });

  it("show the server's words beside the first ticket", async () => {
    answer = (url) =>
      url === "/api/fundraise/captcha"
        ? { status: 200, body: { siteKey: null } }
        : { status: 400, body: { error: "x", fields: { ticketTypes: "Ticket 1: the price needs to be £0 for a free ticket, or from £1 to £500." } } };
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "0.50");
    await submit();
    expect(document.body.textContent).toContain("Ticket 1: the price needs to be £0 for a free ticket, or from £1 to £500.");
  });
});
