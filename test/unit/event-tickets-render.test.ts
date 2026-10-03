import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  NBCC_FACT_HTML,
  nbccCardBooking,
  renderGuestListPage,
  renderTicketsSection,
  renderTicketsSummary,
  renderTicketsThanks,
  type TicketsView,
} from "../../src/tickets/render";

const view = (over: Partial<TicketsView> = {}): TicketsView => ({
  state: "open",
  fundraiserId: 12,
  slug: "example-quiz",
  title: "Example Quiz Night",
  types: [
    { id: 1, name: "Adult", pricePence: 1000, remaining: 40, soldOut: false },
    { id: 2, name: "Child", pricePence: 500, remaining: 3, soldOut: false },
    { id: 3, name: "Table of 8", pricePence: 7200, remaining: 0, soldOut: true },
  ],
  cardFee: { percentBp: 120, fixedPence: 20 },
  ...over,
});

const doc = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;

describe("the Get tickets section", () => {
  it("is its own section, apart from the give form, at #tickets", () => {
    const d = doc(renderTicketsSection(view()));
    const s = d.querySelector("section#tickets");
    expect(s).toBeTruthy();
    expect(s?.querySelector("h2")?.textContent).toBe("Get tickets");
    expect(s?.querySelector("#frGiveForm")).toBeNull();
    expect(s?.textContent).not.toMatch(/donat(e|ion) to/i);
  });

  it("offers each type on sale with its price, a box for how many, and says when few are left", () => {
    const d = doc(renderTicketsSection(view()));
    const adult = d.querySelector('[data-et-type="1"]');
    expect(adult?.textContent).toContain("Adult");
    expect(adult?.textContent).toContain("£10");
    const qty = adult?.querySelector("input[data-et-qty]") as HTMLInputElement;
    expect(qty.getAttribute("max")).toBe("20");
    expect(qty.value).toBe("0");
    expect(d.querySelector('[data-et-type="2"]')?.textContent).toContain("Only 3 left");
    expect(d.querySelector('[data-et-type="1"]')?.textContent).not.toContain("left");
  });

  it("marks a sold out type and gives it no box", () => {
    const d = doc(renderTicketsSection(view()));
    const table = d.querySelector('[data-et-type="3"]');
    expect(table?.textContent).toContain("Sold out");
    expect(table?.querySelector("input")).toBeNull();
  });

  it("asks for the buyer's name, email and an optional phone, and offers to cover the card fee", () => {
    const d = doc(renderTicketsSection(view()));
    for (const id of ["etFirstName", "etSurname", "etEmail", "etPhone", "etCoverFee"]) expect(d.getElementById(id), id).toBeTruthy();
    expect(d.querySelector('label[for="etPhone"]')?.textContent).toContain("optional");
    expect(d.querySelector('label[for="etCoverFee"]')?.textContent).toContain("to cover the card fee");
  });

  it("says the phone number is deleted 90 days after the event", () => {
    expect(doc(renderTicketsSection(view())).getElementById("etPhoneHelp")?.textContent).toBe(
      "Only in case we need to reach you about the event. We delete your phone number 90 days after the event.",
    );
  });

  it("has a hidden box only a bot fills, and room for the spam check when it is on", () => {
    const d = doc(renderTicketsSection(view({ captchaSiteKey: "0x-site-key" })));
    const trap = d.querySelector('input[name="company"]');
    expect(trap?.getAttribute("tabindex")).toBe("-1");
    expect(trap?.closest("[aria-hidden='true']")).toBeTruthy();
    expect(d.querySelector("form[data-et-form]")?.getAttribute("data-captcha-key")).toBe("0x-site-key");
    expect(d.querySelector("[data-et-captcha]")).toBeTruthy();
    expect(doc(renderTicketsSection(view())).querySelector("form[data-et-form]")?.hasAttribute("data-captcha-key")).toBe(false);
  });

  it("never offers Gift Aid on tickets, and says so", () => {
    const html = renderTicketsSection(view());
    expect(html).not.toMatch(/giftaid|gift-aid|frGiftAid/i);
    expect(doc(html).querySelector("#tickets")?.textContent).toContain("Tickets are not donations, so Gift Aid does not apply.");
  });

  it("carries the card fee rate for the page's own sum", () => {
    const form = doc(renderTicketsSection(view())).querySelector("form[data-et-form]");
    expect(form?.getAttribute("data-fee-bp")).toBe("120");
    expect(form?.getAttribute("data-fee-fixed")).toBe("20");
    expect(form?.getAttribute("data-fundraiser-id")).toBe("12");
    expect(form?.hasAttribute("hidden")).toBe(true);
  });

  it.each([
    ["soon", "Tickets go on sale soon. Check back here."],
    ["sold_out", "Sold out"],
    ["closed", "Ticket sales have closed."],
    ["started", "Ticket sales have closed."],
    ["finished", "This event has finished. Thank you to everyone who came."],
  ] as const)("says where sales are up to when %s, with no form", (state, words) => {
    const d = doc(renderTicketsSection(view({ state })));
    expect(d.querySelector("form")).toBeNull();
    expect(d.querySelector("#tickets")?.textContent).toContain(words);
  });

  it("is nothing at all when tickets are off", () => {
    expect(renderTicketsSection(view({ state: "off" }))).toBe("");
  });

  it("escapes a type's name", () => {
    const html = renderTicketsSection(view({ types: [{ id: 1, name: "<img src=x>", pricePence: 100, remaining: null, soldOut: false }] }));
    expect(html).not.toContain("<img src=x>");
  });
});

