// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Event tickets in the private area (/fundraise/manage): assets/js/event-tickets-manage.js watches
// for the cards the private area draws and adds "Your tickets" to an event selling through NBCC:
// the money (tickets apart from gifts), each kind of ticket and where it is up to, the guest list to
// print, a form to propose more tickets, and the bookings, each with "Ask for a refund" (only NBCC
// can make one). Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const editor = require(resolve(ROOT, "assets/js/event-tickets-editor.js"));
const manage = require(resolve(ROOT, "assets/js/event-tickets-manage.js")) as { initTicketsManage: (doc: Document, win: unknown) => { scan: () => void } };

const DATA = {
  selling: true,
  state: "open",
  types: [
    { id: 1, name: "Adult", pricePence: 1000, quantity: 80, status: "approved", statusWords: "On sale", taken: 4 },
    { id: 2, name: "Child", pricePence: 500, quantity: null, status: "proposed", statusWords: "Waiting for us to approve", taken: 0 },
  ],
  salesLimit: 100,
  proposedSalesLimit: null,
  money: { ticketsPence: 4000, giftsPence: 2500, totalPence: 6500, words: "£40 from tickets, £25 in gifts" },
  sold: 4,
  bookings: [
    { id: 70, reference: "TIX-ABCDEF", name: "Robin Example", tickets: "2 Adult", count: 2, refunded: false, requested: false },
    { id: 71, reference: "TIX-BBBBBB", name: "Sam Sample", tickets: "2 Adult", count: 2, refunded: false, requested: true },
    { id: 72, reference: "TIX-FREEAA", name: "Alex Free", tickets: "2 Under 5", count: 2, refunded: false, requested: false, free: true },
  ],
  close: { mode: "day_before", at: null, words: "Sales close at midnight the day before." },
  proposedClose: { mode: "custom", at: "2099-12-03T18:00:00.000Z", words: "Sales close on Thursday 3 December 2099 at 6pm." },
  requests: [{ id: 5, reference: "TIX-BBBBBB", buyerName: "Sam Sample", reason: "Ill.", status: "open", requestedAt: "2026-11-01T10:00:00Z" }],
  guestListUrl: "/api/fundraise/manage/fundraisers/12/tickets/guest-list",
};

let fetchMock: ReturnType<typeof vi.fn>;
const answer = (status: number, data: unknown) => Promise.resolve({ status, json: () => Promise.resolve(data) });
const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

async function start(data: unknown = DATA, status = 200) {
  document.body.innerHTML =
    '<div data-manage-list><article data-fundraiser="12"><h2>Example Quiz Night</h2><section data-f-done-part><h3>All done?</h3></section></article></div>';
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") return answer(202, { status: "ok", message: "Thank you. We have asked our team to look at this refund. Only NBCC can make it, and we will let the buyer know." });
    return answer(status, data);
  });
  const win = { fetch: fetchMock, NBCCTicketEditor: editor, MutationObserver: undefined };
  manage.initTicketsManage(document, win).scan();
  await flush();
  await flush();
}

beforeEach(() => start());

