// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Event tickets in Admin > Fundraising: the Event tickets card (assets/js/admin/event-tickets.js), its
// own script beside app.js. It lists the ticketed events; opening one shows its tickets (to approve,
// change, take off sale), the limit, sales open or closed, the money (tickets apart from gifts), the
// guest list and CSV, the refund requests and the bookings, each with a refund an admin confirms
// twice. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const admin = require(resolve(ROOT, "assets/js/admin/event-tickets.js")) as { initAdminEventTickets: (doc: Document, win: unknown) => { load: () => Promise<void> } };
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");

const LIST = { events: [{ id: 12, title: "Example Quiz Night", slug: "example-quiz", status: "approved", eventDate: "2099-12-05", proposedTypes: 1, proposedLimit: true, sold: 4, ticketPence: 4000, openRequests: 1, salesClosed: false }] };
const DETAIL = {
  event: { id: 12, title: "Example Quiz Night", slug: "example-quiz", status: "approved", public: true, booking: "nbcc", eventDate: "2099-12-05", startTime: "19:30" },
  state: "open",
  types: [
    { id: 1, name: "Adult", pricePence: 1000, quantity: 80, status: "approved", taken: 4, sold: 4, proposedBy: "organiser:kim@example.com" },
    { id: 2, name: "Child", pricePence: 500, quantity: null, status: "proposed", taken: 0, sold: 0, proposedBy: "organiser:kim@example.com" },
  ],
  salesLimit: 100,
  proposedSalesLimit: 120,
  salesClosedAt: null,
  close: { mode: "start", at: null, words: "Sales close when the event starts." },
  proposedClose: { mode: "day_before", at: null, words: "Sales close at midnight the day before." },
  overallRemaining: 96,
  money: { ticketsPence: 4000, giftsPence: 2500, totalPence: 6500, words: "£40 from tickets, £25 in gifts" },
  orders: [
    {
      id: 70, reference: "TIX-ABCDEF", status: "paid", firstName: "Robin", surname: "Example", email: "robin@example.com", phone: "07700 900999",
      ticketsPence: 2000, feeCoverPence: 45, totalPence: 2045, refundedPence: 0, tickets: "2 Adult", paidAt: "2026-11-01T10:00:00Z",
      emailSent: false, emailFailing: true, flagWords: ["Paid late: this event is now 2 over its limit"],
      lines: [{ id: 700, typeName: "Adult", unitPence: 1000, quantity: 2, refundedQuantity: 0 }],
    },
    {
      id: 73, reference: "TIX-MIXEDA", status: "paid", firstName: "Sam", surname: "Mixed", email: "sam@example.com", phone: null,
      ticketsPence: 1000, feeCoverPence: 0, totalPence: 1000, refundedPence: 0, tickets: "1 Adult, 2 Under 5", paidAt: "2026-11-01T10:00:00Z",
      refundFailed: true, flagWords: ["Refund failed at the bank: the buyer has not been paid back. Refund again."],
      lines: [{ id: 730, typeName: "Adult", unitPence: 1000, quantity: 1, refundedQuantity: 0 }, { id: 731, typeName: "Under 5", unitPence: 0, quantity: 2, refundedQuantity: 0 }],
    },
    {
      id: 72, reference: "TIX-FREEAA", status: "paid", firstName: "Alex", surname: "Free", email: "alex@example.com", phone: null,
      ticketsPence: 0, feeCoverPence: 0, totalPence: 0, refundedPence: 0, tickets: "2 Under 5", paidAt: "2026-11-01T10:00:00Z", free: true,
      lines: [{ id: 720, typeName: "Under 5", unitPence: 0, quantity: 2, refundedQuantity: 0 }],
    },
  ],
  requests: [{ id: 5, orderId: 70, reference: "TIX-ABCDEF", buyerName: "Robin Example", reason: "They are ill.", requestedBy: "organiser:kim@example.com", requestedAt: "2026-11-02T10:00:00Z", status: "open" }],
  refunds: [],
};

let fetchMock: ReturnType<typeof vi.fn>;
let card: { load: () => Promise<void> };
const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const res = (status: number, data: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(data), text: () => Promise.resolve(String(data)), blob: () => Promise.resolve(new Blob([String(data)])) });
const posts = () => fetchMock.mock.calls.filter((c) => c[1] && c[1].method && c[1].method !== "GET");

