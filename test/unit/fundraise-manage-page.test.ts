// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-501: /fundraise/manage, the organiser's private area. (TASK-494 opened it by an emailed
// 24 hour link; that is retired.) Signed out, it asks for an email, then for the 6 digit code we
// email. Signed in, it shows each of their fundraisers: where it is up to, its page and QR code,
// what it has raised, the latest gifts and messages, their details to change (every change waits
// for staff), paying in what they collected, and "I've finished". Every name and address here is
// invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
const template = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

type Reply = { status: number; body: unknown };
let calls: Array<{ url: string; method: string; body: unknown }>;
let assigned: string[];
let replaced: string[];

const editableRaising = {
  description: "Five kilometres in a red suit.",
  targetPence: 25000,
  eventDate: "2026-12-05",
  startTime: "10:30",
  venue: "Example Park",
  town: "Exampleton",
  socialLink: null,
  cardLine: null,
  endTime: null,
  timeTbc: false,
  venueAddress: null,
  venuePostcode: null,
  access: [],
  price: null,
  booking: null,
  ticketUrl: null,
  ageLimit: null,
  dressCode: null,
  included: null,
};
const gift = (i: number, over: Record<string, unknown> = {}) => ({
  name: `Giver ${i}.`,
  amountPence: 1000 + i,
  message: `Message ${i}`,
  createdAt: "2026-10-01T12:00:00.000Z",
  ...over,
});
const raising = (over: Record<string, unknown> = {}) => ({
  id: 7,
  slug: "robins-santa-dash",
  title: "Robin's Santa Dash",
  path: "raising",
  status: "approved",
  public: true,
  pageUrl: "https://nbcc.test/fundraise/robins-santa-dash",
  qrUrl: "/fundraise/robins-santa-dash/qr.svg",
  meter: { raisedPence: 6000, onlinePence: 5000, cashPence: 1000, targetPence: 25000, percent: 24, barPercent: 24, overTarget: false },
  editable: editableRaising,
  waitingEdit: null,
  gifts: [gift(1), gift(2, { name: "Anonymous", amountPence: null, message: null })],
  finishedRequestedAt: null,
  ...over,
});
const event = (over: Record<string, unknown> = {}) =>
  raising({
    id: 8,
    slug: "kims-quiz",
    title: "Kim's Quiz",
    path: "event",
    pageUrl: null,
    qrUrl: null,
    meter: { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: null, percent: null, barPercent: null, overTarget: false },
    editable: {
      ...editableRaising,
      targetPence: null,
      startTime: "19:00",
      endTime: "22:00",
      cardLine: "A friendly quiz.",
      venueAddress: "1 Example Road",
      venuePostcode: "KA1 1AA",
      access: ["step free entry"],
      price: "£5",
      booking: "door",
    },
    gifts: [],
    ...over,
  });

async function load(search: string, reply: (url: string, method: string, body: unknown) => Reply) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(template, "text/html").documentElement.innerHTML;
  calls = [];
  assigned = [];
  replaced = [];
  const win = {
    location: { search, pathname: "/fundraise/manage", assign: (url: string) => assigned.push(url) },
    history: { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
    NBCCFormValidation: { validateForm: shared.validateForm, clearValidation: shared.clearValidation },
    fetch: vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const r = reply(url, method, body);
      return Promise.resolve({ ok: r.status < 300, status: r.status, json: () => Promise.resolve(r.body) });
    }),
  };
  const out = initManage(document, win);
  await flush();
  return out;
}

const signedOut = (url: string): Reply => (url === "/api/fundraise/manage/me" ? { status: 401, body: { error: "Please sign in again." } } : { status: 200, body: {} });
const signedIn = (...fundraisers: unknown[]) => (url: string, method: string): Reply =>
  url === "/api/fundraise/manage/me" && method === "GET" ? { status: 200, body: { fundraisers } } : { status: 200, body: {} };

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const card = (id: number) => $<HTMLElement>(`[data-fundraiser="${id}"]`);
const field = <T extends HTMLElement = HTMLInputElement>(id: number, name: string) => $<T>(`[name="${name}"]`, card(id));
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = async (form: HTMLElement) => {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};
const posts = () => calls.filter((c) => c.method === "POST");

