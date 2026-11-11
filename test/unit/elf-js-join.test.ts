// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderJoinPage } from "../../src/elf/pages/join";
import { FESTIVE_SURNAMES } from "../../src/elf/names";
import { ELF_DEFAULTS } from "../../src/elf/settings";

// NBCC Elf Detective School: the script on the enrol page. The page works without it; the script
// only tidies it. It runs here against the real page with a pretend server. Every family is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initJoin } = require(resolve(ROOT, "assets/js/elf-join.js"));

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const visibleRows = () => [...document.querySelectorAll<HTMLElement>(".elf-join-detective")].filter((r) => !r.hidden);
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

let calls: { url: string; body: Record<string, unknown> }[] = [];
let went: string[] = [];

function load(answer: { status: number; body: unknown } = { status: 200, body: { url: "https://checkout.stripe.example/c/pay" } }) {
  const html = renderJoinPage({ settings: { ...ELF_DEFAULTS, schoolOn: true }, captchaSiteKey: null, surnames: FESTIVE_SURNAMES });
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  calls = [];
  went = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return Promise.resolve({ ok: answer.status < 300, status: answer.status, json: () => Promise.resolve(answer.body) });
  });
  initJoin(document, window, { go: (url: string) => went.push(url), random: () => 0.5 });
}

describe("the enrol page's script", () => {
  it("shows one detective to start, and another each time one is added, up to 8", () => {
    load();
    expect(visibleRows().length).toBe(1);
    $("button.elf-join-add").click();
    expect(visibleRows().length).toBe(2);
    for (let i = 0; i < 10; i++) $("button.elf-join-add").click();
    expect(visibleRows().length).toBe(8);
    expect($("button.elf-join-add").hidden).toBe(true);
  });

  it("keeps the suggested amount in step with the detectives, until someone types their own", () => {
    load();
    const entry = $<HTMLInputElement>('input[name="entry"]');
    expect(entry.value).toBe("5");
    $("button.elf-join-add").click();
    expect(entry.value).toBe("10");
    entry.value = "7";
    entry.dispatchEvent(new Event("input", { bubbles: true }));
    $("button.elf-join-add").click();
    expect(entry.value).toBe("7");
  });

  it("spins a festive surname from the list", () => {
    load();
    const select = $<HTMLSelectElement>('select[name="detective-1-surname"]');
    $("button.elf-join-spin").click();
    expect(FESTIVE_SURNAMES).toContain(select.value);
    expect(select.value).toBe(FESTIVE_SURNAMES[Math.floor(0.5 * FESTIVE_SURNAMES.length)]);
  });

  it("makes its buttons of torn paper, as the page's own", () => {
    load();
    for (const sel of ["button.elf-join-spin", "button.elf-join-add"]) {
      expect($(sel).classList.contains("elf-btn"), sel).toBe(true);
      expect($(sel).classList.contains("btn"), sel).toBe(false);
    }
  });

  it("shows the Gift Aid declaration only when Gift Aid is ticked", () => {
    load();
    expect($(".elf-join-declaration").hidden).toBe(true);
    const tick = $<HTMLInputElement>('input[name="giftAid"]');
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    expect($(".elf-join-declaration").hidden).toBe(false);
  });

  it("sends the enrolment as JSON and goes to the payment page it is given", async () => {
    load();
    $<HTMLInputElement>('input[name="grownUpName"]').value = "Sam Example";
    $<HTMLInputElement>('input[name="email"]').value = "sam@example.com";
    $<HTMLInputElement>('input[name="mobile"]').value = "07700 900 123";
    $<HTMLInputElement>('input[name="detective-1-first"]').value = "Ruby";
    $<HTMLInputElement>('input[name="agreed"]').checked = true;
    $("form.elf-join-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(calls[0].url).toBe("/api/elf/join");
    expect(calls[0].body).toMatchObject({ grownUpName: "Sam Example", email: "sam@example.com", mobile: "07700 900 123", entryPence: 500, agreed: true });
    expect(calls[0].body.detectives).toEqual([{ firstName: "Ruby", surname: FESTIVE_SURNAMES[0] }]);
    expect(went).toEqual(["https://checkout.stripe.example/c/pay"]);
  });

  it("shows the server's words when something needs another look, and goes nowhere", async () => {
    load({ status: 400, body: { errors: ["Please pick a surname from the list for each detective."] } });
    $("form.elf-join-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect($(".elf-join-errors").textContent).toContain("Please pick a surname");
    expect(went).toEqual([]);
  });
});

// TASK-614: a family that has already paid, enrolling again without signing in, is not enrolled again.
// The server emails it a code and answers 200 { status: "check-email", message } (src/routes/elf.ts).
// The script used to read that as a failure and say "Something went wrong".
describe("enrolling again with an email that already has detectives", () => {
  const SERVER_WORDS = "Check your email to carry on. If you have enrolled with us before, we have sent you a code: sign in with it, then add your detectives from Detective HQ.";
  const submit = async () => {
    $("form.elf-join-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
  };

  it("says what the answer means, in the server's own words, and goes nowhere", async () => {
    load({ status: 200, body: { status: "check-email", message: SERVER_WORDS } });
    await submit();
    const notice = $(".elf-join-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toBe(SERVER_WORDS);
    expect(document.body.textContent).not.toContain("Something went wrong");
    expect(document.querySelector(".elf-join-errors")).toBeNull();
    expect(went).toEqual([]);
  });

  it("says it in its own words when the server sends none", async () => {
    load({ status: 200, body: { status: "check-email" } });
    await submit();
    expect($(".elf-join-notice").textContent).toBe("You are already signed up. We have emailed you a code to sign in.");
    expect(document.body.textContent).not.toContain("Something went wrong");
  });

  it("takes away a refusal shown before, and says it once however often the form is sent", async () => {
    load({ status: 400, body: { errors: ["Please pick a surname from the list for each detective."] } });
    await submit();
    expect(document.querySelector(".elf-join-errors")).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "check-email", message: SERVER_WORDS }) }));
    await submit();
    await submit();
    expect(document.querySelector(".elf-join-errors")).toBeNull();
    expect(document.querySelectorAll(".elf-join-notice")).toHaveLength(1);
  });

  it("draws the news on the same torn paper note a refusal has, so the page's look does not change", () => {
    const css = readFileSync(resolve(ROOT, "assets/css/elf.css"), "utf8");
    expect(css).toMatch(/\.elf-join-errors,\s*\.elf-join-notice \{ position: relative;/);
    expect(css).toMatch(/\.elf-join-errors::before,\s*\.elf-join-notice::before \{ content: "";/);
  });

  it("takes the news away again if the next answer is a refusal", async () => {
    load({ status: 200, body: { status: "check-email", message: SERVER_WORDS } });
    await submit();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ errors: ["Please type a UK mobile number, like 07700 900 123."] }) }));
    await submit();
    expect(document.querySelector(".elf-join-notice")).toBeNull();
    expect($(".elf-join-errors").textContent).toContain("Please type a UK mobile number, like 07700 900 123.");
  });
});
