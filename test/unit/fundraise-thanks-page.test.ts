// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-507: "Thank your supporters" in the organiser's private area (assets/js/fundraise-thanks.js). It
// adds a part to each card the private area draws, just after the latest gifts: their gifts with tick
// boxes (as the gifts list shows them, never an address), "Select all not yet thanked", a message box
// (600 characters), Send for checking, and the thank yous sent so far with where each is up to.
// Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
const { initThanks } = require(resolve(ROOT, "assets/js/fundraise-thanks.js"));
const template = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

type Reply = { status: number; body: unknown };
let calls: Array<{ url: string; method: string; body: unknown }>;

const editable = {
  description: "Five kilometres in a red suit.",
  targetPence: 25000,
  eventDate: "2026-12-05",
  startTime: null,
  venue: "",
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
const mine = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  slug: `walk-${id}`,
  title: `Walk ${id}`,
  path: "raising",
  status: "approved",
  public: true,
  pageUrl: `https://nbcc.test/fundraise/walk-${id}`,
  qrUrl: `/fundraise/walk-${id}/qr.svg`,
  meter: { raisedPence: 0, targetPence: 25000 },
  editable,
  waitingEdit: null,
  gifts: [],
  finishedRequestedAt: null,
  ...over,
});
const gift = (donationId: number, over: Record<string, unknown> = {}) => ({
  donationId,
  name: `Giver ${donationId}`,
  amountPence: 1000 + donationId,
  giftAidPence: null,
  message: `Well done ${donationId}`,
  createdAt: "2026-11-20T10:00:00.000Z",
  thanked: false,
  ...over,
});
const thanks = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  message: `Thank you ${id}`,
  status: "pending",
  statusWords: "Waiting for us to check",
  createdAt: "2026-11-21T10:00:00.000Z",
  gifts: 2,
  ...over,
});

let THANKS: { fundraisers: unknown[] };
let postReply: Reply;