describe("signed out", () => {
  it("asks for an email, with the forms shown once the script runs", async () => {
    await load("", signedOut);
    expect($("[data-manage-request]").hidden).toBe(false);
    expect($("[data-manage-code]").hidden).toBe(true);
    expect($("[data-manage-area]").hidden).toBe(true);
    expect($("#manageRequestForm").hidden).toBe(false);
    expect($("[data-nojs]").hidden).toBe(true);
  });

  it("asks for a code for the email, then asks for the code", async () => {
    await load("", (url, method) =>
      method === "POST" ? { status: 200, body: { message: "If that email belongs to an approved fundraiser, we have sent a sign in code to it." } } : signedOut(url),
    );
    type($("#manageEmail"), " robin@example.com ");
    await submit($("#manageRequestForm"));
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/request", method: "POST", body: { email: "robin@example.com" } }]);
    expect($("[data-manage-request]").hidden).toBe(true);
    expect($("[data-manage-code]").hidden).toBe(false);
    expect($("[data-code-email]").textContent).toBe("robin@example.com");
  });

  it("checks the address before sending", async () => {
    await load("", signedOut);
    type($("#manageEmail"), "not an email");
    await submit($("#manageRequestForm"));
    expect(posts()).toHaveLength(0);
  });
});

describe("the code", () => {
  async function atCode(reply: (url: string, method: string, body: unknown) => Reply) {
    await load("", reply);
    type($("#manageEmail"), "robin@example.com");
    await submit($("#manageRequestForm"));
  }

  it("signs in with the code, then opens the private area", async () => {
    let inside = false;
    await atCode((url) => {
      if (url === "/api/fundraise/manage/sign-in") {
        inside = true;
        return { status: 200, body: { status: "signed_in" } };
      }
      if (url === "/api/fundraise/manage/me") return inside ? { status: 200, body: { fundraisers: [raising()] } } : { status: 401, body: {} };
      return { status: 200, body: {} };
    });
    type($("#manageCode"), "482 915");
    await submit($("#manageCodeForm"));
    expect(posts()[1]).toEqual({ url: "/api/fundraise/manage/sign-in", method: "POST", body: { email: "robin@example.com", code: "482915" } });
    expect($("[data-manage-code]").hidden).toBe(true);
    expect($("[data-manage-area]").hidden).toBe(false);
    expect(card(7)).not.toBeNull();
  });

  it("says a wrong code does not work, and stays put", async () => {
    await atCode((url, method) =>
      url === "/api/fundraise/manage/sign-in" ? { status: 401, body: { error: "That code does not work. Check it, or ask for a new one." } } : method === "GET" ? { status: 401, body: {} } : { status: 200, body: {} },
    );
    type($("#manageCode"), "111111");
    await submit($("#manageCodeForm"));
    expect($("[data-manage-code]").hidden).toBe(false);
    expect($("[data-code-status]").textContent).toBe("That code does not work. Check it, or ask for a new one.");
  });

  it("wants six digits before sending", async () => {
    await atCode(signedOut);
    type($("#manageCode"), "12");
    await submit($("#manageCodeForm"));
    expect(posts().filter((c) => c.url.endsWith("/sign-in"))).toHaveLength(0);
  });

  it("can go back to put in a different email", async () => {
    await atCode(signedOut);
    $("[data-code-change]").click();
    expect($("[data-manage-request]").hidden).toBe(false);
    expect($("[data-manage-code]").hidden).toBe(true);
  });

  it("can send a new code to the same email", async () => {
    await atCode(signedOut);
    $("[data-code-again]").click();
    await flush();
    expect(posts().filter((c) => c.url === "/api/fundraise/manage/request")).toHaveLength(2);
  });
});