async function start(role = "admin") {
  const section = /<section class="fr-card et-admin"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  document.body.innerHTML = `<section id="view-fundraising">${section}</section>`;
  const claims = Buffer.from(JSON.stringify({ email: "staff@example.com", role })).toString("base64");
  window.sessionStorage.setItem("nbcc_admin_token", `${claims}.sig`);
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") return res(200, { status: "ok", amountPence: 1000 });
    if (url === "/api/admin/event-tickets") return res(200, LIST);
    if (url === "/api/admin/event-tickets/12") return res(200, DETAIL);
    return res(200, "<html>guest list</html>");
  });
  const win = { fetch: fetchMock, sessionStorage: window.sessionStorage, open: vi.fn(() => ({ document: { open: vi.fn(), write: vi.fn(), close: vi.fn() } })), URL: { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }, atob: window.atob.bind(window) };
  card = admin.initAdminEventTickets(document, win);
  await card.load();
  await flush();
}

async function open() {
  $<HTMLButtonElement>("[data-et-open='12']").click();
  await flush();
  await flush();
}

beforeEach(() => start());

describe("the Event tickets card", () => {
  it("is in Admin > Fundraising, with its own script and styles", () => {
    expect(html).toContain('id="etAdmin"');
    expect(html).toContain('src="/assets/js/admin/event-tickets.js"');
    expect(html).toContain('href="/assets/css/admin-event-tickets.css"');
  });

  it("lists each ticketed event with what is waiting, sent with the admin's session", () => {
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${window.sessionStorage.getItem("nbcc_admin_token")}`);
    const row = $("[data-et-event='12']");
    expect(row.textContent).toContain("Example Quiz Night");
    expect(row.textContent).toContain("4 sold");
    expect(row.textContent).toContain("£40");
    expect(row.textContent).toContain("1 ticket to approve");
    expect(row.textContent).toContain("1 refund asked for");
  });

  it("says so when there are none", async () => {
    LIST.events.length = 0;
    await start();
    expect($("#etAdminList").textContent).toContain("No event is selling tickets through NBCC yet.");
    LIST.events.push({ id: 12, title: "Example Quiz Night", slug: "example-quiz", status: "approved", eventDate: "2099-12-05", proposedTypes: 1, proposedLimit: true, sold: 4, ticketPence: 4000, openRequests: 1, salesClosed: false });
  });
});

describe("one event's tickets", () => {
  beforeEach(open);

  it("shows the money apart, the tickets and their state", () => {
    const d = $("[data-et-detail='12']");
    expect(d.querySelector("[data-et-money]")?.textContent).toBe("£40 from tickets, £25 in gifts");
    const rows = [...d.querySelectorAll("[data-et-type-row]")].map((r) => r.textContent);
    expect(rows[0]).toContain("Adult");
    expect(rows[0]).toContain("4 of 80");
    expect(rows[0]).toContain("On sale");
    expect(rows[1]).toContain("Waiting for you to approve");
  });

  it("approves a proposed ticket", async () => {
    $<HTMLButtonElement>("[data-et-approve='2']").click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/types/2/approve");
    expect(posts()[0][1].method).toBe("POST");
  });

  it("approves the limit the organiser asked for, and closes sales", async () => {
    $<HTMLButtonElement>("[data-et-limit-approve]").click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/limit/approve");
    $<HTMLButtonElement>("[data-et-sales]").click();
    await flush();
    const last = posts()[posts().length - 1];
    expect(last[0]).toBe("/api/admin/event-tickets/12/sales");
    expect(JSON.parse(last[1].body)).toEqual({ open: false });
  });

  it("shows the refund asked for, with its reason", () => {
    const q = $("[data-et-request='5']");
    expect(q.textContent).toContain("TIX-ABCDEF");
    expect(q.textContent).toContain("They are ill.");
  });

  it("refunds only after a second, plain confirmation, sending the tickets chosen", async () => {
    $<HTMLButtonElement>("[data-et-refund-open='70']").click();
    const form = $("[data-et-refund-form='70']");
    const qty = form.querySelector("input[data-et-refund-qty]") as HTMLInputElement;
    qty.value = "1";
    qty.dispatchEvent(new Event("input", { bubbles: true }));
    expect(form.querySelector("[data-et-refund-amount]")?.textContent).toBe("£10 will go back to the buyer’s card.");
    const go = form.querySelector("[data-et-refund-go]") as HTMLButtonElement;
    go.click();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(go.textContent).toBe("Yes, refund £10 now");
    go.click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/orders/70/refund");
    // With the booking as the admin saw it, so a booking that has changed since is refused.
    expect(JSON.parse(posts()[0][1].body)).toEqual({ lines: [{ lineId: 700, quantity: 1, refundedQuantity: 0 }], refundedPence: 0, requestId: 5, note: "" });
  });

  it("includes the card fee cover when every ticket is refunded", () => {
    $<HTMLButtonElement>("[data-et-refund-open='70']").click();
    const form = $("[data-et-refund-form='70']");
    const qty = form.querySelector("input[data-et-refund-qty]") as HTMLInputElement;
    qty.value = "2";
    qty.dispatchEvent(new Event("input", { bubbles: true }));
    expect(form.querySelector("[data-et-refund-amount]")?.textContent).toBe("£20.45 will go back to the buyer’s card, with the card fee cover, as it is the whole booking.");
  });

  it("flags a booking staff should check, and one whose tickets email did not go, with a way to send it again", async () => {
    const o = $("[data-et-order='70']");
    expect(o.textContent).toContain("Paid late: this event is now 2 over its limit");
    expect(o.textContent).toContain("Tickets email keeps failing: check the address");
    $<HTMLButtonElement>("[data-et-resend='70']").click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/orders/70/resend");
  });

  it("opens the guest list with the admin's session, to print", async () => {
    $<HTMLButtonElement>("[data-et-guest-list]").click();
    await flush();
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/admin/event-tickets/12/guest-list");
    expect(call?.[1].headers.Authorization).toContain("Bearer ");
  });
});

describe("when sales close, and free bookings (staff)", () => {
  beforeEach(open);

  it("shows when sales close, approves the host's choice, and sets another", async () => {
    const d = $("[data-et-detail='12']");
    expect(d.textContent).toContain("Sales close when the event starts.");
    expect(d.textContent).toContain("The organiser asked: Sales close at midnight the day before.");
    $<HTMLButtonElement>("[data-et-close-approve]").click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/close/approve");
    const form = $("[data-et-close-form]");
    (form.querySelector("select") as HTMLSelectElement).value = "custom";
    (form.querySelector('input[type="datetime-local"]') as HTMLInputElement).value = "2099-12-03T18:00";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    const last = posts()[posts().length - 1];
    expect(last[0]).toBe("/api/admin/event-tickets/12/close");
    expect(last[1].method).toBe("PUT");
    expect(JSON.parse(last[1].body)).toEqual({ ticketClose: "custom", ticketCloseAt: "2099-12-03T18:00" });
  });

  it("cancels a free booking after a second press, and offers no refund on it", async () => {
    const o = $("[data-et-order='72']");
    expect(o.textContent).toContain("Free booking");
    expect(o.querySelector("[data-et-refund-open]")).toBeNull();
    const cancel = o.querySelector("[data-et-cancel-free]") as HTMLButtonElement;
    cancel.click();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(cancel.textContent).toBe("Yes, cancel it and email them");
    cancel.click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/orders/72/cancel");
  });
});

describe("releasing tickets with no money moving, and an email that keeps failing", () => {
  beforeEach(open);

  it("keeps a failed refund flagged until an admin marks it as sorted, after a second press", async () => {
    const o = $("[data-et-order='73']");
    expect(o.textContent).toContain("Refund failed at the bank: the buyer has not been paid back. Refund again.");
    expect($("[data-et-order='70'] [data-et-refund-sorted]")).toBeNull();
    const sorted = o.querySelector("[data-et-refund-sorted]") as HTMLButtonElement;
    expect(sorted.textContent).toBe("Mark as sorted");
    sorted.click();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(sorted.textContent).toBe("Yes, the buyer has their money");
    sorted.click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/orders/73/refund-failed-sorted");
  });

  it("says when the tickets email keeps failing", () => {
    expect($("[data-et-order='70']").textContent).toContain("Tickets email keeps failing: check the address");
  });

  it("offers Release these tickets (no money) where there are free tickets, after a second press", async () => {
    expect($("[data-et-order='70'] [data-et-release-open]")).toBeNull();
    $<HTMLButtonElement>("[data-et-order='73'] [data-et-release-open]").click();
    const form = $("[data-et-release-form='73']");
    expect(form.textContent).toContain("Release these tickets (no money)");
    // Only the free line is offered: the paid one has had no money refunded.
    const boxes = [...form.querySelectorAll("input[data-et-release-qty]")] as HTMLInputElement[];
    expect(boxes.map((b) => b.getAttribute("data-et-release-qty"))).toEqual(["731"]);
    boxes[0].value = "1";
    boxes[0].dispatchEvent(new Event("input", { bubbles: true }));
    const go = form.querySelector("[data-et-release-go]") as HTMLButtonElement;
    go.click();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(go.textContent).toBe("Yes, cancel 1 ticket and email them");
    go.click();
    await flush();
    expect(posts()[0][0]).toBe("/api/admin/event-tickets/12/orders/73/release");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ lines: [{ lineId: 731, quantity: 1, refundedQuantity: 0 }], refundedPence: 0 });
  });
});

describe("someone who is not an admin", () => {
  it("is told only an admin can refund, and has no refund button", async () => {
    await start("editor");
    await open();
    expect($("[data-et-refund-open='70']")).toBeNull();
    expect($("[data-et-detail='12']").textContent).toContain("Only an admin can make a refund.");
  });
});
