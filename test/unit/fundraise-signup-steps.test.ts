// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// TASK-511: the sign up form, round two. Each question is worded for what they chose first; nothing
// is chosen for them in a yes or no; the name is in two boxes; social media is a step of its own; and
// printed QR codes can be asked for. Without the script every question is in the page as it is.
//
// The sign up tidy (Jaimie, 2026-10-03): the questions no longer arrive one after another as each is
// answered. One step shows at a time, with Next and Back (assets/js/fundraise-steps.js), and
// test/unit/fundraise-signup-tidy-form.test.ts holds that mechanism. What is here is what TASK-511
// asked for that still stands, walked through with Next. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const css = readFileSync(resolve(ROOT, "assets/css/fundraising.css"), "utf8");

// A walk through every step is a few seconds in jsdom on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function page() {
  rememberCategories(ALL_BUILT_IN_CATEGORIES);
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, true, formCategories(), memoryCategories()), "text/html")
    .documentElement.innerHTML;
}

function load() {
  page();
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    return json(a.status, a.body);
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  w.NBCCSocialHandles = socialHandles;
  w.NBCCFormSteps = stepsLib;
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
const legendOf = (s: Element) => (s.querySelector("legend, h2, label")?.textContent ?? "").replace(/\s+/g, " ").trim();
const news = () => $("[data-step-news]").textContent ?? "";
const sent = () => JSON.parse(String(calls.filter((c) => c.url === "/api/fundraise")[0].init?.body));
const nextBtn = () => $<HTMLButtonElement>("[data-next]");
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const has = (id: string) => current().contains(document.getElementById(id));
/** Press Next until the last step, or until a step holds them with something to put right. */
const walk = () => {
  const seen: string[] = [legendOf(current())];
  for (let i = 0; i < 40 && !nextBtn().hidden; i++) {
    const before = current();
    nextBtn().click();
    if (current() === before) break;
    seen.push(legendOf(current()));
  }
  return seen;
};
/** To the last step (Check and send), saying which step held them if one did. */
const toEnd = () => {
  walk();
  if (!nextBtn().hidden) {
    const held = [...current().querySelectorAll('[aria-invalid="true"]')].map((n) => n.id).join(", ");
    throw new Error(`held at "${legendOf(current())}" by: ${held}`);
  }
};

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

describe("without the script", () => {
  it("has every question in the page, none waiting to be shown", () => {
    page();
    expect(steps().length).toBeGreaterThanOrEqual(9);
    expect(document.querySelector(".fr-stepped, .is-waiting, .fr-wizard, .is-off")).toBeNull();
    // Only the two questions that follow an answer start hidden: the t-shirt size (a sporting event)
    // and the check of the split (sharing with another cause).
    expect(steps().filter((s) => s.hidden).map((s) => s.hasAttribute("data-tshirt-step") || s.hasAttribute("data-split-check"))).toEqual([true, true]);
  });

  it("chooses nothing for them in any yes or no", () => {
    page();
    const asked = ["path", "kind", "over18", "childFundraiser", "forOrganisation", "team", "isSporting", "listed", "sharesWithOther", "share", "memoryShare"];
    // Asked only once another answer calls for them (fundraise.js marks them needed then).
    const later = ["attend", "employerMatch", "memorySetupBy", "memoryShowTarget", "teamShareMode"];
    for (const name of [...asked, ...later]) {
      const radios = [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
      expect(radios.length, name).toBeGreaterThan(0);
      expect(radios.some((r) => r.checked || r.hasAttribute("checked")), name).toBe(false);
      if (asked.includes(name)) expect(radios.every((r) => r.required), name).toBe(true);
    }
    // The t-shirt size starts on "Choose a size", never on a size.
    expect($<HTMLSelectElement>("#tshirtSize").value).toBe("");
    // The newsletter stays an unticked box they tick to join, as the law asks; so do the ticks that
    // give a permission.
    expect($("#newsletterOk").type).toBe("checkbox");
    expect($("#newsletterOk").checked).toBe(false);
    expect($("#newsletterOk").required).toBe(false);
    for (const id of ["childConsent", "memoryPermission", "splitConfirmed"]) expect($(`#${id}`).hasAttribute("checked"), id).toBe(false);
  });

  // The sign up tidy (Jaimie, 2026-10-03): "Shall we show it on the NBCC website?" (publicYes and
  // publicNo) is now "Shall we list it on our Get involved page?" (listedYes and listedNo): every
  // sign up gets a page, and the answer only says whether it is listed.
  it("says plainly what listing it means, and that it gets a page either way", () => {
    page();
    const q = $("#listedYes").closest("[data-step]")!;
    expect(legendOf(q)).toBe("Shall we list it on our Get involved page?");
    expect(document.querySelector("#publicYes, #publicNo")).toBeNull();
    const words = (id: string) => $(`label[for=${id}]`).textContent!.replace(/\s+/g, " ").trim();
    expect(words("listedYes")).toBe("Yes, list it, so anyone can find itOnce we have checked it with you, it goes on our Get involved page at nbcc.scot.");
    expect(words("listedNo")).toBe("No, only people you send the link toIt still gets its own page. We just won’t list it.");
  });

  it("asks the social media questions in a step of their own, before what they would like", () => {
    page();
    const social = $("#instagram").closest("[data-step]")!;
    const wants = $("#posters").closest("[data-step]")!;
    expect(social).not.toBe(wants);
    expect(legendOf(social)).toBe("Social media");
    for (const id of ["facebook", "shareShout", "shareMention", "shareNo", "memoryShareYes"]) expect(document.getElementById(id)!.closest("[data-step]")).toBe(social);
    for (const id of ["qrCodes", "buckets", "attendYes"]) expect(document.getElementById(id)!.closest("[data-step]")).toBe(wants);
    expect(steps().indexOf(social as HTMLElement)).toBeLessThan(steps().indexOf(wants as HTMLElement));
  });
});

function fill(path: "raising" | "event") {
  tick(path === "raising" ? "pathRaising" : "pathEvent");
  tick("over18Yes");
  if (path === "raising") tick("childMe");
  tick("orgNo");
  type("firstName", "Sam");
  type("lastName", "Sample");
  type("email", "sam@example.com");
  type("phone", "07700 900456");
  if (path === "raising") {
    tick("teamMe");
    tick("sportingNo");
  }
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
  tick("listedNo");
  tick("sharesNo");
  type("instagram", "@sam.quiet");
  type("facebook", "facebook.com/samquiet");
  tick("shareShout");
  type("qrCodes", "30");
  tick("attendNo");
  type("postLine1", "1 Example Road");
  type("postTown", "Exampleton");
  type("postPostcode", "EX1 1EX");
}

// The sign up tidy (Jaimie, 2026-10-03): these TASK-511 tests are gone, with what they tested:
//   - "brings optional questions along with the one before", "never takes a question away again once
//     it has been shown", "waits for them to leave the box, or to pause" and "comes at once when they
//     leave the box": questions are no longer revealed as the one before is answered or typed in.
//   - "can show every question at once" and "stops stepping, takes Show all away": there is no
//     "Show all the questions at once" button any more.
//   - "starts with only the first question" and "reveals gently, and not at all for someone who asks
//     for less motion": now one step at a time, held by fundraise-signup-tidy-form.test.ts.
describe("one question at a time", () => {
  beforeEach(() => load());

  it("asks someone raising money each question in turn, on Next", () => {
    fill("raising");
    expect(walk()).toEqual([
      // Jaimie, 2026-10-03: the fun part first, then who they are.
      "What are you planning?",
      "Are you 18 or over?",
      "Just me, or a team?",
      "Is it a sporting event?",
      "What are you doing to raise money?",
      "Tell us about your fundraising",
      "Your target (optional)",
      "Who is doing the fundraising?",
      "Are you fundraising for a business, school or group?",
      "Shall we list it on our Get involved page?",
      "Your details",
      "Your address",
      "Are you sharing what you raise with another cause?",
      "Social media",
      "What would you like from us?",
      "Check your answers",
    ]);
  });

  it("asks someone holding an event only what fits an event", () => {
    fill("event");
    expect(walk()).toEqual([
      "What are you planning?",
      "Are you 18 or over?",
      "What kind of event is it?",
      "Tell us about your event",
      "For your event’s card",
      "Is there an amount you hope to raise? (optional)",
      "Are you fundraising for a business, school or group?",
      "Shall we list it on our Get involved page?",
      "Your details",
      "Your address",
      "Are you sharing what you raise with another cause?",
      "Social media",
      "What would you like from us?",
      "Check your answers",
    ]);
  });

  it("words each question for what they chose first", () => {
    tick("pathEvent");
    expect(legendOf($("#kindGroup"))).toBe("What kind of event is it?");
    expect($("#kind-bake_sale_2").getAttribute("data-invalid-message")).toBe("Almost! Just choose what kind of event it is.");
    tick("pathRaising");
    expect(legendOf($("#kindGroup"))).toBe("What are you doing to raise money?");
    expect($("#kind-bake_sale_2").getAttribute("data-invalid-message")).toBe("Almost! Just choose what you're doing to raise money.");
    // Never "event or fundraiser" in one breath.
    expect($("#fundraiseForm").textContent).not.toMatch(/event or fundrais|fundraiser or event|event\/|\/event/i);
  });

  it("asks what Other is, only when it is chosen, and Next waits for it", () => {
    fill("event");
    tick("kind-quiz");
    expect($("[data-kind-other]").hidden).toBe(true);
    expect($("#kindOther").required).toBe(false);
    tick("kind-other");
    type("kindOther", "");
    expect($("[data-kind-other]").hidden).toBe(false);
    expect($("#kindOther").required).toBe(true);
    // The sign up tidy: one label for every path.
    expect($("label[for=kindOther]").textContent!.replace(/\s+/g, " ").trim()).toBe("Tell us in a few words *");
    // Next stays on the question until it is answered.
    walk();
    expect(has("kindOther")).toBe(true);
    expect(document.getElementById("kindOther-error")?.textContent).toBe("Almost! Just tell us in a few words.");
    type("kindOther", "A sponsored silence");
    nextBtn().click();
    expect(has("title")).toBe(true);
    tick("kind-quiz");
    expect($("[data-kind-other]").hidden).toBe(true);
  });

  it("says plainly when the last step comes", () => {
    fill("raising");
    toEnd();
    expect(current().getAttribute("data-step-title")).toBe("Last of all: check your answers, and send");
    expect(news()).toBe("Step 5 of 5, Check and send: Last of all: check your answers, and send");
    expect($("[data-submit]").textContent).toBe("Send my sign up");
  });

  // Was "shows every question when Send is pressed early, flagging what is missing". Now Send is
  // only on the last step, and anything missing takes them back to the first step with a problem.
  it("goes back to the first step with something missing when Send is pressed, and sends nothing", async () => {
    fill("raising");
    toEnd();
    type("title", "");
    type("lastName", "");
    await submit();
    expect(calls.filter((c) => c.url === "/api/fundraise")).toHaveLength(0);
    for (const id of ["title", "lastName"]) expect($(`#${id}`).getAttribute("aria-invalid"), id).toBe("true");
    // The name for it comes before Your details (Jaimie, 2026-10-03: the fundraiser first).
    expect(has("title")).toBe(true);
    expect(document.activeElement).toBe($("#title"));
    expect(document.getElementById("title-error")?.textContent).toBe("Almost! Just give it a name, like Sam’s Santa Dash.");
  });
});

// The sign up tidy (Jaimie, 2026-10-03): "explains that a shout out needs their OK to post" is gone:
// the two questions (may we post, and would you like a shout out) are one, so they cannot disagree.
describe("the social media step", () => {
  beforeEach(() => load());

  it("asks one question, with nothing chosen: a shout out, a mention, or no thanks", () => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="share"]')];
    expect(radios.map((r) => [r.id, r.value, r.closest("label")!.textContent])).toEqual([
      ["shareShout", "shout", "Yes, give me a shout out"],
      ["shareMention", "mention", "Yes, you can mention it"],
      ["shareNo", "no", "No thanks"],
    ]);
    expect($("#shareGroup legend").textContent!.replace(/\s+/g, " ").trim()).toBe("Shall we share it on NBCC’s Facebook and Instagram? *");
    for (const id of ["socialOkYes", "socialOkNo", "shoutOutYes", "shoutOutNo"]) expect(document.getElementById(id), id).toBeNull();
    expect(document.querySelector("[data-shout-note]")).toBeNull();
  });

  it("sends No thanks as no posting and no shout out", async () => {
    fill("raising");
    tick("shareNo");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ socialOk: false, wants: { shoutOut: false } });
  });
});

