// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-506: "News updates" in the organiser's private area (assets/js/fundraise-news.js). It adds a
// part to each card the private area draws, for a fundraiser running with its own page: a short
// update and an optional photo (shrunk in the browser first), sent to wait for staff; and their
// updates so far, each saying where it is up to. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
const { initNews } = require(resolve(ROOT, "assets/js/fundraise-news.js"));
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
const update = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  text: `Update ${id}`,
  status: "pending",
  statusWords: "Waiting for us to check",
  createdAt: "2026-11-20T10:00:00.000Z",
  photoUrl: null,
  ...over,
});

const NEWS = {
  fundraisers: [
    {
      id: 7,
      canPost: true,
      updates: [update(2), update(1, { status: "approved", statusWords: "On your page", photoUrl: "/api/fundraise/manage/news/1/photo" })],
    },
    { id: 8, canPost: false, updates: [] },
    { id: 9, canPost: false, updates: [update(5, { status: "rejected", statusWords: "Not used" })] },
  ],
};

let postReply: Reply = { status: 202, body: { status: "waiting", update: update(3, { text: "We did it!" }) } };

async function load(shrink?: (file: File) => Promise<{ mime: string; base64: string } | null>) {
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
      if (url === "/api/fundraise/manage/me") r = { status: 200, body: { fundraisers: [mine(7), mine(8, { path: "event", pageUrl: null, qrUrl: null }), mine(9, { status: "finished" })] } };
      if (url === "/api/fundraise/manage/news") r = { status: 200, body: NEWS };
      if (/\/news$/.test(url) && method === "POST") r = postReply;
      return Promise.resolve({ ok: r.status < 300, status: r.status, json: () => Promise.resolve(r.body) });
    }),
  };
  // As on the page: this script is loaded after the private area's, and the cards arrive later.
  initManage(document, win);
  initNews(document, win, shrink ? { shrink } : undefined);
  await flush();
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const card = (id: number) => $(`[data-fundraiser="${id}"]`)!;
const part = (id: number) => $("[data-news-part]", card(id));
const posts = () => calls.filter((c) => c.method === "POST");
const submit = async (form: HTMLElement) => {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};

describe("the News updates part", () => {
  it("is on a fundraiser running with a page, before All done?, with its updates and where each is up to", async () => {
    await load();
    const p = part(7)!;
    expect(p).not.toBeNull();
    expect(p.querySelector("h3")?.textContent).toBe("News updates");
    expect(p.nextElementSibling?.hasAttribute("data-f-done-part")).toBe(true);
    const items = Array.from(p.querySelectorAll("[data-news-list] > li"));
    expect(items.map((i) => i.querySelector(".fr-mynews__status")?.textContent)).toEqual(["Waiting for us to check", "On your page"]);
    expect(items[1].querySelector("img")?.getAttribute("src")).toBe("/api/fundraise/manage/news/1/photo");
    expect(items[1].querySelector(".fr-mynews__status")?.className).toContain("is-approved");
    expect(p.querySelector("form[data-news-form]")?.hidden).toBe(false);
  });

  it("is not on an event, which has no page to put news on", async () => {
    await load();
    expect(part(8)).toBeNull();
  });

  it("shows a finished one's updates, with no form", async () => {
    await load();
    const p = part(9)!;
    expect(p.querySelector("form[data-news-form]")?.hidden).toBe(true);
    expect(p.querySelector("[data-news-closed]")?.hidden).toBe(false);
    expect(p.querySelector(".fr-mynews__status")?.textContent).toBe("Not used");
  });

  it("gives every id its own ending, so two cards never share one", async () => {
    await load();
    const ids = Array.from(document.querySelectorAll("[data-news-part] [id]")).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const label = part(7)!.querySelector("label[for^='newsText']")!;
    expect(document.getElementById(label.getAttribute("for")!)).not.toBeNull();
  });
});

describe("sending an update", () => {
  it("needs some words, and sends nothing without them", async () => {
    await load();
    await submit(part(7)!.querySelector("form")!);
    expect(posts()).toHaveLength(0);
    expect(part(7)!.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("sends the words, then shows it first in the list as waiting, and empties the form", async () => {
    postReply = { status: 202, body: { status: "waiting", update: update(3, { text: "We did it!" }) } };
    await load();
    const form = part(7)!.querySelector("form")!;
    const box = form.querySelector("textarea")!;
    box.value = "  We did it!  ";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(part(7)!.querySelector("[data-news-count]")?.textContent).toBe("486 characters left.");
    await submit(form);
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/fundraisers/7/news", method: "POST", body: { text: "We did it!", photo: null } }]);
    const first = part(7)!.querySelector("[data-news-list] > li")!;
    expect(first.querySelector(".fr-wall__msg")?.textContent).toBe("We did it!");
    expect(first.querySelector(".fr-mynews__status")?.textContent).toBe("Waiting for us to check");
    expect(box.value).toBe("");
    expect(part(7)!.querySelector("[data-news-status]")?.textContent).toBe("Thank you. We will check your update soon, and email you once it is on your page.");
  });

  it("sends a photo the browser has shrunk, with the words", async () => {
    postReply = { status: 202, body: { status: "waiting", update: update(4, { photoUrl: "/api/fundraise/manage/news/4/photo" }) } };
    const shrink = vi.fn(async () => ({ mime: "image/jpeg", base64: "SHRUNK" }));
    await load(shrink);
    const form = part(7)!.querySelector("form")!;
    form.querySelector("textarea")!.value = "Look at us";
    const input = form.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "walk.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(shrink).toHaveBeenCalledWith(file);
    expect(form.querySelector<HTMLElement>("[data-news-preview]")?.hidden).toBe(false);
    await submit(form);
    expect(posts()[0].body).toEqual({ text: "Look at us", photo: { mime: "image/jpeg", dataBase64: "SHRUNK" } });
  });

  it("will not take a file that is not a JPG, PNG or WebP", async () => {
    await load(vi.fn(async () => null));
    const form = part(7)!.querySelector("form")!;
    const input = form.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["GIF89a"], "a.gif", { type: "image/gif" })], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(form.querySelector("[data-news-status]")?.textContent).toBe("That photo is not one we can use. Try a JPG or PNG.");
    expect(form.querySelector<HTMLElement>("[data-news-preview]")?.hidden).toBe(true);
  });

  it("says what the server said about the words, beside the box", async () => {
    postReply = { status: 400, body: { error: "Your update needs another look", fields: { text: "Please choose different words for your update." } } };
    await load();
    const form = part(7)!.querySelector("form")!;
    form.querySelector("textarea")!.value = "Something rude";
    await submit(form);
    expect(form.textContent).toContain("Please choose different words for your update.");
  });

  it("says when it is five already today", async () => {
    postReply = { status: 429, body: { error: "You have posted 5 updates in the last day. Please try again tomorrow." } };
    await load();
    const form = part(7)!.querySelector("form")!;
    form.querySelector("textarea")!.value = "Number six";
    await submit(form);
    expect(form.querySelector("[data-news-status]")?.textContent).toBe("You have posted 5 updates in the last day. Please try again tomorrow.");
    expect(form.querySelector<HTMLButtonElement>("[data-news-submit]")?.disabled).toBe(false);
  });
});
