// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// The sign up tidy (Jaimie and the form appropriateness audit, 2026-10-03): one question at a time
// with Next and Back, a five stage progress bar, warm prompts only on Next, and a path for raising
// money, holding an event, or a page in memory of someone, each asked only what fits it. Every name
// here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/fundraising.css"), "utf8");

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function load() {
  rememberCategories(ALL_BUILT_IN_CATEGORIES);
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, true, formCategories(), memoryCategories()), "text/html")
    .documentElement.innerHTML;
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
const next = () => $<HTMLButtonElement>("[data-next]").click();
const back = () => $<HTMLButtonElement>("[data-back]").click();
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const has = (id: string) => current().contains(document.getElementById(id));
const progressWords = () => ($("[data-progress-step]").textContent ?? "") + ($("[data-progress-lift]").textContent ?? "");
const stageNames = () => [...document.querySelectorAll(".fr-progress__label")].map((n) => n.textContent);
const sent = () => JSON.parse(String(calls.filter((c) => c.url === "/api/fundraise")[0].init?.body));
const submit = async () => {
  $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
  await flush();
};
/** The words someone sees: without anything hidden, and without a prompt added on Next. */
const seen = (sel: string) => {
  const copy = $(sel).cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[hidden], .validation-msg").forEach((n) => n.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
};
const errorOf = (id: string) => document.getElementById(`${id}-error`)?.textContent ?? "";

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

/** Press Next until the step holding this box shows (every answer before it must be given). */
function goTo(id: string) {
  for (let i = 0; i < 30 && !has(id); i++) {
    const before = current();
    next();
    if (current() === before) break;
  }
  expect(has(id), `could not get to ${id}: stuck on "${current().querySelector("legend, h2, label")?.textContent}"`).toBe(true);
}

/**
 * Answer each step as it comes, for a sign up raising money, to the last step. Jaimie, 2026-10-03:
 * the fun part first: what you are planning, 18 or over, then Your fundraiser, then About you.
 */
function raisingToTheEnd(o: { sporting?: boolean; sharing?: boolean; listed?: boolean } = {}) {
  tick("pathRaising");
  next();
  tick("over18Yes");
  next();
  tick("teamMe");
  next();
  tick(o.sporting ? "sportingYes" : "sportingNo");
  next();
  tick(o.sporting ? "kind-walk" : "kind-quiz");
  next();
  if (o.sporting) {
    const size = $<HTMLSelectElement>("#tshirtSize");
    size.value = "adult_m";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    next();
  }
  type("title", "Robin's Quiz");
  type("description", "A quiz for NBCC.");
  next();
  next(); // the target is optional
  tick("childMe");
  next();
  tick("orgNo");
  next();
  tick(o.listed === false ? "listedNo" : "listedYes");
  next();
  type("firstName", "Robin");
  type("lastName", "Testperson");
  type("email", "robin@example.com");
  type("phone", "07700 900123");
  next();
  type("postLine1", "1 Example Road");
  type("postTown", "Exampleton");
  type("postPostcode", "EX1 1EX");
  next();
  if (o.sharing) {
    tick("sharesYes");
    type("nbccSharePercent", "50");
    type("otherCauseName", "Exampleton Food Bank");
    next();
    tick("splitConfirmed");
    next();
  } else {
    tick("sharesNo");
    next();
  }
  tick("shareMention");
  next();
  next(); // nothing asked for
}

/** The answers of Your fundraiser, given without walking, for a test about a later step. */
function fundraiserAnswers() {
  tick("pathRaising");
  tick("over18Yes");
  tick("teamMe");
  tick("sportingNo");
  tick("kind-quiz");
  type("title", "Robin's Quiz");
  type("description", "A quiz for NBCC.");
  tick("childMe");
  tick("orgNo");
  tick("listedYes");
}