describe("the money in the summary", () => {
  it("shows ticket money and gifts apart, with a Get tickets button while on sale", () => {
    const d = doc(renderTicketsSummary({ ticketsPence: 4000, giftsPence: 2550 }, "open"));
    expect(d.querySelector(".et-split")?.textContent).toBe("£40 from tickets, £25.50 in gifts");
    expect(d.querySelector('a[href="#tickets"]')?.textContent).toBe("Get tickets");
  });

  it("has no button once sales are closed", () => {
    expect(doc(renderTicketsSummary({ ticketsPence: 0, giftsPence: 0 }, "closed")).querySelector("a")).toBeNull();
  });
});

describe("the thank you after buying", () => {
  it("says the tickets are emailed, with the reference", () => {
    const t = doc(renderTicketsThanks({ reference: "TIX-ABCDEF", paid: true })).body.textContent ?? "";
    expect(t).toContain("Thank you, you’re booked in!");
    expect(t).toContain("We’re emailing your tickets now.");
    expect(t).toContain("TIX-ABCDEF");
    expect(t).toContain("Show the email at the door.");
  });

  it("says the payment is being confirmed when the webhook has not landed", () => {
    expect(doc(renderTicketsThanks({ reference: null, paid: false })).body.textContent).toContain("Your payment is being confirmed");
  });
});

describe("the event card and facts", () => {
  it("sends the card's button to the page's Get tickets", () => {
    expect(nbccCardBooking("/event/example-quiz")).toEqual({
      bookingHow: "site",
      bookingUrl: "/event/example-quiz#tickets",
      bookingLabel: "Get tickets",
      bookingNote: "",
    });
  });

  it("says who sells them in the facts", () => {
    expect(doc(NBCC_FACT_HTML).body.textContent).toBe("Tickets are sold here, by NBCC. Get tickets");
  });
});

describe("the printable guest list", () => {
  const page = renderGuestListPage({
    title: "Example Quiz Night",
    when: "Saturday 5 December 2026, from 7.30pm",
    list: {
      rows: [{ name: "Alex Abbot", reference: "TIX-BBBBBB", tickets: "1 Adult", count: 1 }],
      totalTickets: 1,
      byType: [{ name: "Adult", count: 1 }],
    },
    printedAt: "2026-12-05T12:00:00.000Z",
  });
  const d = new JSDOM(page).window.document;

  it("is a page of its own, never indexed, with a tick box per booking", () => {
    expect(d.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    const row = d.querySelector("tbody tr");
    expect(row?.textContent).toContain("Alex Abbot");
    expect(row?.textContent).toContain("TIX-BBBBBB");
    expect(row?.textContent).toContain("1 Adult");
    expect(row?.querySelector(".et-tick")).toBeTruthy();
  });

  it("gives the totals, and asks for it to be destroyed after the event", () => {
    expect(d.body.textContent).toContain("1 ticket in 1 booking");
    expect(d.body.textContent).toContain("Adult: 1");
    expect(d.body.textContent).toContain("Please shred or bin this list after the event.");
  });

  it("has no email, phone or money on it", () => {
    expect(d.body.textContent).not.toMatch(/@|£/);
  });
});

describe("a free ticket", () => {
  it("says Free where the price would be, and the section says when sales close", () => {
    const d = doc(renderTicketsSection(view({ types: [{ id: 5, name: "Under 5", pricePence: 0, remaining: null, soldOut: false }], closeWords: "Sales close at midnight the day before." })));
    expect(d.querySelector('[data-et-type="5"] .et-type__price')?.textContent).toBe("Free");
    expect(d.querySelector(".et-sub")?.textContent).toBe("Sold by NBCC: all the ticket money goes to NBCC. Sales close at midnight the day before.");
  });
});