async function load() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(template, "text/html").documentElement.innerHTML;
  calls = [];
  const win = {
    location: { search: "", pathname: "/fundraise/manage", assign: () => {} },
    history: { replaceState: () => {} },
    NBCCFormValidation: { validateForm: shared.validateForm, clearValidation: shared.clearValidation },
    MutationObserver: window.MutationObserver,
    fetch: vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      let r: Reply = { status: 200, body: {} };
      if (url === "/api/fundraise/manage/me") {
        r = { status: 200, body: { fundraisers: [mine(7), mine(8, { path: "event", pageUrl: null, qrUrl: null }), mine(9, { status: "finished" })] } };
      }
      if (url === "/api/fundraise/manage/thanks") r = { status: 200, body: THANKS };
      if (/\/thanks$/.test(url) && method === "POST") r = postReply;
      return Promise.resolve({ ok: r.status < 300, status: r.status, json: () => Promise.resolve(r.body) });
    }),
  };
  // As on the page: this script is loaded after the private area's, and the cards arrive later.
  initManage(document, win);
  initThanks(document, win);
  await flush();
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const card = (id: number) => $(`[data-fundraiser="${id}"]`);
const part = (id: number) => card(id).querySelector<HTMLElement>("[data-thanks-part]");
const text = (n: Element | null) => ((n && n.textContent) || "").replace(/\s+/g, " ").trim();
const boxes = (id: number) => $$<HTMLInputElement>('input[type="checkbox"][data-thanks-gift]', part(id)!);
const type = (el: HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (el: HTMLInputElement) => {
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const submit = async (id: number) => {
  $("form[data-thanks-form]", part(id)!).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};
const posts = () => calls.filter((c) => c.method === "POST");

function reset() {
  THANKS = {
    fundraisers: [
      { id: 7, canThank: true, gifts: [gift(41), gift(42, { name: "Anonymous", amountPence: null, message: null }), gift(43, { thanked: true })], thanks: [thanks(2), thanks(1, { status: "approved", statusWords: "Sent to 1 supporter", gifts: 1 })] },
      { id: 8, canThank: true, gifts: [], thanks: [] },
      { id: 9, canThank: true, gifts: [gift(51)], thanks: [] },
    ],
  };
  postReply = { status: 202, body: { status: "waiting", alreadyThanked: 0, thanks: thanks(3, { message: "Thanks everyone!", gifts: 2 }) } };
}

describe("thanking supporters, in each card", () => {
  it("adds the part just after the latest gifts, only where there are gifts to thank or thank yous to show", async () => {
    reset();
    await load();
    const p = part(7)!;
    expect(p).toBeTruthy();
    expect(p.previousElementSibling?.hasAttribute("data-f-gifts-part")).toBe(true);
    expect(text($("h3", p))).toBe("Thank your supporters");
    expect(part(8)).toBeNull();
    expect(part(9)).toBeTruthy();
  });

  it("lists the gifts as the gifts list does, with a tick box each, and an already thanked one marked and closed", async () => {
    reset();
    await load();
    const items = $$("[data-thanks-gifts] li", part(7)!);
    expect(items.map(text)).toEqual([
      "Giver 41 £10.41 Well done 41 20 November 2026",
      "Anonymous 20 November 2026",
      "Giver 43 £10.43 Well done 43 20 November 2026 Thanked",
    ]);
    expect(boxes(7).map((b) => [b.value, b.disabled])).toEqual([
      ["41", false],
      ["42", false],
      ["43", true],
    ]);
    // Every box has its own label, and its own id across cards.
    for (const b of boxes(7)) expect($(`label[for="${b.id}"]`)).toBeTruthy();
    const ids = $$("[id]").map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never shows an email address, and never runs what it is given", async () => {
    reset();
    (THANKS.fundraisers[0] as { gifts: unknown[] }).gifts = [gift(41, { name: "<img src=x onerror=alert(1)>", message: "<b>hi</b>" })];
    await load();
    expect(part(7)!.querySelector("img")).toBeNull();
    expect(part(7)!.querySelector("[data-thanks-gifts] b")).toBeNull();
    expect(part(7)!.innerHTML).not.toMatch(/@example/);
  });

  it("ticks every gift not yet thanked with one press, and says how many are picked", async () => {
    reset();
    await load();
    $("[data-thanks-all]", part(7)!).click();
    expect(boxes(7).map((b) => b.checked)).toEqual([true, true, false]);
    expect(text($("[data-thanks-picked]", part(7)!))).toBe("2 picked");
  });

  it("shows ten gifts, then the rest on asking, and Select all still picks the hidden ones", async () => {
    reset();
    (THANKS.fundraisers[0] as { gifts: unknown[] }).gifts = Array.from({ length: 13 }, (_, i) => gift(100 + i));
    await load();
    const items = $$("[data-thanks-gifts] li", part(7)!);
    expect(items.filter((li) => !li.hidden).length).toBe(10);
    $("[data-thanks-all]", part(7)!).click();
    expect(text($("[data-thanks-picked]", part(7)!))).toBe("13 picked");
    const more = $("[data-thanks-more]", part(7)!);
    expect(text(more)).toBe("Show all 13");
    more.click();
    expect(items.filter((li) => !li.hidden).length).toBe(13);
  });

  it("counts the characters left", async () => {
    reset();
    await load();
    const box = $<HTMLTextAreaElement>("textarea[name=message]", part(7)!);
    expect(box.maxLength).toBe(600);
    type(box, "Thanks!");
    expect(text($("[data-thanks-count]", part(7)!))).toBe("593 characters left.");
  });

  it("sends the words and the gifts ticked for checking, then shows it waiting and marks those gifts thanked", async () => {
    reset();
    await load();
    tick(boxes(7)[0]);
    tick(boxes(7)[1]);
    type($<HTMLTextAreaElement>("textarea[name=message]", part(7)!), "  Thanks everyone!  ");
    await submit(7);
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/fundraisers/7/thanks", method: "POST", body: { message: "Thanks everyone!", donationIds: [41, 42] } }]);
    expect(text($("[data-thanks-status]", part(7)!))).toBe("Thank you. We will check it soon, then email it to the supporters you picked.");
    expect(boxes(7).map((b) => [b.checked, b.disabled])).toEqual([
      [false, true],
      [false, true],
      [false, true],
    ]);
    const past = $$("[data-thanks-list] li", part(7)!);
    expect(text(past[0])).toBe("Waiting for us to check Thanks everyone! Sent for checking on 21 November 2026, for 2 gifts");
    expect($<HTMLTextAreaElement>("textarea[name=message]", part(7)!).value).toBe("");
  });

  it("says when some picked had been thanked already", async () => {
    reset();
    postReply = { status: 202, body: { status: "waiting", alreadyThanked: 1, thanks: thanks(3, { gifts: 1 }) } };
    await load();
    tick(boxes(7)[0]);
    type($<HTMLTextAreaElement>("textarea[name=message]", part(7)!), "Thanks");
    await submit(7);
    expect(text($("[data-thanks-status]", part(7)!))).toContain("Some you picked had been thanked already, so we left those out.");
  });

  it("asks for a gift and a few words before sending anything", async () => {
    reset();
    await load();
    await submit(7);
    expect(posts()).toEqual([]);
    expect($("[data-thanks-error]", part(7)!).hidden).toBe(false);
    const form = text($("form[data-thanks-form]", part(7)!));
    expect(form).toContain("Tick at least one gift to thank");
    expect(form).toContain("Write a few words to say thank you");
    // Said once, above the list, not inside a gift's label.
    expect($(".fr-thanks__pick-msg", part(7)!).closest("label")).toBeNull();
  });

  it("shows the server's words when it refuses: rude words beside the box, the day's limit in the status", async () => {
    reset();
    postReply = { status: 400, body: { error: "Your thank you needs another look", fields: { message: "Please choose different words for your thank you." } } };
    await load();
    tick(boxes(7)[0]);
    type($<HTMLTextAreaElement>("textarea[name=message]", part(7)!), "Rude");
    await submit(7);
    expect(text($("form[data-thanks-form]", part(7)!))).toContain("Please choose different words for your thank you.");
    postReply = { status: 429, body: { error: "You have sent 3 thank yous in the last day. Please try again tomorrow." } };
    await submit(7);
    expect(text($("[data-thanks-status]", part(7)!))).toBe("You have sent 3 thank yous in the last day. Please try again tomorrow.");
  });

  it("lists the thank yous sent so far with where each is up to", async () => {
    reset();
    await load();
    expect($$("[data-thanks-list] li", part(7)!).map((li) => text(li.querySelector(".fr-thanks__status")))).toEqual([
      "Waiting for us to check",
      "Sent to 1 supporter",
    ]);
    expect(text($$("[data-thanks-list] li", part(7)!)[1])).toContain("for 1 gift");
  });

  it("asks to sign in again when the session has ended", async () => {
    reset();
    postReply = { status: 401, body: { error: "Please sign in again." } };
    await load();
    tick(boxes(7)[0]);
    type($<HTMLTextAreaElement>("textarea[name=message]", part(7)!), "Thanks");
    await submit(7);
    expect(text($("[data-thanks-status]", part(7)!))).toBe("Please sign in again: refresh this page and we will send you a new code.");
  });

  it("leaves the rest of the private area working when it cannot load", async () => {
    reset();
    THANKS = { fundraisers: "nope" as unknown as unknown[] };
    await load();
    expect(part(7)).toBeNull();
    expect(card(7)).toBeTruthy();
  });
});