describe("printed QR codes", () => {
  beforeEach(() => load());

  // The sign up tidy (Jaimie, 2026-10-03): every path has a page now, so every path may ask for
  // them (they were only for someone raising money), each in its own words.
  it("are offered on every path, in its own words", () => {
    for (const id of ["pathRaising", "pathEvent"]) {
      tick(id);
      expect($("#qrCodes").closest("[hidden]"), id).toBeNull();
      expect($("label[for=qrCodes]").textContent).toBe("How many printed QR codes would you like?");
      expect($("#qrCodesHelp").hidden).toBe(false);
    }
    tick("pathMemory");
    expect($("#qrCodes").closest("[hidden]")).toBeNull();
    expect($("label[for=qrCodes]").textContent).toBe("Cards with the page’s QR code, for the order of service, how many?");
    expect($("#qrCodesHelp").hidden).toBe(true);
  });

  // Someone raising money or holding an event is always asked their address now (the welcome pack).
  it("need an address to post them to, in memory of someone", () => {
    tick("pathMemory");
    expect($("[data-address-field]").hidden).toBe(true);
    type("qrCodes", "20");
    expect($("[data-address-field]").hidden).toBe(false);
    expect($("#postLine1").required).toBe(true);
    type("qrCodes", "0");
    expect($("[data-address-field]").hidden).toBe(true);
    expect($("#postLine1").required).toBe(false);
  });
});

