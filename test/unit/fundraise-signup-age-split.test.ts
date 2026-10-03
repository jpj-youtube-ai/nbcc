// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// Jaimie, 2026-10-03: two more questions on the sign up form, on every path, each a yes or no with
// nothing chosen for them. "Are you 18 or over?" comes early: a No stops the form there, with a kind
// note saying what to do instead. "Are you sharing what you raise with another cause?" asks, on a
// Yes, for NBCC's percentage and the other cause's name. The server checks both again.
//
// The sign up tidy (Jaimie, 2026-10-03): one step at a time, so "stops the form there" is Next
// staying on that step, and a Yes to sharing is followed by a step to check the split
// (test/unit/fundraise-signup-tidy-form.test.ts holds the check itself). Every name here, the other
// cause's included, is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

// A walk through every step is a few seconds in jsdom on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

// The sign up tidy: warmer, with no example to copy.
const UNDER_18 =
  "You need to be 18 or over to sign up. A parent, carer or another adult you trust can do it for you and name you on the page. If you'd like to talk it through, call 01292 811 015 or email events@nbcc.scot.";

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

function page() {
  rememberCategories(ALL_BUILT_IN_CATEGORIES);
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, true, formCategories(), memoryCategories()), "text/html")
    .documentElement.innerHTML;
}

function load(search = "") {
  page();
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  w.NBCCSocialHandles = socialHandles;
  w.NBCCFormSteps = stepsLib;
  window.history.replaceState(null, "", `/fundraise${search}`);
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
const sends = () => calls.filter((c) => c.url === "/api/fundraise");
const sent = () => JSON.parse(String(sends()[0].init?.body));
const nextBtn = () => $<HTMLButtonElement>("[data-next]");
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const has = (id: string) => current().contains(document.getElementById(id));
const errorOf = (id: string) => document.getElementById(`${id}-error`)?.textContent ?? "";
/** Press Next until the last step, or until a step holds them with something to put right. */
const walk = () => {
  for (let i = 0; i < 40 && !nextBtn().hidden; i++) {
    const before = current();
    nextBtn().click();
    if (current() === before) break;
  }
};
/** To the last step (Check and send), saying which step held them if one did. */
const toEnd = () => {
  walk();
  if (!nextBtn().hidden) {
    const held = [...current().querySelectorAll('[aria-invalid="true"]')].map((n) => n.id).join(", ");
    throw new Error(`held at "${current().querySelector("legend, h2, label")?.textContent}" by: ${held}`);
  }
};

function fill(path: "raising" | "event") {
  tick(path === "raising" ? "pathRaising" : "pathEvent");
  tick("over18Yes");
  if (path === "raising") tick("childMe");
  tick("orgNo");
  type("firstName", "Sam");
  type("lastName", "Sample");
  type("email", "sam@example.com");
  type("phone", "07700 900456");
  // Team pages, and the sign up tidy: someone raising money is asked "Just me, or a team?" and
  // whether it is a sporting event.
  if (path === "raising") {
    tick("teamMe");
    tick("sportingNo");
  }
  tick("kind-quiz");
  type("title", "Sam's Quiz");
  type("description", "Ten rounds for NBCC.");
  type("eventDate", "2026-12-05");
  if (path === "event") {
    type("venue", "Example Village Hall");
    type("cardLine", "A long quiz for NBCC.");
    tick("booking-free");
  }
  tick("listedNo");
  tick("sharesNo");
  tick("shareMention");
  tick("attendNo");
  type("postLine1", "1 Example Road");
  type("postTown", "Exampleton");
  type("postPostcode", "EX1 1EX");
}

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

describe("18 or over, in the page as it is", () => {
  it("is asked early, straight after what they are planning, with nothing chosen", () => {
    page();
    const step = $("#over18Yes").closest("[data-step]")!;
    expect(steps().indexOf(step as HTMLElement)).toBe(1);
    // Every path is asked it.
    expect(step.hasAttribute("data-paths")).toBe(false);
    expect(step.querySelector("legend")!.textContent!.replace(/\s+/g, " ").trim()).toBe("Are you 18 or over?");
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="over18"]')];
    expect(radios.map((r) => r.value)).toEqual(["yes", "no"]);
    expect(radios.some((r) => r.checked || r.hasAttribute("checked"))).toBe(false);
    expect(radios.every((r) => r.required)).toBe(true);
    // The sign up tidy: a warm prompt, and a gentle one in memory of someone.
    expect($("#over18Yes").getAttribute("data-invalid-message")).toBe("Almost! Just tell us whether you're 18 or over.");
    expect($("#over18Yes").getAttribute("data-invalid-memory")).toBe("Please tell us whether you are 18 or over.");
  });

  it("has a polite live note for a No, empty to start", () => {
    page();
    const note = $("[data-age-note]");
    expect(note.getAttribute("aria-live")).toBe("polite");
    expect(note.textContent).toBe("");
  });

  // Review fix: a live region a screen reader can announce must be in the page while it is empty, so
  // the note is never display:none, even empty (as .fr-note:empty would make it).
  it("keeps the live note in the page while it is empty, so what it says is announced", () => {
    page();
    const note = $("[data-age-note]");
    expect(note.classList.contains("fr-note--live")).toBe(true);
    const css = readFileSync(resolve(ROOT, "assets/css/fundraising.css"), "utf8");
    const live = /\.fr-note--live:empty\s*\{([^}]*)\}/.exec(css);
    expect(live, "no .fr-note--live:empty rule").not.toBeNull();
    expect(live![1]).toMatch(/display:\s*block/);
    // After the rule that hides an empty note, so it wins.
    expect(css.indexOf(".fr-note--live:empty")).toBeGreaterThan(css.indexOf(".fr-note:empty"));
  });

  it("marks each new yes or no as required on its group, where the ARIA belongs, not on each radio", () => {
    page();
    for (const name of ["over18", "sharesWithOther"]) {
      const radios = [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
      for (const r of radios) expect(r.hasAttribute("aria-required"), name).toBe(false);
      const group = radios[0].closest('[role="radiogroup"]')!;
      expect(group, name).not.toBeNull();
      expect(group.getAttribute("aria-required"), name).toBe("true");
      for (const r of radios) expect(r.closest('[role="radiogroup"]'), name).toBe(group);
    }
  });
});