describe("the top of the form", () => {
  beforeEach(() => load());

  it("offers to fill it in together, by phone", () => {
    const box = $(".fr-together");
    expect(box.textContent!.replace(/\s+/g, " ").trim()).toBe("Rather do this together? Give us a call on 01292 811 015 and we'll fill it in with you.");
    expect(box.querySelector("a")!.getAttribute("href")).toBe("tel:+441292811015");
    expect(box.compareDocumentPosition($("#fundraiseForm")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says how long it takes, and to have the address handy", () => {
    expect($("[data-one-liner]").textContent).toBe("It only takes a few minutes. Have your address handy so we can post your welcome pack.");
  });

  it("has no button to show every question at once", () => {
    expect(document.querySelector("[data-show-all]")).toBeNull();
    expect(document.body.textContent).not.toContain("Show all the questions at once");
  });

  it("shows a progress bar of five stages, the first one current", () => {
    expect($("[data-progress]").hidden).toBe(false);
    expect(stageNames()).toEqual(["Your fundraiser", "About you", "Sharing", "What you'd like", "Check and send"]);
    expect(progressWords()).toBe("Step 1 of 5: Your fundraiser");
    const stages = [...document.querySelectorAll(".fr-progress__stage")];
    expect(stages[0].getAttribute("aria-current")).toBe("step");
    expect(stages[0].textContent).toContain("you are here");
    expect(stages.filter((s) => s.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("shows one question at a time, with Next and no Back on the first", () => {
    expect(document.querySelectorAll("[data-step].is-current")).toHaveLength(1);
    expect(has("pathRaising")).toBe(true);
    expect($("[data-back]").hidden).toBe(true);
    expect($("[data-next]").hidden).toBe(false);
  });
});

describe("Next and Back", () => {
  beforeEach(() => load());

  it("turns nothing red while they type", () => {
    fundraiserAnswers();
    goTo("childMe");
    tick("childYes");
    type("childFirstName", "E");
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it("stays put on Next with something missing, with a warm prompt by it and the focus on it", () => {
    next();
    expect(has("pathRaising")).toBe(true);
    expect($("#pathRaising").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("path")).toBe("Almost! Just choose what you're planning.");
    expect(document.activeElement).toBe($("#pathRaising"));
  });

  it("gives each box on a step its own prompt", () => {
    fundraiserAnswers();
    goTo("firstName");
    expect(progressWords()).toBe("Step 2 of 5: About you");
    type("email", "not an email");
    next();
    expect(errorOf("firstName")).toBe("Almost! Just add your first name.");
    expect(errorOf("lastName")).toBe("Almost! Just add your surname.");
    expect(errorOf("email")).toBe("Almost! Just add your email, like name@example.com.");
    expect(errorOf("phone")).toBe("Almost! Just add a phone number, so we can give you a call.");
    expect(document.activeElement).toBe($("#firstName"));
  });

  it("goes back a step, keeping every answer", () => {
    tick("pathRaising");
    next();
    tick("over18Yes");
    next();
    back();
    expect(has("over18Yes")).toBe(true);
    expect($("#over18Yes").checked).toBe(true);
    back();
    expect($("#pathRaising").checked).toBe(true);
    expect($("[data-back]").hidden).toBe(true);
  });

  it("says each new step for screen readers, and moves the focus to it", () => {
    tick("pathRaising");
    next();
    expect($("[data-step-news]").textContent).toBe("Step 1 of 5, Your fundraiser: Are you 18 or over?");
    expect(document.activeElement).toBe(current());
  });

  it("ticks the stages done, and lifts near the end", () => {
    raisingToTheEnd();
    expect(progressWords()).toBe("Step 5 of 5: Check and send Last step!");
    const done = [...document.querySelectorAll(".fr-progress__stage.is-done")].map((s) => s.querySelector(".fr-progress__label")!.textContent);
    expect(done).toEqual(["Your fundraiser", "About you", "Sharing", "What you'd like"]);
    back();
    expect(progressWords()).toBe("Step 4 of 5: What you'd like Nearly there!");
  });

  it("holds an under 18 on that step, with the kind note", () => {
    tick("pathRaising");
    next();
    tick("over18No");
    next();
    expect(has("over18Yes")).toBe(true);
    expect($("[data-age-note]").textContent).toBe(
      "You need to be 18 or over to sign up. A parent, carer or another adult you trust can do it for you and name you on the page. If you'd like to talk it through, call 01292 811 015 or email events@nbcc.scot.",
    );
  });

  it("treats Enter in a box before the last step as Next", async () => {
    tick("pathRaising");
    await submit();
    expect(has("over18Yes")).toBe(true);
    expect(calls.filter((c) => c.url === "/api/fundraise")).toHaveLength(0);
  });
});

describe("raising money", () => {
  beforeEach(() => load());

  it("sends a full sign up, with the address and Get involved", async () => {
    raisingToTheEnd({ listed: false });
    expect($("[data-review]").textContent).toContain("Robin Testperson");
    await submit();
    expect(sent()).toMatchObject({
      path: "raising",
      inMemory: false,
      kind: "quiz",
      public: true,
      listed: false,
      isSporting: false,
      tshirtSize: "",
      socialOk: true,
      wants: { shoutOut: false, attend: false, envelopeCount: 0 },
      postLine1: "1 Example Road",
      postTown: "Exampleton",
      postPostcode: "EX1 1EX",
      childFundraiser: "me",
      forOrganisation: false,
    });
    expect($("[data-fundraise-thanks]").hidden).toBe(false);
    expect($("[data-thanks-listed]").hidden).toBe(true);
  });

  it("asks a sporting event only the sporting categories, then a T-shirt size", () => {
    tick("pathRaising");
    next();
    tick("over18Yes");
    next();
    tick("teamMe");
    next();
    expect(current().querySelector("legend")!.textContent).toBe("Is it a sporting event?");
    tick("sportingYes");
    next();
    const offered = [...current().querySelectorAll<HTMLElement>("[data-kind-options] label")].filter((l) => !l.hidden).map((l) => l.textContent);
    expect(offered).toEqual(["Run", "Santa dash", "Walk", "Other"]);
    expect($("[data-kind-options]").style.getPropertyValue("--rows")).toBe("2");
    tick("kind-walk");
    next();
    expect(has("tshirtSize")).toBe(true);
    expect($("#tshirtSizeHelp").textContent).toBe("For your NBCC T-shirt. If it’s for a child, choose their size.");
    next();
    expect(errorOf("tshirtSize")).toBe("Almost! Just choose a T-shirt size.");
    expect($<HTMLSelectElement>("#tshirtSize").value).toBe("");
  });

  it("offers the rest for a No, and lets a sporting choice go", () => {
    tick("pathRaising");
    tick("sportingYes");
    tick("kind-walk");
    tick("sportingNo");
    const offered = [...document.querySelectorAll<HTMLElement>("[data-kind-options] label")].filter((l) => !l.hidden).map((l) => l.textContent);
    expect(offered).not.toContain("Walk");
    expect(offered).toContain("Quiz");
    expect(offered.at(-1)).toBe("Other");
    expect($("#kind-walk").checked).toBe(false);
    expect($("[data-tshirt-step]").hidden).toBe(true);
  });

  it("sends the size for a sporting event", async () => {
    raisingToTheEnd({ sporting: true });
    await submit();
    expect(sent()).toMatchObject({ isSporting: true, tshirtSize: "adult_m", kind: "walk" });
  });

  it("asks a child's first name and the parent's tick", () => {
    fundraiserAnswers();
    goTo("childMe");
    tick("childYes");
    next();
    expect(errorOf("childFirstName")).toBe("Almost! Just add their first name.");
    expect(errorOf("childConsent")).toBe("Almost! Just tick to say you're happy for their first name to be shown.");
    expect(seen("label[for=childConsent]")).toBe(
      "I’m their parent or guardian, and I’m happy for their first name and any photo to be shown on the page and our social media.",
    );
  });

  it("asks the name of a business, school or group", () => {
    fundraiserAnswers();
    goTo("orgYes");
    tick("orgYes");
    next();
    expect(errorOf("orgName")).toBe("Almost! Just add the name of the business, school or group.");
    expect($("#employerMatchGroup legend").textContent!.replace(/\s+/g, " ").trim()).toBe("Will your employer match what you raise? (optional)");
  });
});

describe("the split check", () => {
  beforeEach(() => load());

  it("shows the split as the page will say it, and needs the tick", () => {
    tick("pathRaising");
    tick("sharesYes");
    type("nbccSharePercent", "50");
    type("otherCauseName", "Exampleton Food Bank");
    const check = $("[data-split-check]");
    expect(check.hidden).toBe(false);
    expect(check.querySelector("[data-split-statement]")!.textContent!.replace(/\s+/g, " ")).toBe(
      "Please check: 50% of what you raise comes to NBCC, and the rest goes to Exampleton Food Bank. This is what your page and posters will say, and it can’t be changed once we’ve approved your page.",
    );
    expect($("#splitConfirmed").required).toBe(true);
    expect($("label[for=splitConfirmed]").textContent).toBe("Yes, that’s right");
  });

  it("asks for the tick again when the split changes", () => {
    tick("pathRaising");
    tick("sharesYes");
    type("nbccSharePercent", "50");
    type("otherCauseName", "Exampleton Food Bank");
    tick("splitConfirmed");
    type("nbccSharePercent", "60");
    expect($("#splitConfirmed").checked).toBe(false);
  });

  it("flags a number out of range with its own prompt", () => {
    raisingToTheEnd({ sharing: true });
    for (let i = 0; i < 20 && !has("nbccSharePercent"); i++) back();
    type("nbccSharePercent", "100");
    next();
    expect(has("nbccSharePercent")).toBe(true);
    expect(errorOf("nbccSharePercent")).toBe("Almost! Just add a whole number from 1 to 99.");
    type("nbccSharePercent", "50");
    next();
    expect(has("splitConfirmed")).toBe(true);
  });

  it("explains how sharing with more than one works, and that NBCC keeps only its share", () => {
    expect($("#otherCauseNameHelp").textContent).toBe(
      "Sharing with more than one? Name them all, with their share if it isn’t equal, e.g. Exampleton Food Bank (25%) and Exampleton Primary (25%).",
    );
    expect($(".fr-split-money").textContent).toBe(
      "Everything given on your NBCC page comes to NBCC as our share. Please collect the other cause’s share your own way, as we can’t pass money on to them.",
    );
  });

  it("sends the tick", async () => {
    raisingToTheEnd({ sharing: true });
    await submit();
    expect(sent()).toMatchObject({ sharesWithOther: true, nbccSharePercent: "50", otherCauseName: "Exampleton Food Bank", splitConfirmed: true });
  });
});

describe("the address", () => {
  beforeEach(() => load());

  it("comes with their details, in About you", () => {
    fundraiserAnswers();
    type("firstName", "Robin");
    type("lastName", "Testperson");
    type("email", "robin@example.com");
    type("phone", "07700 900123");
    goTo("postLine1");
    expect(progressWords()).toBe("Step 2 of 5: About you");
  });

  it("is asked of everyone raising money or holding an event, for the welcome pack", () => {
    tick("pathEvent");
    const step = $("[data-address-field]");
    expect(step.hidden).toBe(false);
    expect(step.querySelector("legend")!.textContent).toBe("Your address");
    expect(step.textContent).toContain("So we can post your welcome pack.");
    for (const id of ["postLine1", "postTown", "postPostcode"]) expect($(`#${id}`).required).toBe(true);
    expect($("#postLine2").required).toBe(false);
  });

  it("checks the postcode on Next", () => {
    raisingToTheEnd();
    for (let i = 0; i < 20 && !has("postPostcode"); i++) back();
    type("postPostcode", "12345");
    next();
    expect(errorOf("postPostcode")).toBe("Almost! Just add a UK postcode, like KA1 1AA.");
  });
});

describe("a page in memory of someone", () => {
  beforeEach(() => load());

  it("is the third choice on the first question", () => {
    expect($("label[for=pathMemory]").textContent).toContain("I’m setting up a page in memory of someone");
    expect(document.querySelector("#inMemoryYes")).toBeNull();
  });

  it("has gentle stage names, no lift and no exclamation marks", () => {
    tick("pathMemory");
    expect(stageNames()).toEqual(["About them", "The page", "Your details", "Anything we can send", "Check the details"]);
    expect($("[data-one-liner]").textContent).toBe("Take your time. We will go through it all with you on the phone before anything goes live.");
    const shown = [...document.querySelectorAll<HTMLElement>("[data-step]")].filter((s) => !s.hidden);
    for (const s of shown) {
      const prompts = [...s.querySelectorAll("[data-invalid-message]")].filter((n) => !(n as HTMLElement).closest("[hidden]"));
      for (const p of prompts) expect(p.getAttribute("data-invalid-message"), p.id).not.toMatch(/!/);
    }
  });

  it("never asks about sport, a T-shirt, a team, a child, a business, a shout out, coming along or the newsletter", () => {
    tick("pathMemory");
    for (const sel of ["[data-sporting-step]", "[data-tshirt-step]", "[data-team-step]"]) expect($(sel).hidden, sel).toBe(true);
    for (const id of ["childMe", "orgYes", "shareShout", "attendYes", "newsletterOk", "instagram", "leaflets", "buckets", "tins"]) {
      expect($(`#${id}`).closest("[hidden]"), id).not.toBeNull();
    }
  });

  it("asks how people will be giving, from its own list", () => {
    tick("pathMemory");
    const group = $("#kindGroup");
    expect(group.querySelector("legend")!.textContent).toBe("How will people be giving?");
    const offered = [...group.querySelectorAll<HTMLInputElement>('input[name="kind"]')].filter((r) => !r.closest("[hidden]")).map((r) => r.closest("label")!.textContent);
    expect(offered).toEqual(["A collection at the funeral or service", "A memorial walk, run or event", "Donations instead of flowers", "Something else"]);
  });

  it("asks who it remembers, and who is setting it up, in that order of stages", () => {
    tick("pathMemory");
    next();
    tick("over18Yes");
    next();
    expect(has("memoryName")).toBe(true);
    expect(progressWords()).toBe("Step 1 of 5: About them");
    next();
    expect(errorOf("memoryName")).toBe("Please add their name, as you would like it on the page.");
    expect(errorOf("memorySetupBy")).toBe("Please choose who is setting up the page.");
  });

  it("words the permission for the family, and asks a funeral director the business name", () => {
    tick("pathMemory");
    tick("memorySetupBy-family");
    expect($("label[for=memoryPermission]").textContent).toBe("The close family know about this page and are happy for it to go ahead.");
    tick("memorySetupBy-funeral_director");
    expect($("label[for=memoryPermission]").textContent).toBe("I have the family’s permission to set up this page in their memory.");
    expect($("[data-director-fields]").hidden).toBe(false);
    expect($("#memoryDirectorBusiness").required).toBe(true);
    expect($("[data-director-fields]").textContent).toContain("Who should we send the names of people who gave to?");
    tick("memorySetupBy-someone_else");
    expect($("label[for=memorySetupBy-someone_else]").textContent).toBe("Someone else, like a colleague, club or church");
  });

  it("asks for the address only when something is to be sent, and never says welcome pack", () => {
    tick("pathMemory");
    expect($("[data-address-field]").hidden).toBe(true);
    type("envelopes", "50");
    const step = $("[data-address-field]");
    expect(step.hidden).toBe(false);
    expect(step.querySelector("legend")!.textContent).toBe("Where should we send them?");
    expect(step.textContent).toContain("This can be the funeral director’s address.");
    expect(step.textContent).not.toMatch(/welcome pack/i);
  });

  it("asks where to send things straight after what to send", () => {
    tick("pathMemory");
    tick("over18Yes");
    type("memoryName", "Margaret Exampleton");
    tick("memorySetupBy-family");
    tick("memoryPermission");
    tick("kind-memory_flowers");
    tick("listedYes");
    tick("sharesNo");
    tick("memoryShareYes");
    type("firstName", "Alex");
    type("lastName", "Exampleton");
    type("email", "alex@example.com");
    type("phone", "07700 900456");
    goTo("envelopes");
    expect(progressWords()).toBe("Step 4 of 5: Anything we can send");
    type("envelopes", "50");
    next();
    expect(has("postLine1")).toBe(true);
    expect(progressWords()).toBe("Step 4 of 5: Anything we can send");
  });

  it("words the date, the amount and the sharing gently", () => {
    tick("pathMemory");
    expect(seen("label[for=eventDate]")).toBe("When is the funeral or service? (optional)");
    expect($("#eventDateHelp").hidden).toBe(false);
    expect(seen("label[for=target]")).toBe("Is there an amount you hope to raise? (optional)");
    expect($("#targetHelp").textContent).toBe("Many families leave this empty. You can add or change it later.");
    expect($("#sharesGroup .fr-lead-help").textContent).toBe("For example, if the family has asked for donations to be shared between NBCC and a hospice.");
    expect(seen("label[for=description]")).toBe("A few words about them (optional)");
    expect($("#memoryShareGroup legend").textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Would the family be happy for NBCC to share the page on our Facebook and Instagram? *",
    );
  });

  it("sends it as raising money in memory, with only what it asked", async () => {
    tick("pathMemory");
    tick("over18Yes");
    type("memoryName", "Margaret Exampleton");
    tick("memorySetupBy-family");
    tick("memoryPermission");
    type("firstName", "Alex");
    type("lastName", "Exampleton");
    type("email", "alex@example.com");
    type("phone", "07700 900456");
    type("callTime", "After 2pm");
    tick("kind-memory_flowers");
    tick("listedYes");
    tick("sharesNo");
    tick("memoryShareYes");
    let guard = 0;
    while (!$("[data-next]").hidden && guard++ < 20) next();
    expect(progressWords()).toBe("Step 5 of 5: Check the details");
    await submit();
    expect(sent()).toMatchObject({
      path: "raising",
      inMemory: true,
      kind: "memory_flowers",
      memorySetupBy: "family",
      callTime: "After 2pm",
      isSporting: null,
      socialOk: true,
      newsletterOk: false,
      wants: { shoutOut: false, attend: false, envelopeCount: 0 },
      postLine1: "",
    });
    expect($("[data-thanks-memory]").hidden).toBe(false);
    expect($("[data-thanks-steps]").hidden).toBe(true);
    expect($("[data-thanks-eyebrow]").textContent).toBe("Thank you");
  });
});

describe("holding an event", () => {
  beforeEach(() => load());

  it("may be free entry with donations welcome, and asks the amount gently", () => {
    tick("pathEvent");
    expect($("label[for=booking-donations]").textContent).toBe("Free entry, donations welcome");
    expect($("label[for=target]").textContent!.replace(/\s+/g, " ").trim()).toBe("Is there an amount you hope to raise? (optional)");
    expect($("#qrCodes").closest("[hidden]")).toBeNull();
    expect(stageNames()[0]).toBe("Your event");
  });

  it("asks someone to come along only when there is something to come along to", () => {
    tick("pathRaising");
    expect($("[data-attend]").hidden).toBe(true);
    type("venue", "Example Hall");
    expect($("[data-attend]").hidden).toBe(false);
    expect($("[data-attend] legend").textContent!.replace(/\s+/g, " ").trim()).toBe(
      "If there’s something to come along to, would you like someone from NBCC there? *",
    );
  });
});

describe("a date not decided yet", () => {
  beforeEach(() => load());

  it("sits beside the date, unticked, for raising money and for an event, never in memory", () => {
    tick("pathEvent");
    expect($("#dateTbc").checked).toBe(false);
    expect(seen("label[for=dateTbc]")).toBe("Not decided yet");
    expect($("#dateTbc").closest("[data-step]")).toBe($("#eventDate").closest("[data-step]"));
    tick("pathMemory");
    expect($("#dateTbc").closest("[hidden]")).not.toBeNull();
  });

  it("asks an event for the date, or the tick", () => {
    tick("pathEvent");
    expect($("#eventDate").required).toBe(true);
    expect($("#eventDate").getAttribute("data-invalid-message")).toBe("Almost! Just add the date, or tick Not decided yet.");
    tick("dateTbc");
    expect($("#eventDate").required).toBe(false);
    expect($("#eventDate").disabled).toBe(true);
  });

  it("lets the date go when it is ticked, and sends the tick", async () => {
    raisingToTheEnd();
    type("eventDate", "2026-12-05");
    tick("dateTbc");
    expect($("#eventDate").value).toBe("");
    await submit();
    expect(sent()).toMatchObject({ eventDate: "", dateTbc: true });
  });

  it("sends no tick when there is a date", async () => {
    raisingToTheEnd();
    type("eventDate", "2026-12-05");
    type("attendNo", "no");
    tick("attendNo");
    await submit();
    expect(sent()).toMatchObject({ eventDate: "2026-12-05", dateTbc: false });
  });
});

describe("a team", () => {
  beforeEach(() => load());

  it("is always listed, and says so", () => {
    tick("pathRaising");
    tick("teamYes");
    expect($("#listedGroup").closest("[data-step]")!.hidden).toBe(true);
    expect($("[data-team-fields]").textContent).toContain("Team pages always go on our Get involved page, so your team can find it and join.");
    expect($("label[for=description]").textContent).toContain("A few words about what your team is doing");
  });
});

describe("a server message", () => {
  it("goes back to the step it belongs to", async () => {
    load();
    raisingToTheEnd();
    answer = (url) =>
      url === "/api/fundraise" ? { status: 400, body: { fields: { postTown: "Please add your town." } } } : { status: 200, body: { siteKey: null } };
    await submit();
    expect(has("postTown")).toBe(true);
    expect(errorOf("postTown")).toBe("Please add your town.");
  });
});

describe("the look", () => {
  it("shows one step at a time only with the script, and moves gently or not at all", () => {
    expect(css).toMatch(/\.fr-wizard \.give-question\.is-off\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*\.fr-wizard \.give-question\.is-arriving/);
  });

  it("never says which stage they are on by colour alone", () => {
    load();
    const now = document.querySelector(".fr-progress__stage.is-current")!;
    expect(now.getAttribute("aria-current")).toBe("step");
    expect(now.textContent).toContain("you are here");
  });
});
