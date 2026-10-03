// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_MONEY_NOTE, COSTS_NOTE, NBCC_SELLS_LABEL } from "../../src/tickets/model";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// Event tickets on the sign up form (/fundraise), in its event step: "How do people get in?" has "NBCC
// sells the tickets for me", which says when to choose it and asks for the kinds of ticket (a name, a
// price, an optional number each), an optional limit and when sales close, sent with the sign up as
// ticketTypes, ticketLimit and ticketClose. The form is one step at a time (the sign up tidy,
// assets/js/fundraise-steps.js): Next asks warmly for what is missing, and Check your answers shows
// the tickets. Every name, address and number here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const editor = require(resolve(ROOT, "assets/js/event-tickets-editor.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

// A walk through every step is a few seconds in jsdom on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

function load() {
  rememberCategories(ALL_BUILT_IN_CATEGORIES);
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, true, formCategories(), memoryCategories()), "text/html")
    .documentElement.innerHTML;
  calls = [];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    return Promise.resolve({ ok: a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  w.NBCCSocialHandles = socialHandles;
  w.NBCCFormSteps = stepsLib;
  w.NBCCTicketEditor = editor;
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
  el.dispatchEvent(new Event("change", { bubbles: true }));
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
const nextBtn = () => $<HTMLButtonElement>("[data-next]");
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
/** Press Next until the last step, or until a step holds them with something to put right. */
const walk = () => {
  for (let i = 0; i < 40 && !nextBtn().hidden; i++) {
    const before = current();
    nextBtn().click();
    if (current() === before) break;
  }
};
const said = () => [...current().querySelectorAll('[id$="-error"]')].map((n) => n.textContent).filter(Boolean);

function fillEvent() {
  tick("pathEvent");
  tick("over18Yes");
  tick("orgNo");
  type("#firstName", "Kim");
  type("#lastName", "Example");
  type("#email", "kim@example.com");
  type("#phone", "07700 900222");
  tick("kind-other");
  type("#kindOther", "A quiz night");
  type("#title", "Example Quiz Night");
  type("#description", "Eight rounds and a raffle.");
  type("#eventDate", "2099-12-05");
  type("#venue", "Example Village Hall");
  type("#cardLine", "Eight rounds, a raffle and a bar, all for NBCC.");
  tick("listedYes");
  tick("sharesNo");
  tick("shareShout");
  tick("attendNo");
  type("#postLine1", "1 Example Road");
  type("#postTown", "Exampleton");
  type("#postPostcode", "EX1 1EX");
}

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
  load();
});

describe("How do people get in?", () => {
  it("offers NBCC selling the tickets, after the four ways the form already had", () => {
    const labels = [...document.querySelectorAll('input[name="booking"]')].map((i) => i.closest("label")?.textContent?.trim());
    expect(labels).toEqual(["Tickets are sold on another website", "Pay on the door, no booking needed", "Free, just come along", "Free entry, donations welcome", NBCC_SELLS_LABEL]);
  });

  it("asks it in the event step, with the tickets beside it", () => {
    const step = $<HTMLElement>("[data-event-questions]");
    expect(step.hasAttribute("data-step")).toBe(true);
    expect(step.contains($("#booking-nbcc"))).toBe(true);
    expect(step.contains($("[data-nbcc-tickets]"))).toBe(true);
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

  it("are sent with the sign up from the new form (formVersion 2), prices in whole pence", async () => {
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "12.50");
    type("[data-et-row] [data-et-quantity]", "80");
    $<HTMLButtonElement>("[data-et-add]").click();
    type("[data-et-row]:last-child [data-et-name]", "Child");
    type("[data-et-row]:last-child [data-et-price]", "5");
    type("#ticketLimit", "100");
    walk();
    expect(nextBtn().hidden).toBe(true);
    await submit();
    expect(sent()).toMatchObject({
      formVersion: 2,
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
    walk();
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
    walk();
    await submit();
    expect(sent()).toMatchObject({ ticketClose: "custom", ticketCloseAt: "2099-12-03T18:00" });
  });

  it("are not sent for any other way in", async () => {
    fillEvent();
    tick("booking-donations");
    walk();
    await submit();
    expect(sent().booking).toBe("donations");
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
    walk();
    await submit();
    expect(document.body.textContent).toContain("Ticket 1: the price needs to be £0 for a free ticket, or from £1 to £500.");
    // The form goes back to the step the tickets are on.
    expect(current().contains($("[data-nbcc-tickets]"))).toBe(true);
  });
});

describe("Next, on the event step, asks warmly for what is missing", () => {
  it("at least one kind of ticket", () => {
    fillEvent();
    tick("booking-nbcc");
    walk();
    expect(current().contains($("[data-nbcc-tickets]"))).toBe(true);
    expect(said()).toEqual(["Almost! Just add at least one kind of ticket, like Adult at £10."]);
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "10");
    nextBtn().click();
    expect(current().contains($("[data-nbcc-tickets]"))).toBe(false);
  });

  it("a price for a ticket with a name, and a name for a ticket with a price", () => {
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    $<HTMLButtonElement>("[data-et-add]").click();
    type("[data-et-row]:last-child [data-et-price]", "5");
    walk();
    expect(said()).toEqual(["Almost! Just add a price for this ticket. Put 0 if it's free.", "Almost! Just give this ticket a name, like Adult."]);
  });

  it("a price in range, and a date and time when they chose their own", () => {
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "750");
    tick("ticketClose-custom");
    walk();
    expect(said().sort()).toEqual(["Almost! A ticket can be up to £500. Put 0 if it's free.", "Almost! Just choose when ticket sales should close."]);
  });

  it("nothing about tickets for any other way in", () => {
    fillEvent();
    tick("booking-free");
    walk();
    expect(nextBtn().hidden).toBe(true);
  });

  it("another way in when they are sharing with another cause", () => {
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "10");
    tick("sharesYes");
    type("#nbccSharePercent", "50");
    type("#otherCauseName", "Example Hospice");
    walk();
    expect(current().contains($("#sharesYes"))).toBe(true);
    expect(said().join(" ")).toContain("NBCC can only sell the tickets when all the ticket money comes to NBCC.");
  });
});

describe("Check your answers", () => {
  it("shows the tickets, the limit and when sales close", () => {
    fillEvent();
    tick("booking-nbcc");
    type("[data-et-row] [data-et-name]", "Adult");
    type("[data-et-row] [data-et-price]", "12.50");
    type("[data-et-row] [data-et-quantity]", "80");
    $<HTMLButtonElement>("[data-et-add]").click();
    type("[data-et-row]:last-child [data-et-name]", "Under 5");
    type("[data-et-row]:last-child [data-et-price]", "0");
    type("#ticketLimit", "100");
    tick("ticketClose-day_before");
    walk();
    expect(nextBtn().hidden).toBe(true);
    const rows = Object.fromEntries([...document.querySelectorAll("[data-review] dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(rows["How people get in"]).toBe(NBCC_SELLS_LABEL);
    expect(rows["Your tickets"]).toBe("Adult, £12.50 (80 on sale); Under 5, free. We check them before they go on sale.");
    expect(rows["Most tickets in all"]).toBe("100");
    expect(rows["Ticket sales close"]).toBe("The day before (midnight)");
  });

  it("says nothing of tickets for any other way in", () => {
    fillEvent();
    tick("booking-door");
    walk();
    const heads = [...document.querySelectorAll("[data-review] dt")].map((dt) => dt.textContent);
    expect(heads).toContain("How people get in");
    expect(heads).not.toContain("Your tickets");
    expect(heads).not.toContain("Ticket sales close");
  });
});
