// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// TASK-494: the fundraising sign up form at /fundraise. Two paths (raising money, or holding an
// event), every field the design asks for, the address only when something is to be posted, the
// spam check loaded only when someone starts on the form, plain English errors from the server
// next to the field they belong to, a thank you, and a gentle "not open yet" if fundraising is
// switched off. Every name, address and number here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let answer: (url: string) => { status: number; body: unknown };

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function load(open = true) {
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, open), "text/html")
    .documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    return json(a.status, a.body);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  return initFundraiseForm(document, window);
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const type = (id: string, value: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const submit = async () => {
  $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
  await flush();
};
const posts = () => calls.filter((c) => c.url === "/api/fundraise");
const sent = () => JSON.parse(String(posts()[0].init?.body));

function fillRaising() {
  tick("pathRaising");
  type("title", "Jo's Sponsored Swim");
  tick("kind-run_walk");
  type("description", "Forty lengths for NBCC.");
  type("eventDate", "2026-11-14");
  type("town", "Exampleton");
  type("target", "250");
  tick("publicYes");
  type("name", "Jo Example");
  type("email", "jo@example.com");
  type("phone", "07700 900222");
}

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

describe("the two paths", () => {
  beforeEach(() => load());

  it("asks for a target only when raising money", () => {
    tick("pathEvent");
    expect($("[data-target-question]").hidden).toBe(true);
    tick("pathRaising");
    expect($("[data-target-question]").hidden).toBe(false);
  });

  it("needs a date for an event, and says so in the label", () => {
    tick("pathEvent");
    expect($("#eventDate").required).toBe(true);
    expect($("[data-date-required]").hidden).toBe(false);
    expect($("[data-date-optional]").hidden).toBe(true);
    tick("pathRaising");
    expect($("#eventDate").required).toBe(false);
  });
});

describe("what they would like", () => {
  beforeEach(() => load());

  it("asks for an address only when leaflets or a bucket are to be posted", () => {
    expect($("[data-address-field]").hidden).toBe(true);
    type("leaflets", "50");
    expect($("[data-address-field]").hidden).toBe(false);
    type("leaflets", "0");
    expect($("[data-address-field]").hidden).toBe(true);
    type("buckets", "2");
    expect($("[data-address-field]").hidden).toBe(false);
  });
});

describe("the description", () => {
  it("counts down what is left", () => {
    load();
    type("description", "x".repeat(990));
    expect($("#descriptionCount").textContent).toBe("10 characters left.");
  });
});

describe("sending", () => {
  it("sends nothing while required answers are missing, and flags each one", async () => {
    load();
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("[data-form-error]").hidden).toBe(false);
    expect($("#title").getAttribute("aria-invalid")).toBe("true");
    expect($("#phone").getAttribute("aria-invalid")).toBe("true");
  });

  it("sends exactly what the API asks for", async () => {
    load();
    fillRaising();
    type("leaflets", "25");
    type("postAddress", "1 Example Road, Exampleton, EX1 1EX");
    tick("shoutOut");
    tick("socialOk");
    tick("newsletterOk");
    await submit();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].init?.method).toBe("POST");
    expect(sent()).toEqual({
      path: "raising",
      kind: "run_walk",
      title: "Jo's Sponsored Swim",
      description: "Forty lengths for NBCC.",
      eventDate: "2026-11-14",
      startTime: "",
      venue: "",
      town: "Exampleton",
      targetPence: 25000,
      public: true,
      name: "Jo Example",
      email: "jo@example.com",
      phone: "07700 900222",
      socialLink: "",
      socialOk: true,
      wants: { leaflets: 25, buckets: 0, shoutOut: true, attend: false },
      postAddress: "1 Example Road, Exampleton, EX1 1EX",
      newsletterOk: true,
      company: "",
      captchaToken: "",
    });
  });

  it("sends no target and no address for an event with nothing posted", async () => {
    load();
    fillRaising();
    tick("pathEvent");
    tick("publicNo");
    await submit();
    expect(sent().path).toBe("event");
    expect(sent().targetPence).toBeNull();
    expect(sent().public).toBe(false);
    expect(sent().postAddress).toBe("");
  });

  it("says thank you by first name, and what happens next", async () => {
    load();
    fillRaising();
    await submit();
    const thanks = $("[data-fundraise-thanks]");
    expect(thanks.hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
    expect(thanks.textContent).toContain("Thank you, Jo.");
    expect($("[data-thanks-raising]").hidden).toBe(false);
    expect($("[data-thanks-event]").hidden).toBe(true);
    expect(document.activeElement).toBe(thanks);
  });

  it("puts each server message next to its field", async () => {
    load();
    fillRaising();
    answer = (url) =>
      url === "/api/fundraise"
        ? { status: 400, body: { error: "Some of the form needs another look", fields: { phone: "That does not look like a phone number.", "wants.buckets": "We can lend up to 20 buckets or tins." } } }
        : { status: 200, body: { siteKey: null } };
    await submit();
    expect($("#phone").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("phone-error")?.textContent).toBe("That does not look like a phone number.");
    expect(document.getElementById("buckets-error")?.textContent).toBe("We can lend up to 20 buckets or tins.");
    expect($("[data-form-error]").hidden).toBe(false);
    expect($<HTMLButtonElement>("[data-submit]").disabled).toBe(false);
  });

  it("asks for the robot check again when the server refuses it", async () => {
    load();
    fillRaising();
    answer = (url) => (url === "/api/fundraise" ? { status: 400, body: { error: "captcha" } } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("#formStatus").textContent).toMatch(/robot/);
    expect($("#formStatus").className).toContain("is-error");
  });

  it("shows the gentle not open yet message if fundraising is switched off meanwhile", async () => {
    load();
    fillRaising();
    answer = (url) => (url === "/api/fundraise" ? { status: 404, body: { error: "Fundraising is not open yet" } } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("[data-fundraise-closed]").hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
  });

  it("asks them to wait a little after too many tries", async () => {
    load();
    fillRaising();
    answer = (url) => (url === "/api/fundraise" ? { status: 429, body: {} } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("#formStatus").textContent).toMatch(/few minutes/);
  });

  it("keeps everything they typed when the network fails", async () => {
    load();
    fillRaising();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string) => (url === "/api/fundraise" ? Promise.reject(new Error("offline")) : json(200, { siteKey: null })));
    await submit();
    expect($("#formStatus").textContent).toMatch(/could not send/);
    expect($<HTMLInputElement>("#title").value).toBe("Jo's Sponsored Swim");
  });
});

describe("the spam check", () => {
  it("loads nothing from Cloudflare while the check is off", async () => {
    load();
    await flush();
    $("#title").dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });

  it("loads Cloudflare's script only once someone starts on the form", async () => {
    answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: "site-key-for-tests" } } : { status: 200, body: {} });
    load();
    await flush();
    await flush();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    $("#title").dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(document.querySelectorAll('script[src*="challenges.cloudflare.com"]')).toHaveLength(1);
  });

  it("holds a send until the check has passed", async () => {
    answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: "site-key-for-tests" } } : { status: 200, body: {} });
    load();
    await flush();
    await flush();
    fillRaising();
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("#formStatus").textContent).toMatch(/robot/);
  });
});

describe("switched off", () => {
  it("shows only the not open yet message, and the script leaves it alone", () => {
    load(false);
    expect($("[data-fundraise-closed]").hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
  });
});

describe("once the script runs", () => {
  it("shows the form and hides the no JavaScript line", () => {
    load();
    expect($("#fundraiseForm").hidden).toBe(false);
    expect($("[data-nojs]").hidden).toBe(true);
  });
});
