// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Admin > Giving > Workshop drop-offs, the screen (assets/js/admin/drop-offs.js): the list, Write a
// thank you letter (handed to Admin > Thank you) and Remove. A fake fetch stands in for the server.
// Every name and address here is invented.

const require_ = createRequire(import.meta.url);
const { initAdminDropOffs } = require_(resolve(__dirname, "../../assets/js/admin/drop-offs.js")) as {
  initAdminDropOffs: (doc: Document, win: unknown) => { open: () => Promise<void> };
};

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 3, name: "Robin Example", email: "robin@example.com", brought: "Two bags of selection boxes", groupName: "Church group",
  phone: "07700 900123", newsletter: true, createdAt: "2026-11-28T14:15:00.000Z", letterSentAt: null, ...over,
});

let listing: Record<string, unknown>;
let calls: { url: string; method: string }[];
let writeInKind: ReturnType<typeof vi.fn>;
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function fakeFetch(url: string, init: { method?: string } = {}) {
  const method = (init.method || "GET").toUpperCase();
  calls.push({ url, method });
  const body = method === "DELETE" ? { ok: true } : listing;
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

async function open() {
  const screen = initAdminDropOffs(document, {
    fetch: fakeFetch,
    sessionStorage: { getItem: () => "tok", removeItem: () => undefined },
    AdminThankYou: { writeInKind },
  });
  await screen.open();
  await flush();
  return screen;
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const text = () => (document.getElementById("dropOffsAdmin")?.textContent || "").replace(/\s+/g, " ");

beforeEach(() => {
  document.body.innerHTML = '<section id="view-drop-offs"><div id="dropOffsAdmin"></div></section>';
  calls = [];
  writeInKind = vi.fn();
  listing = { dropOffs: [ROW()], mayRemove: true, mayWriteLetter: true };
});

describe("the list", () => {
  it("shows each drop-off: who, when, what they brought, who with, and how to reach them", async () => {
    await open();
    expect(calls[0]).toEqual({ url: "/api/admin/drop-offs", method: "GET" });
    const t = text();
    for (const words of ["Robin Example", "Two bags of selection boxes", "Church group", "robin@example.com", "07700 900123", "On the newsletter", "Sat 28 Nov", "2.15pm"]) expect(t).toContain(words);
    expect(t).toContain("No letter yet");
  });

  it("puts what people typed on the page as words, never as markup", async () => {
    listing = { ...listing, dropOffs: [ROW({ name: "<img src=x onerror=alert(1)>", brought: "<b>toys</b>" })] };
    await open();
    expect(document.querySelector("#dropOffsAdmin img")).toBeNull();
    expect(text()).toContain("<b>toys</b>");
  });

  it("says when a letter has gone", async () => {
    listing = { ...listing, dropOffs: [ROW({ letterSentAt: "2026-11-30T10:00:00.000Z" })] };
    await open();
    expect(text()).toContain("Letter sent Mon 30 Nov");
  });

  it("says plainly when nobody has dropped anything off yet", async () => {
    listing = { ...listing, dropOffs: [] };
    await open();
    expect(text()).toContain("Nobody has left their details on the workshop tablet yet.");
  });
});

describe("the buttons", () => {
  it("Write a thank you letter hands the person and what they brought to Thank you", async () => {
    await open();
    ($('[data-do-letter="3"]') as HTMLButtonElement).click();
    expect(writeInKind).toHaveBeenCalledWith({ name: "Robin Example", email: "robin@example.com", brought: "Two bags of selection boxes" });
  });

  it("are not offered to someone who may not use them", async () => {
    listing = { ...listing, mayRemove: false, mayWriteLetter: false };
    await open();
    expect($("[data-do-letter]")).toBeNull();
    expect($("[data-do-remove]")).toBeNull();
  });

  it("Remove asks first, and No leaves it alone", async () => {
    await open();
    ($('[data-do-remove="3"]') as HTMLButtonElement).click();
    expect(text()).toContain("Remove Robin Example's drop-off? This cannot be undone.");
    ($("[data-do-no]") as HTMLButtonElement).click();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect($("[data-do-yes]")).toBeNull();
  });

  it("Remove, then Yes, deletes it and reads the list again", async () => {
    await open();
    ($('[data-do-remove="3"]') as HTMLButtonElement).click();
    listing = { ...listing, dropOffs: [] };
    ($("[data-do-yes]") as HTMLButtonElement).click();
    await flush();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/admin/drop-offs/3")).toBe(true);
    expect(text()).toContain("Nobody has left their details");
  });
});