describe("Your tickets", () => {
  it("is added before All done?, for an event selling through NBCC", () => {
    const part = $("[data-et-part]");
    expect(part).toBeTruthy();
    expect(part.querySelector("h3")?.textContent).toBe("Your tickets");
    expect(part.nextElementSibling?.hasAttribute("data-f-done-part")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/fundraise/manage/fundraisers/12/tickets");
  });

  it("is not added for anything else", async () => {
    await start({ error: "Not found" }, 404);
    expect($("[data-et-part]")).toBeNull();
  });

  it("shows ticket money apart from gifts, and how many are sold", () => {
    expect($("[data-et-money]").textContent).toBe("£40 from tickets, £25 in gifts");
    expect($("[data-et-part]").textContent).toContain("4 tickets sold");
    expect($("[data-et-part]").textContent).toContain("At most 100 tickets in all");
  });

  it("lists each kind of ticket and where it is up to", () => {
    const items = [...document.querySelectorAll("[data-et-types] li")].map((li) => li.textContent);
    expect(items[0]).toContain("Adult, £10");
    expect(items[0]).toContain("On sale");
    expect(items[0]).toContain("4 of 80 taken");
    expect(items[1]).toContain("Child, £5");
    expect(items[1]).toContain("Waiting for us to approve");
  });

  it("links the guest list to print", () => {
    const a = $<HTMLAnchorElement>("[data-et-guest-list]");
    expect(a.getAttribute("href")).toBe("/api/fundraise/manage/fundraisers/12/tickets/guest-list");
    expect(a.textContent).toContain("Open the guest list to print");
  });

  it("says only NBCC can refund, and that sharing ticket money is not allowed", () => {
    const text = $("[data-et-part]").textContent ?? "";
    expect(text).toContain("Only NBCC can make a refund.");
    expect(text).toContain("Choose this only if all the ticket money is going to NBCC.");
    expect(text).toContain("If you have costs, like the hall, talk to us: we can repay agreed costs against receipts.");
  });
});

describe("proposing more tickets", () => {
  it("sends the new kinds for checking", async () => {
    const form = $("[data-et-propose]");
    (form.querySelector("[data-et-name]") as HTMLInputElement).value = "Family";
    (form.querySelector("[data-et-price]") as HTMLInputElement).value = "25";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/fundraise/manage/fundraisers/12/tickets/propose");
    expect(JSON.parse(post?.[1].body)).toEqual({ ticketTypes: [{ name: "Family", pricePence: 2500, quantity: null }] });
  });
});

describe("asking for a refund", () => {
  it("offers it on a booking with none asked for, and says when one has been", () => {
    const rows = [...document.querySelectorAll("[data-et-bookings] li")];
    expect(rows[0].querySelector("[data-et-ask]")).toBeTruthy();
    expect(rows[1].querySelector("[data-et-ask]")).toBeNull();
    expect(rows[1].textContent).toContain("Refund asked for");
  });

  it("sends the booking and the reason to staff", async () => {
    $<HTMLButtonElement>("[data-et-ask]").click();
    const form = $("[data-et-refund-form]");
    expect(form.hidden).toBe(false);
    (form.querySelector("textarea") as HTMLTextAreaElement).value = "They cannot come.";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/fundraise/manage/fundraisers/12/tickets/refund-request");
    expect(JSON.parse(post?.[1].body)).toEqual({ orderId: 70, reason: "They cannot come." });
  });

  it("needs a reason", async () => {
    $<HTMLButtonElement>("[data-et-ask]").click();
    $("[data-et-refund-form]").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    expect($("[data-et-refund-status]").textContent).toBe("Tell us why, in a few words.");
  });
});

describe("the private area page", () => {
  const html = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

  it("loads the tickets script, its editor and its styles", () => {
    expect(html).toContain('src="/assets/js/event-tickets-editor.js"');
    expect(html).toContain('src="/assets/js/event-tickets-manage.js"');
    expect(html).toContain('href="/assets/css/event-tickets.css"');
  });

  it("offers NBCC selling the tickets when changing how people get in", () => {
    expect(html).toContain('id="editBookingNbcc" name="booking" type="radio" value="nbcc"');
  });
});

describe("a free booking", () => {
  it("is cancelled by the organiser themselves, after a second press, never refunded", async () => {
    const row = [...document.querySelectorAll("[data-et-bookings] li")][2];
    expect(row.querySelector("[data-et-ask]")).toBeNull();
    const cancel = row.querySelector("[data-et-cancel]") as HTMLButtonElement;
    expect(cancel.textContent).toBe("Cancel this booking");
    cancel.click();
    await flush();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    expect(cancel.textContent).toBe("Yes, cancel it and email them");
    cancel.click();
    await flush();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/fundraise/manage/fundraisers/12/tickets/bookings/72/cancel");
  });
});

describe("when ticket sales close", () => {
  it("is shown, with the choice still waiting for us", () => {
    const text = $("[data-et-part]").textContent ?? "";
    expect(text).toContain("Sales close at midnight the day before.");
    expect(text).toContain("You asked for: Sales close on Thursday 3 December 2099 at 6pm. We are checking that.");
  });

  it("can be changed, for us to approve", async () => {
    const form = $("[data-et-close-form]");
    const custom = form.querySelector('input[value="start"]') as HTMLInputElement;
    custom.checked = true;
    custom.dispatchEvent(new Event("change", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/fundraise/manage/fundraisers/12/tickets/propose");
    expect(JSON.parse(post?.[1].body)).toEqual({ ticketClose: "start" });
  });
});