// ---- review fixes ----

describe("a fault in the form's own script", () => {
  it("still lets Next go to the next question", () => {
    load();
    const real = document.getElementById.bind(document);
    document.getElementById = ((id: string) => {
      if (id === "kindOther") throw new Error("boom");
      return real(id);
    }) as typeof document.getElementById;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const el = $<HTMLInputElement>("#pathRaising");
      el.checked = true;
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
        /* the fault itself */
      }
      nextBtn().click();
      expect(has("over18Yes")).toBe(true);
    } finally {
      document.getElementById = real;
      quiet.mockRestore();
    }
  });
});

describe("Instagram and Facebook, checked before sending", () => {
  it("says what is wrong as soon as they leave the box", () => {
    load();
    tick("pathRaising");
    type("facebook", "https://www.instagram.com/someone");
    expect($("#facebookHelp").textContent).toMatch(/Facebook page name/);
    expect($("#facebook").getAttribute("aria-invalid")).toBe("true");
    type("facebook", "facebook.com/someone");
    expect($("#facebookHelp").textContent).toBe("Your page name, or the link to your page, group or event.");
    expect($("#facebook").hasAttribute("aria-invalid")).toBe(false);
  });

  it("holds them on the step while one is wrong, on Next", () => {
    load();
    fill("raising");
    type("instagram", "robin bakes");
    walk();
    expect(has("instagram")).toBe(true);
    expect(document.getElementById("instagram-error")?.textContent).toMatch(/Instagram name/);
  });

  it("sends nothing while one is wrong, and goes back to it", async () => {
    load();
    fill("raising");
    toEnd();
    type("instagram", "robin bakes");
    await submit();
    expect(calls.filter((c) => c.url === "/api/fundraise")).toHaveLength(0);
    expect(document.getElementById("instagram-error")?.textContent).toMatch(/Instagram name/);
    expect(has("instagram")).toBe(true);
  });

  it("is loaded on the page before the form's own script", () => {
    expect(template.indexOf("/assets/js/social-handles.js")).toBeGreaterThan(-1);
    expect(template.indexOf("/assets/js/social-handles.js")).toBeLessThan(template.indexOf("/assets/js/fundraise.js"));
  });

  it("has the steps loaded before the form's own script too", () => {
    expect(template.indexOf("/assets/js/fundraise-steps.js")).toBeGreaterThan(-1);
    expect(template.indexOf("/assets/js/fundraise-steps.js")).toBeLessThan(template.indexOf("/assets/js/fundraise.js"));
  });
});