describe("signed in", () => {
  it("shows each fundraiser: where it is up to, its page, its QR code and what it has raised", async () => {
    await load("", signedIn(raising(), event()));
    expect($("[data-manage-request]").hidden).toBe(true);
    expect($("[data-manage-area]").hidden).toBe(false);
    const c = card(7);
    expect($("[data-f-title]", c).textContent).toBe("Robin's Santa Dash");
    expect($<HTMLAnchorElement>("a[data-f-page]", c).getAttribute("href")).toBe("https://nbcc.test/fundraise/robins-santa-dash");
    expect($<HTMLImageElement>("img[data-f-qr-img]", c).getAttribute("src")).toBe("/fundraise/robins-santa-dash/qr.svg");
    const dl = $<HTMLAnchorElement>("a[data-f-qr-download]", c);
    expect(dl.getAttribute("href")).toBe("/fundraise/robins-santa-dash/qr.svg");
    expect(dl.getAttribute("download")).toBe("nbcc-robins-santa-dash-qr-code.svg");
    expect($("[data-f-raised]", c).textContent).toContain("£60");
    expect($("[data-f-raised]", c).textContent).toContain("£250");
  });

  it("has no page link and no QR code for one without a page", async () => {
    await load("", signedIn(event()));
    expect($("[data-f-qr]", card(8)).hidden).toBe(true);
    expect($("[data-f-page-line]", card(8)).hidden).toBe(true);
  });

  it("gives every field its own id, so two fundraisers never share one", async () => {
    await load("", signedIn(raising(), event()));
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBe(new Set(ids).size);
    const label = $<HTMLLabelElement>('label[for^="editDescription"]', card(8));
    expect(document.getElementById(label.htmlFor)?.closest("[data-fundraiser]")).toBe(card(8));
  });

  it("lists the latest gifts and messages as the wall shows them", async () => {
    await load("", signedIn(raising()));
    const items = [...card(7).querySelectorAll("[data-f-gifts] li")];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Giver 1.");
    expect(items[0].textContent).toContain("£10.01");
    expect(items[0].textContent).toContain("Message 1");
    expect(items[1].textContent).toContain("Anonymous");
    expect(items[1].textContent).not.toContain("£");
  });

  it("shows ten gifts, then the rest on asking", async () => {
    await load("", signedIn(raising({ gifts: Array.from({ length: 13 }, (_, i) => gift(i)) })));
    const visible = () => [...card(7).querySelectorAll<HTMLElement>("[data-f-gifts] li")].filter((li) => !li.hidden);
    expect(visible()).toHaveLength(10);
    $("[data-f-gifts-more]", card(7)).click();
    expect(visible()).toHaveLength(13);
  });

  it("says when nobody has given yet", async () => {
    await load("", signedIn(raising({ gifts: [] })));
    expect($("[data-f-gifts-empty]", card(7)).hidden).toBe(false);
  });

  it("has no gifts and messages part for one with no page and nothing given", async () => {
    await load("", signedIn(event()));
    expect($("[data-f-gifts-part]", card(8)).hidden).toBe(true);
  });

  it("asks a page raising money for a target, and an event for its event details", async () => {
    await load("", signedIn(raising(), event()));
    expect($("[data-raising-only]", card(7)).hidden).toBe(false);
    expect([...card(7).querySelectorAll<HTMLElement>("[data-event-only]")].every((e) => e.hidden)).toBe(true);
    expect($("[data-raising-only]", card(8)).hidden).toBe(true);
    expect([...card(8).querySelectorAll<HTMLElement>("[data-event-only]")].some((e) => !e.hidden)).toBe(true);
    expect(field(8, "endTime").value).toBe("22:00");
    expect(field(8, "price").value).toBe("£5");
    expect($<HTMLInputElement>('[name="access"][value="step free entry"]', card(8)).checked).toBe(true);
    expect($<HTMLInputElement>('[name="booking"][value="door"]', card(8)).checked).toBe(true);
  });

  it("shows the ticket link box only when tickets are sold on another website", async () => {
    await load("", signedIn(event()));
    const box = $("[data-ticket-link]", card(8));
    expect(box.hidden).toBe(true);
    const away = $<HTMLInputElement>('[name="booking"][value="away"]', card(8));
    away.checked = true;
    away.dispatchEvent(new Event("change", { bubbles: true }));
    expect(box.hidden).toBe(false);
  });

  it("says when there is nothing to manage", async () => {
    await load("", signedIn());
    expect($("[data-manage-none]").hidden).toBe(false);
  });

  // TASK-505: what they asked us for, and where each is up to. Read only: words, no buttons.
  it("shows where each thing they asked for is up to, with a shout out's link", async () => {
    await load(
      "",
      signedIn(
        raising({
          requests: [
            { label: "Posters", words: "sent on 3 Dec" },
            { label: "Collection buckets", words: "with you, please bring them back by 26 Dec" },
            { label: "Social media shout out", words: "posted on 2 Dec", link: "https://www.facebook.com/example/posts/1" },
          ],
        }),
      ),
    );
    const part = $<HTMLElement>("[data-f-requests]", card(7));
    expect(part.hidden).toBe(false);
    const items = [...part.querySelectorAll("li")].map((li) => li.textContent!.replace(/\s+/g, " ").trim());
    expect(items).toEqual([
      "Posters: sent on 3 Dec",
      "Collection buckets: with you, please bring them back by 26 Dec",
      "Social media shout out: posted on 2 Dec. See the post",
    ]);
    const a = $<HTMLAnchorElement>("a", part);
    expect(a.getAttribute("href")).toBe("https://www.facebook.com/example/posts/1");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(part.querySelector("button, input, form")).toBeNull();
  });

  it("has no requests part when they asked for nothing, or it could not be read", async () => {
    await load("", signedIn(raising({ requests: [] }), event({ requests: null })));
    expect($("[data-f-requests]", card(7)).hidden).toBe(true);
    expect($("[data-f-requests]", card(8)).hidden).toBe(true);
  });

  it("never makes a link of anything but a web address, and never runs what it is given", async () => {
    await load(
      "",
      signedIn(raising({ requests: [{ label: "<b>Posters</b>", words: "<img src=x onerror=alert(1)>", link: "javascript:alert(1)" }] })),
    );
    const part = $<HTMLElement>("[data-f-requests]", card(7));
    expect(part.querySelector("a, b, img")).toBeNull();
    expect(part.textContent).toContain("<b>Posters</b>: <img src=x onerror=alert(1)>");
  });
});

