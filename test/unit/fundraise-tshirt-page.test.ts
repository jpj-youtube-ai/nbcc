// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { TSHIRT_SIZES } from "../../src/fundraising/signup-tidy";

// The sign up tidy (Jaimie, 2026-10-03): the private page an organiser opens from the email staff
// send to ask for their T shirt size. The link's token rides after the # and comes out of the address
// bar at once; the page asks the server who it is for, offers the sizes with nothing chosen, and
// saves the choice once. A link that no longer works says so kindly. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initTshirtPage } = require(resolve(ROOT, "assets/js/fundraise-tshirt.js"));
const template = readFileSync(resolve(ROOT, "fundraise-tshirt.html"), "utf8");
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

let calls: Array<{ url: string; body: Record<string, unknown> | null }>;
let answer: (url: string) => { status: number; body: unknown };

function load(hash = `#${TOKEN}`) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(template, "text/html").documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const a = answer(url);
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  window.history.replaceState(null, "", `/fundraise/t-shirt${hash}`);
  return initTshirtPage(document, window);
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const submit = async () => {
  $("#tshirtForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};

beforeEach(() => {
  answer = (url) =>
    url === "/api/fundraise/tshirt/look"
      ? { status: 200, body: { firstName: "Sam", title: "Sam's Walk", sizes: TSHIRT_SIZES } }
      : { status: 200, body: { status: "saved" } };
});

describe("the page to choose a T shirt size", () => {
  it("is never indexed, and has no hyphen in its words", () => {
    expect(template).toContain('<meta name="robots" content="noindex, nofollow" />');
    const body = new DOMParser().parseFromString(template, "text/html").body;
    body.querySelectorAll("script, style, svg").forEach((n) => n.remove());
    expect(body.textContent).not.toMatch(/\w-\w/);
  });

  it("takes the link out of the address bar and asks who it is for", async () => {
    load();
    expect(window.location.hash).toBe("");
    await flush();
    expect(calls[0]).toEqual({ url: "/api/fundraise/tshirt/look", body: { token: TOKEN } });
    expect($("#tshirtForm").hidden).toBe(false);
    expect($("[data-tshirt-name]").textContent).toBe(", Sam");
    expect($("[data-tshirt-lede]").textContent).toContain("Sam's Walk");
  });

  it("offers every size, kids then adults, with nothing chosen", async () => {
    load();
    await flush();
    const select = $<HTMLSelectElement>("#tshirtSize");
    expect(select.value).toBe("");
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Kids", "Adults"]);
    expect([...select.querySelectorAll("optgroup option")].map((o) => (o as HTMLOptionElement).value)).toEqual(TSHIRT_SIZES.map((s) => s.key));
  });

  it("asks warmly for a size before saving", async () => {
    load();
    await flush();
    await submit();
    expect(document.getElementById("tshirtSize-error")!.textContent).toBe("Almost! Just choose a T shirt size.");
    expect(calls.filter((c) => c.url === "/api/fundraise/tshirt")).toHaveLength(0);
  });

  it("saves the choice and thanks them", async () => {
    load();
    await flush();
    $<HTMLSelectElement>("#tshirtSize").value = "adult_m";
    await submit();
    expect(calls.find((c) => c.url === "/api/fundraise/tshirt")!.body).toEqual({ token: TOKEN, tshirtSize: "adult_m" });
    expect($("[data-tshirt-thanks]").hidden).toBe(false);
    expect($("[data-thanks-size]").textContent).toBe("Adult M");
    expect($("#tshirtForm").hidden).toBe(true);
  });

  it("says kindly when the link no longer works, or there is none", async () => {
    answer = () => ({ status: 404, body: { error: "gone" } });
    load();
    await flush();
    expect($("[data-tshirt-gone]").hidden).toBe(false);
    expect($("#tshirtForm").hidden).toBe(true);
    load("");
    await flush();
    expect($("[data-tshirt-gone]").hidden).toBe(false);
  });
});