describe("sending", () => {
  it("sends the split name, Other, both links, the one social answer, and QR codes", async () => {
    load();
    fill("raising");
    toEnd();
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
      // The sign up tidy: every sign up gets a page; listed says whether it goes on Get involved.
      public: true,
      listed: false,
      wants: { qrCount: 30, shoutOut: true, attend: false },
      postLine1: "1 Example Road",
    });
    expect(sent()).not.toHaveProperty("name");
    expect(sent()).not.toHaveProperty("socialLink");
  });

  // The sign up tidy (Jaimie, 2026-10-03): was "sends no QR codes for an event". An event has a
  // page of its own now, so its QR codes are sent.
  it("sends an event's QR codes", async () => {
    load();
    fill("event");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ path: "event", wants: { qrCount: 30 } });
  });

  it("sends Other's words only when it is chosen", async () => {
    load();
    fill("raising");
    tick("kind-birthday");
    toEnd();
    await submit();
    expect(sent().kind).toBe("birthday");
    expect(sent().kindOther).toBe("");
  });

  it("thanks them by their first name", async () => {
    load();
    fill("raising");
    toEnd();
    await submit();
    expect($("[data-fundraise-thanks]").textContent).toContain("Thank you, Sam.");
  });

  it("puts the server's words by the new boxes", async () => {
    load();
    fill("raising");
    toEnd();
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
    // And goes back to the first of them: what Other is, in Your fundraiser.
    expect(has("kindOther")).toBe(true);
  });
});

describe("an invite from the team", () => {
  it("fills in the first name and surname from the invite exactly", async () => {
    const token = "a".repeat(43);
    window.history.replaceState(null, "", `/fundraise?invite=${token}`);
    answer = (url) =>
      url === "/api/fundraise/invite"
        ? { status: 200, body: { firstName: "Robin Ann", lastName: "Van Quill", email: "robin@example.com" } }
        : { status: 200, body: { siteKey: null } };
    load();
    await flush();
    await flush();
    expect($("#firstName").value).toBe("Robin Ann");
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