describe("a No to 18 or over", () => {
  beforeEach(() => load());

  it("says kindly what to do instead, on every path", () => {
    for (const id of ["pathRaising", "pathEvent", "pathMemory"]) {
      tick(id);
      tick("over18No");
      expect($("[data-age-note]").textContent, id).toBe(UNDER_18);
      tick("over18Yes");
      expect($("[data-age-note]").textContent, id).toBe("");
    }
  });

  // Was "stops the form there: nothing after it comes" (the next question never arrived). Now Next
  // stays on the step, however often it is pressed.
  it("stops the form there: Next goes no further", () => {
    tick("pathRaising");
    nextBtn().click();
    tick("over18No");
    expect($("#fundraiseForm").classList.contains("fr-under-18")).toBe(true);
    nextBtn().click();
    nextBtn().click();
    expect(has("over18No")).toBe(true);
    expect(document.activeElement).toBe($("#over18No"));
    // No red on the question: they answered it. The note says what to do.
    expect($("#over18Yes").getAttribute("aria-invalid")).not.toBe("true");
  });

  it("marks every step after it, so the page can keep them out of sight while it is No", () => {
    fill("raising");
    tick("over18No");
    const after = steps().slice(2);
    expect(after.length).toBeGreaterThan(3);
    for (const s of after) expect(s.hasAttribute("data-after-age")).toBe(true);
    expect($("#over18Yes").closest("[data-step]")!.hasAttribute("data-after-age")).toBe(false);
    expect($("#pathRaising").closest("[data-step]")!.hasAttribute("data-after-age")).toBe(false);
  });

  it("sends nothing, even when Send is pressed, and goes back to the question", async () => {
    fill("raising");
    toEnd();
    tick("over18No");
    await submit();
    expect(sends()).toHaveLength(0);
    expect($("[data-age-note]").textContent).toBe(UNDER_18);
    expect(has("over18No")).toBe(true);
  });

  it("lets them carry on once they choose Yes", async () => {
    fill("raising");
    tick("over18No");
    walk();
    expect(has("over18No")).toBe(true);
    tick("over18Yes");
    expect($("[data-age-note]").textContent).toBe("");
    expect($("#fundraiseForm").classList.contains("fr-under-18")).toBe(false);
    toEnd();
    await submit();
    expect(sends()).toHaveLength(1);
    expect(sent().over18).toBe(true);
  });

  it("is kept out of the CSS's way only while it is No", () => {
    const css = readFileSync(resolve(ROOT, "assets/css/fundraising.css"), "utf8");
    expect(css).toMatch(/\.fr-under-18 \[data-after-age\]\s*\{[^}]*display:\s*none/);
  });
});

describe("sharing with another cause, in the page as it is", () => {
  it("is asked of every path, with nothing chosen", () => {
    page();
    const step = $("#sharesYes").closest("[data-step]")!;
    expect(step.hasAttribute("data-event-questions")).toBe(false);
    expect(step.hasAttribute("data-paths")).toBe(false);
    expect(step.closest("[data-paths]")).toBeNull();
    expect(step.querySelector("legend")!.textContent!.replace(/\s+/g, " ").trim()).toBe("Are you sharing what you raise with another cause?");
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="sharesWithOther"]')];
    expect(radios.map((r) => r.value)).toEqual(["yes", "no"]);
    expect(radios.some((r) => r.checked || r.hasAttribute("checked"))).toBe(false);
    expect(radios.every((r) => r.required)).toBe(true);
  });

  it("asks for the percentage and the name only on a Yes", () => {
    page();
    expect($("[data-split-fields]").hidden).toBe(true);
    expect($("#nbccSharePercent").min).toBe("1");
    expect($("#nbccSharePercent").max).toBe("99");
    expect($("#nbccSharePercent").step).toBe("1");
    expect($("#otherCauseName").maxLength).toBe(120);
    expect($("label[for=nbccSharePercent]").textContent!.replace(/\s+/g, " ").trim()).toBe("What percentage comes to NBCC? *");
    expect($("label[for=otherCauseName]").textContent!.replace(/\s+/g, " ").trim()).toBe("The other cause’s name *");
  });
});