describe("changing the details", () => {
  it("sends only what changed, for that fundraiser, then says it waits for us", async () => {
    await load("", (url, method) =>
      method === "POST" ? { status: 202, body: { status: "waiting", edit: { id: 3, changes: {}, createdAt: "2026-10-02T12:00:00.000Z" } } } : signedIn(raising(), event())(url, method),
    );
    type(field<HTMLTextAreaElement>(7, "description"), "Six kilometres now.");
    await submit($("form[data-f-edit]", card(7)));
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/fundraisers/7/edit", method: "POST", body: { description: "Six kilometres now." } }]);
    expect($("[data-f-sent]", card(7)).hidden).toBe(false);
    expect($("[data-f-waiting]", card(7)).hidden).toBe(false);
  });

  it("sends an event's finish time, ticks and way in", async () => {
    await load("", (url, method) => (method === "POST" ? { status: 202, body: { status: "waiting", edit: { id: 4 } } } : signedIn(event())(url, method)));
    type(field(8, "endTime"), "23:00");
    $<HTMLInputElement>('[name="access"][value="a hearing loop"]', card(8)).checked = true;
    $<HTMLInputElement>('[name="timeTbc"]', card(8)).checked = true;
    await submit($("form[data-f-edit]", card(8)));
    expect(posts()[0].body).toEqual({ endTime: "23:00", timeTbc: true, access: ["step free entry", "a hearing loop"] });
  });

  it("clears a target that is emptied", async () => {
    await load("", (url, method) => (method === "POST" ? { status: 202, body: { status: "waiting", edit: { id: 5 } } } : signedIn(raising())(url, method)));
    type(field(7, "targetPence"), "");
    await submit($("form[data-f-edit]", card(7)));
    expect(posts()[0].body).toEqual({ targetPence: null });
  });

  it("sends nothing when nothing has changed, and says so", async () => {
    await load("", signedIn(raising()));
    await submit($("form[data-f-edit]", card(7)));
    expect(posts()).toHaveLength(0);
    expect($("[data-f-edit-status]", card(7)).textContent).toMatch(/not changed anything/);
  });

  it("puts the server's messages beside their fields", async () => {
    await load("", (url, method) =>
      method === "POST"
        ? { status: 400, body: { error: "Some of your changes need another look", fields: { endTime: "The finish time is before the start." } } }
        : signedIn(event())(url, method),
    );
    type(field(8, "endTime"), "18:00");
    await submit($("form[data-f-edit]", card(8)));
    const input = field(8, "endTime");
    expect(document.getElementById(`${input.id}-error`)?.textContent).toBe("The finish time is before the start.");
  });

  it("shows a change still waiting, in the form", async () => {
    await load("", signedIn(raising({ waitingEdit: { id: 3, changes: { town: "Newtown" }, createdAt: "2026-10-01T12:00:00.000Z" } })));
    expect($("[data-f-waiting]", card(7)).hidden).toBe(false);
    expect(field(7, "town").value).toBe("Newtown");
  });
});

describe("paying in", () => {
  it("opens Stripe for the amount, in pence, with no Gift Aid", async () => {
    await load("", (url, method) =>
      method === "POST" ? { status: 200, body: { url: "https://checkout.stripe.com/c/pay/test_pay_in" } } : signedIn(raising())(url, method),
    );
    type(field(7, "amount"), "25.50");
    await submit($("form[data-f-payin]", card(7)));
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/fundraisers/7/pay-in", method: "POST", body: { amountPence: 2550, coverFee: false } }]);
    expect(assigned).toEqual(["https://checkout.stripe.com/c/pay/test_pay_in"]);
    expect(card(7).querySelector("form[data-f-payin]")?.textContent?.toLowerCase()).not.toContain("gift aid");
  });

  it("wants £1 to £10,000 before sending", async () => {
    await load("", signedIn(raising()));
    type(field(7, "amount"), "0.50");
    await submit($("form[data-f-payin]", card(7)));
    type(field(7, "amount"), "10000.01");
    await submit($("form[data-f-payin]", card(7)));
    expect(posts()).toHaveLength(0);
  });

  it("says thank you on coming back from paying, and tidies the address", async () => {
    await load("?paid=1", signedIn(raising()));
    expect($("[data-paid-thanks]").hidden).toBe(false);
    expect(replaced).toEqual(["/fundraise/manage"]);
  });
});

