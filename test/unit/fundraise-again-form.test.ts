// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// TASK-515: the sign up form opened from email 18's Do it again link (/fundraise?again=...). It asks
// the server for last year's details by POST, takes the token out of the address at once, fills in
// only the boxes still empty, and carries the token back with the sign up. A link that no longer
// works changes nothing. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let answer: { status: number; body: unknown };

const LAST_YEAR = {
  path: "raising",
  kind: "santa_dash",
  kindOther: null,
  title: "Sam's Santa Dash 2027",
  description: "A mile in Santa suits.",
  targetPence: 50000,
  venue: "Riverside Park",
  town: "Exampleton",
  instagram: "sams.dash",
  facebook: null,
  firstName: "Sam",
  lastName: "Example",
  email: "sam@example.com",
  phone: "07700 900123",
};

function load(search: string, before?: () => void) {
  window.history.replaceState({}, "", "/fundraise" + search);
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderFundraiseSignUp(template, true), "text/html").documentElement.innerHTML;
  if (before) before();
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = url === "/api/fundraise/again" ? answer : { status: 200, body: { siteKey: null } };
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  return initFundraiseForm(document, window);
}
const $ = (sel: string) => document.querySelector<HTMLInputElement>(sel)!;
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const againCalls = () => calls.filter((c) => c.url === "/api/fundraise/again");

beforeEach(() => {
  answer = { status: 200, body: LAST_YEAR };
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("a form opened from Do it again", () => {
  it("asks by POST and fills in last year's details", async () => {
    const form = load(`?again=${TOKEN}`);
    await settle();
    expect(againCalls()).toHaveLength(1);
    expect(againCalls()[0].init?.method).toBe("POST");
    expect(JSON.parse(String(againCalls()[0].init?.body))).toEqual({ token: TOKEN });
    expect($('input[name="path"][value="raising"]').checked).toBe(true);
    expect($('input[name="kind"][value="santa_dash"]').checked).toBe(true);
    expect($("#title").value).toBe("Sam's Santa Dash 2027");
    expect($("#description").value).toBe("A mile in Santa suits.");
    expect($("#target").value).toBe("500");
    expect($("#venue").value).toBe("Riverside Park");
    expect($("#town").value).toBe("Exampleton");
    expect($("#instagram").value).toBe("sams.dash");
    expect($("#firstName").value).toBe("Sam");
    expect($("#lastName").value).toBe("Example");
    expect($("#email").value).toBe("sam@example.com");
    expect($("#phone").value).toBe("07700 900123");
    // Never the date: that is this year's to choose.
    expect($("#eventDate").value).toBe("");
    expect(form.payload().again).toBe(TOKEN);
  });

  it("takes the token out of the address at once, keeping the rest", async () => {
    const form = load(`?ref=email&again=${TOKEN}`);
    expect(window.location.search).toBe("?ref=email");
    expect(window.location.href).not.toContain(TOKEN);
    await settle();
    expect(form.payload().again).toBe(TOKEN);
  });

  it("leaves anything already typed, and a choice already made", async () => {
    // The sign up tidy (Jaimie, 2026-10-03): a category belongs to a path, so a choice of category
    // is only kept alongside the choice of what they are planning (the first question).
    load(`?again=${TOKEN}`, () => {
      ($("#title") as HTMLInputElement).value = "My own name for it";
      ($('input[name="path"][value="event"]') as HTMLInputElement).checked = true;
      ($('input[name="kind"][value="bake_sale_2"]') as HTMLInputElement).checked = true;
    });
    await settle();
    expect($("#title").value).toBe("My own name for it");
    expect($('input[name="path"][value="event"]').checked).toBe(true);
    expect($('input[name="path"][value="raising"]').checked).toBe(false);
    expect($('input[name="kind"][value="bake_sale_2"]').checked).toBe(true);
    expect($('input[name="kind"][value="santa_dash"]').checked).toBe(false);
  });

  it("changes nothing when the link no longer works", async () => {
    answer = { status: 404, body: { error: "That link has expired or already been used. You can still fill in the form." } };
    const form = load(`?again=${TOKEN}`);
    await settle();
    expect($("#title").value).toBe("");
    expect(form.payload().again).toBeUndefined();
  });

  it("never fills in a box it was not given, whatever comes back", async () => {
    answer = { status: 200, body: { ...LAST_YEAR, eventDate: "2027-12-05", postLine1: "1 Example Street", nbccCheck: "spam" } };
    const form = load(`?again=${TOKEN}`);
    await settle();
    expect($("#eventDate").value).toBe("");
    expect($("#postLine1").value).toBe("");
    expect(form.payload().nbccCheck).toBe("");
  });
});