describe("sharing with another cause", () => {
  beforeEach(() => load());

  it("shows the two boxes on a Yes, and hides and clears them on a No", () => {
    tick("sharesYes");
    expect($("[data-split-fields]").hidden).toBe(false);
    type("nbccSharePercent", "60");
    type("otherCauseName", "Exampleton Food Larder");
    tick("sharesNo");
    expect($("[data-split-fields]").hidden).toBe(true);
    expect($("#nbccSharePercent").value).toBe("");
    expect($("#otherCauseName").value).toBe("");
  });

  // Was "waits for both boxes before the next question". Now Next stays on the step until both are
  // given, then goes to the check of the split.
  it("waits on Next for both boxes, then asks them to check the split", () => {
    fill("event");
    tick("sharesYes");
    walk();
    expect(has("sharesYes")).toBe(true);
    expect(errorOf("nbccSharePercent")).toBe("Almost! Just add a whole number from 1 to 99.");
    expect(errorOf("otherCauseName")).toBe("Almost! Just add the other cause’s name.");
    type("nbccSharePercent", "60");
    nextBtn().click();
    expect(has("sharesYes")).toBe(true);
    type("otherCauseName", "Exampleton Food Larder");
    nextBtn().click();
    expect(has("splitConfirmed")).toBe(true);
    // And on a No there is no split to check.
    $<HTMLButtonElement>("[data-back]").click();
    tick("sharesNo");
    nextBtn().click();
    expect(has("shareMention")).toBe(true);
  });

  it("sends the split on a Yes, once it is ticked as right", async () => {
    fill("event");
    tick("sharesYes");
    type("nbccSharePercent", "60");
    type("otherCauseName", "Exampleton Food Larder");
    walk();
    // Held at the check until it is ticked.
    expect(has("splitConfirmed")).toBe(true);
    tick("splitConfirmed");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({
      path: "event",
      over18: true,
      sharesWithOther: true,
      nbccSharePercent: "60",
      otherCauseName: "Exampleton Food Larder",
      splitConfirmed: true,
    });
  });

  it("sends a plain No, and no percentage or name", async () => {
    fill("raising");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: "", splitConfirmed: false });
  });

  it("puts the server's messages beside their boxes", async () => {
    answer = (url) =>
      url === "/api/fundraise/captcha"
        ? { status: 200, body: { siteKey: null } }
        : { status: 400, body: { error: "x", fields: { nbccSharePercent: "Give a whole number from 1 to 99.", over18: "Tell us whether you are 18 or over.", splitConfirmed: "Tick to say the split is right." } } };
    fill("raising");
    tick("sharesYes");
    type("nbccSharePercent", "60");
    type("otherCauseName", "Exampleton Food Larder");
    tick("splitConfirmed");
    toEnd();
    await submit();
    expect($("#nbccSharePercent").getAttribute("aria-invalid")).toBe("true");
    expect($("#over18Yes").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("nbccSharePercent")).toBe("Give a whole number from 1 to 99.");
    expect(errorOf("splitConfirmed")).toBe("Tick to say the split is right.");
    // Back to the first of them.
    expect(has("over18Yes")).toBe(true);
  });
});

describe("a link that fills the form in", () => {
  it("never answers 18 or over for them, from a staff invite", async () => {
    answer = (url) =>
      url === "/api/fundraise/invite"
        ? { status: 200, body: { name: "Sam Sample", email: "sam@example.com", over18: true } }
        : { status: 200, body: { siteKey: null } };
    load(`?invite=${"a".repeat(43)}`);
    await flush();
    await flush();
    expect($("#email").value).toBe("sam@example.com");
    expect(document.querySelector('input[name="over18"]:checked')).toBeNull();
  });

  it("never answers 18 or over, or the split, from Do it again", async () => {
    answer = (url) =>
      url === "/api/fundraise/again"
        ? { status: 200, body: { path: "raising", kind: "walk", title: "Sam's Walk", over18: true, sharesWithOther: true, splitConfirmed: true } }
        : { status: 200, body: { siteKey: null } };
    load(`?again=${"b".repeat(43)}`);
    await flush();
    await flush();
    expect($("#title").value).toBe("Sam's Walk");
    expect(document.querySelector('input[name="over18"]:checked')).toBeNull();
    expect(document.querySelector('input[name="sharesWithOther"]:checked')).toBeNull();
    expect($("#splitConfirmed").checked).toBe(false);
  });
});