describe("I've finished", () => {
  it("tells us, then says thank you", async () => {
    await load("", (url, method) =>
      method === "POST" ? { status: 200, body: { status: "thanks", finishedRequestedAt: "2026-10-02T12:00:00.000Z" } } : signedIn(raising())(url, method),
    );
    $("[data-f-finished]", card(7)).click();
    await flush();
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/fundraisers/7/finished", method: "POST", body: undefined }]);
    expect($("[data-f-finished-thanks]", card(7)).hidden).toBe(false);
    expect($("[data-f-finished-thanks]", card(7)).textContent).toContain("Thank you, we’ll be in touch.");
    expect($("[data-f-finished]", card(7)).hidden).toBe(true);
  });

  it("remembers they already told us", async () => {
    await load("", signedIn(raising({ finishedRequestedAt: "2026-10-01T12:00:00.000Z" })));
    expect($("[data-f-finished-thanks]", card(7)).hidden).toBe(false);
    expect($("[data-f-finished]", card(7)).hidden).toBe(true);
  });
});

describe("signing out, and a session that has run out", () => {
  it("signs out and goes back to the email box", async () => {
    await load("", signedIn(raising()));
    $("[data-sign-out]").click();
    await flush();
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/sign-out", method: "POST", body: undefined }]);
    expect($("[data-manage-request]").hidden).toBe(false);
    expect($("[data-manage-area]").hidden).toBe(true);
  });

  it("asks them to sign in again when the session has run out", async () => {
    await load("", (url, method) => (method === "POST" ? { status: 401, body: { error: "Please sign in again." } } : signedIn(raising())(url, method)));
    type(field<HTMLTextAreaElement>(7, "description"), "Changed.");
    await submit($("form[data-f-edit]", card(7)));
    expect($("[data-manage-request]").hidden).toBe(false);
    expect($("[data-manage-problem]").textContent).toMatch(/sign in again/i);
  });
});

describe("an old 24 hour link", () => {
  it("is taken out of the address bar, opens nothing, and points to the code", async () => {
    await load("?token=an-old-token", signedOut);
    expect(replaced).toEqual(["/fundraise/manage"]);
    expect(calls.some((c) => c.url.includes("an-old-token"))).toBe(false);
    expect($("[data-manage-problem]").hidden).toBe(false);
    expect($("[data-manage-problem]").textContent).toBe("Links are no longer used. Put in your email address below and we will send you a sign in code.");
  });
});

// TASK-501 review (Jaimie's decision): a finished fundraiser stays in the private area. Its gifts,
// its QR code and paying in late money all stay; changes and "I've finished" go.
describe("a finished fundraiser", () => {
  const finished = () => raising({ status: "finished", pageUrl: null, finishedRequestedAt: "2026-10-01T12:00:00.000Z" });

  it("says it is finished, keeps its gifts, QR code and paying in, and takes no changes", async () => {
    await load("", signedIn(finished()));
    const c = card(7);
    expect($("[data-f-status]", c).textContent).toBe("Finished. Thank you for everything you raised.");
    expect($("[data-f-qr]", c).hidden).toBe(false);
    expect($("[data-f-gifts-part]", c).hidden).toBe(false);
    expect($("form[data-f-payin]", c).closest("[hidden]")).toBeNull();
    expect($("form[data-f-edit]", c).hidden).toBe(true);
    const note = $("[data-f-edit-closed]", c);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("Your fundraiser is finished. To change anything, get in touch.");
    expect($("[data-f-done-part]", c).hidden).toBe(true);
  });

  it("still pays in", async () => {
    await load("", (url, method) => (method === "POST" ? { status: 200, body: { url: "https://checkout.stripe.com/c/pay/late" } } : signedIn(finished())(url, method)));
    type(field(7, "amount"), "40");
    await submit($("form[data-f-payin]", card(7)));
    expect(posts()[0]).toEqual({ url: "/api/fundraise/manage/fundraisers/7/pay-in", method: "POST", body: { amountPence: 4000, coverFee: false } });
  });
});
