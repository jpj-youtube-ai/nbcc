// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// TASK-511: the sign up form, round two. The questions come one after another, each once the one
// before is answered, worded for what they chose first; nothing is chosen for them in a yes or no;
// the name is in two boxes; social media is a step of its own; and printed QR codes are asked for
// by someone raising money. Without the script every question is in the page as it is. Every name
// here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/fundraising.css"), "utf8");

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function page() {
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, true), "text/html")
    .documentElement.innerHTML;
}

function load() {
  page();
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
  el.dispatchEvent(new Event("change", { bubbles: true }));
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
const steps = () => [...document.querySelectorAll<HTMLElement>("[data-step]")];
const waiting = (el: Element) => el.closest("[data-step]")!.classList.contains("is-waiting");
const shown = () => steps().filter((s) => !s.hidden && !s.classList.contains("is-waiting"));
const legendOf = (s: Element) => (s.querySelector("legend, label")?.textContent ?? "").replace(/\s+/g, " ").trim();
const news = () => $("[data-step-news]").textContent ?? "";
const sent = () => JSON.parse(String(calls.filter((c) => c.url === "/api/fundraise")[0].init?.body));

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

describe("without the script", () => {
  it("has every question in the page, none waiting to be revealed", () => {
    page();
    expect(steps().length).toBeGreaterThanOrEqual(9);
    expect(document.querySelector(".fr-stepped, .is-waiting")).toBeNull();
    // Only the questions that belong to one path start hidden, as they always have.
    expect(steps().filter((s) => s.hidden).map((s) => s.hasAttribute("data-event-questions"))).toEqual([true]);
  });

  it("chooses nothing for them in any yes or no", () => {
    page();
    for (const name of ["path", "kind", "public", "socialOk", "shoutOut", "attend"]) {
      const radios = [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
      expect(radios.length, name).toBeGreaterThan(0);
      expect(radios.some((r) => r.checked || r.hasAttribute("checked")), name).toBe(false);
      expect(radios.every((r) => r.required), name).toBe(true);
    }
    // The newsletter stays an unticked box they tick to join, as the law asks.
    expect($("#newsletterOk").type).toBe("checkbox");
    expect($("#newsletterOk").checked).toBe(false);
    expect($("#newsletterOk").required).toBe(false);
  });

  it("says plainly that the website is the NBCC website, and that help comes either way", () => {
    page();
    const q = $("#publicYes").closest("[data-step]")!.textContent!.replace(/\s+/g, " ");
    expect(q).toContain("Shall we show it on the NBCC website, on our Get involved page?");
    expect(q).toContain("Either way, we’re happy to help with posters, leaflets, collection buckets and the rest.");
  });

  it("asks the social media questions in a step of their own, before what they would like", () => {
    page();
    const social = $("#instagram").closest("[data-step]")!;
    const wants = $("#posters").closest("[data-step]")!;
    expect(social).not.toBe(wants);
    expect(legendOf(social)).toBe("Social media");
    for (const id of ["facebook", "socialOkYes", "shoutOutYes"]) expect(document.getElementById(id)!.closest("[data-step]")).toBe(social);
    for (const id of ["qrCodes", "buckets", "attendYes"]) expect(document.getElementById(id)!.closest("[data-step]")).toBe(wants);
    expect(steps().indexOf(social as HTMLElement)).toBeLessThan(steps().indexOf(wants as HTMLElement));
  });
});

describe("one question after another", () => {
  beforeEach(() => load());

  it("starts with only the first question", () => {
    expect($("#fundraiseForm").classList.contains("fr-stepped")).toBe(true);
    expect(shown()).toEqual([steps()[0]]);
  });

  it("brings the next question once the first is answered, and says so for screen readers", () => {
    tick("pathRaising");
    expect(shown()).toHaveLength(2);
    expect(waiting($("#kind-run_walk"))).toBe(false);
    expect(waiting($("#title"))).toBe(true);
    expect(news()).toBe("Next question: What are you doing to raise money?");
  });

  it("words each question for what they chose first", () => {
    tick("pathEvent");
    expect(legendOf($("#kindGroup"))).toBe("What kind of event is it?");
    expect($("#kind-run_walk").getAttribute("data-invalid-message")).toBe("Choose what kind of event it is");
    tick("pathRaising");
    expect(legendOf($("#kindGroup"))).toBe("What are you doing to raise money?");
    expect($("#kind-run_walk").getAttribute("data-invalid-message")).toBe("Choose what you are doing to raise money");
    // Never "event or fundraiser" in one breath.
    expect($("#fundraiseForm").textContent).not.toMatch(/event or fundrais|fundraiser or event|event\/|\/event/i);
  });

  it("asks what Something else is, only when it is chosen", () => {
    tick("pathEvent");
    expect($("[data-kind-other]").hidden).toBe(true);
    expect($("#kindOther").required).toBe(false);
    tick("kind-other");
    expect($("[data-kind-other]").hidden).toBe(false);
    expect($("#kindOther").required).toBe(true);
    expect($("label[for=kindOther]").textContent).toContain("What kind of event is it?");
    // The next question waits for the answer.
    expect(waiting($("#title"))).toBe(true);
    type("kindOther", "A sponsored silence");
    expect(waiting($("#title"))).toBe(false);
    tick("kind-quiz_party");
    expect($("[data-kind-other]").hidden).toBe(true);
  });

  it("brings optional questions along with the one before, and stops at the next that needs an answer", () => {
    tick("pathRaising");
    tick("kind-run_walk");
    expect(waiting($("#title"))).toBe(false);
    expect(waiting($("#target"))).toBe(true);
    type("title", "Jo's Sponsored Swim");
    type("description", "Forty lengths for NBCC.");
    // The target is optional, so the website question comes with it, and waits for its answer.
    expect(waiting($("#target"))).toBe(false);
    expect(waiting($("#publicYes"))).toBe(false);
    expect(waiting($("#firstName"))).toBe(true);
  });

  it("says plainly when the last step comes", () => {
    tick("pathRaising");
    $<HTMLButtonElement>("[data-show-all]").click();
    expect($("[data-step-title]").getAttribute("data-step-title")).toBe("Last of all: our newsletter, and sending your sign up");
  });

  it("never takes a question away again once it has been shown", () => {
    tick("pathRaising");
    tick("kind-run_walk");
    type("title", "Jo's Sponsored Swim");
    type("description", "Forty lengths.");
    type("title", "");
    expect(waiting($("#publicYes"))).toBe(false);
  });

  it("can show every question at once, and moves to the first one waiting", () => {
    tick("pathRaising");
    const btn = $<HTMLButtonElement>("[data-show-all]");
    expect($("[data-show-all-row]").hidden).toBe(false);
    btn.click();
    expect(document.querySelector(".is-waiting")).toBeNull();
    expect($("[data-show-all-row]").hidden).toBe(true);
    expect(document.activeElement).toBe($("#kind-run_walk"));
  });

  it("shows every question when Send is pressed early, flagging what is missing", async () => {
    tick("pathRaising");
    await submit();
    expect(document.querySelector(".is-waiting")).toBeNull();
    expect(calls.filter((c) => c.url === "/api/fundraise")).toHaveLength(0);
    for (const id of ["title", "firstName", "lastName", "socialOkYes", "shoutOutYes", "attendYes", "publicYes"]) {
      expect($(`#${id}`).getAttribute("aria-invalid"), id).toBe("true");
    }
  });

  it("reveals gently, and not at all for someone who asks for less motion", () => {
    tick("pathRaising");
    expect($("#kindGroup").closest("[data-step]")!.classList.contains("is-arriving")).toBe(true);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*\.fr-stepped [^{]*is-arriving[^{]*\{[^}]*animation/);
  });
});

describe("the social media step", () => {
  beforeEach(() => load());

  it("explains that a shout out needs their OK to post", () => {
    tick("shoutOutYes");
    tick("socialOkNo");
    expect($("[data-shout-note]").textContent).toBe("We can only give you a shout out if we can post about it. If that’s OK, choose Yes above.");
    tick("socialOkYes");
    expect($("[data-shout-note]").textContent).toBe("");
    tick("socialOkNo");
    tick("shoutOutNo");
    expect($("[data-shout-note]").textContent).toBe("");
  });
});

describe("printed QR codes", () => {
  beforeEach(() => load());

  it("are asked only of someone raising money, who gets a page", () => {
    tick("pathEvent");
    expect($("[data-raising-only]").hidden).toBe(true);
    tick("pathRaising");
    expect($("[data-raising-only]").hidden).toBe(false);
    expect($("label[for=qrCodes]").textContent).toBe("How many printed QR codes would you like?");
  });

  it("need an address to post them to", () => {
    tick("pathRaising");
    expect($("[data-address-field]").hidden).toBe(true);
    type("qrCodes", "20");
    expect($("[data-address-field]").hidden).toBe(false);
  });
});

function fill(path: "raising" | "event") {
  tick(path === "raising" ? "pathRaising" : "pathEvent");
  tick("kind-other");
  type("kindOther", "A sponsored silence");
  type("title", "Sam's Silent Day");
  type("description", "Not a word for a whole day.");
  type("eventDate", "2026-12-05");
  if (path === "event") {
    type("venue", "Example Village Hall");
    type("cardLine", "A quiet day for NBCC.");
    tick("booking-free");
  }
  tick("publicNo");
  type("firstName", "Sam");
  type("lastName", "Sample");
  type("email", "sam@example.com");
  type("phone", "07700 900456");
  type("instagram", "@sam.quiet");
  type("facebook", "facebook.com/samquiet");
  tick("socialOkYes");
  tick("shoutOutYes");
  type("qrCodes", "30");
  type("postLine1", "1 Example Road");
  type("postTown", "Exampleton");
  type("postPostcode", "EX1 1EX");
  tick("attendNo");
}

describe("sending", () => {
  it("sends the split name, Something else, both links, every yes or no, and QR codes", async () => {
    load();
    fill("raising");
    await submit();
    expect(sent()).toMatchObject({
      path: "raising",
      kind: "other",
      kindOther: "A sponsored silence",
      firstName: "Sam",
      lastName: "Sample",
      instagram: "@sam.quiet",
      facebook: "facebook.com/samquiet",
      socialOk: true,
      public: false,
      wants: { qrCount: 30, shoutOut: true, attend: false },
      postLine1: "1 Example Road",
    });
    expect(sent()).not.toHaveProperty("name");
    expect(sent()).not.toHaveProperty("socialLink");
  });

  it("sends no QR codes for an event", async () => {
    load();
    fill("event");
    await submit();
    expect(sent().wants.qrCount).toBe(0);
  });

  it("sends Something else's words only when it is chosen", async () => {
    load();
    fill("raising");
    tick("kind-birthday");
    await submit();
    expect(sent().kindOther).toBe("");
  });

  it("thanks them by their first name", async () => {
    load();
    fill("raising");
    await submit();
    expect($("[data-fundraise-thanks]").textContent).toContain("Thank you, Sam.");
  });

  it("puts the server's words by the new boxes", async () => {
    load();
    fill("raising");
    answer = (url) =>
      url === "/api/fundraise"
        ? { status: 400, body: { fields: { firstName: "Please tell us your first name.", instagram: "Give your Instagram name.", "wants.attend": "Tell us.", "wants.qrCount": "Too many.", kindOther: "Say what." } } }
        : { status: 200, body: { siteKey: null } };
    await submit();
    expect(document.getElementById("firstName-error")?.textContent).toBe("Please tell us your first name.");
    expect(document.getElementById("instagram-error")?.textContent).toBe("Give your Instagram name.");
    expect(document.getElementById("qrCodes-error")?.textContent).toBe("Too many.");
    expect(document.getElementById("kindOther-error")?.textContent).toBe("Say what.");
    expect($("#attendYes").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("an invite from the team", () => {
  it("fills in the first name and surname from the name on the invite", async () => {
    const token = "a".repeat(43);
    window.history.replaceState(null, "", `/fundraise?invite=${token}`);
    answer = (url) =>
      url === "/api/fundraise/invite"
        ? { status: 200, body: { name: "Robin Van Quill", email: "robin@example.com" } }
        : { status: 200, body: { siteKey: null } };
    load();
    await flush();
    await flush();
    expect($("#firstName").value).toBe("Robin");
    expect($("#lastName").value).toBe("Van Quill");
    expect($("#email").value).toBe("robin@example.com");
    window.history.replaceState(null, "", "/");
  });
});

describe("the look of a choice made", () => {
  it("is NBCC holly green: the card, its border and its tick, with a clear focus ring", () => {
    expect(css).toMatch(/\.fr-option:has\(input:checked\)\s*\{[^}]*border-color:\s*var\(--holly\)/);
    expect(css).toMatch(/\.fr-form \.give-check-box[^{]*\{[^}]*accent-color:\s*var\(--holly\)/);
    expect(css).toMatch(/\.fr-option:has\(input:focus-visible\)\s*\{[^}]*outline:[^;]*var\(--holly\)/);
  });

  it("puts Yes and No side by side, even on a phone", () => {
    expect(css).toMatch(/\.fr-options--yesno\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  });
});
