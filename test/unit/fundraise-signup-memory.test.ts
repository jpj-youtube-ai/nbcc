// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// In memory pages (Jaimie, 2026-10-03): their name, optional dates in their own words, who is
// setting up the page and "I have the family's permission"; the name for the page is optional; and
// with an amount, whether to show it on the page (asked, never chosen). The server checks it all
// again.
//
// The sign up tidy (Jaimie, 2026-10-03): in memory of someone is no longer a Yes or No asked of
// someone raising money. It is the third choice on the first question, a path of its own, still sent
// as raising money with inMemory. test/unit/fundraise-signup-tidy-form.test.ts holds the path's own
// words, list and stages; here is what the in memory questions always did. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

// A walk through every step is a few seconds in jsdom on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let calls: Array<{ url: string; init?: RequestInit }>;

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
    const body = url === "/api/fundraise/captcha" ? { siteKey: null } : { status: "received" };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  w.NBCCSocialHandles = socialHandles;
  w.NBCCFormSteps = stepsLib;
  window.history.replaceState(null, "", "/fundraise");
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
const sends = () => calls.filter((c) => c.url === "/api/fundraise");
const sent = () => JSON.parse(String(sends()[0].init?.body));
const shown = (el: Element) => {
  for (let n: Element | null = el; n; n = n.parentElement) if ((n as HTMLElement).hidden) return false;
  return true;
};
const nextBtn = () => $<HTMLButtonElement>("[data-next]");
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const has = (id: string) => current().contains(document.getElementById(id));
const errorOf = (id: string) => document.getElementById(`${id}-error`)?.textContent ?? "";
const titleOf = (s: Element) => (s.querySelector("legend, h2, label")?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Press Next until the last step, or until a step holds them with something to put right. */
const walk = () => {
  const seen: string[] = [titleOf(current())];
  for (let i = 0; i < 40 && !nextBtn().hidden; i++) {
    const before = current();
    nextBtn().click();
    if (current() === before) break;
    seen.push(titleOf(current()));
  }
  return seen;
};
/** To the last step (Check the details), saying which step held them if one did. */
const toEnd = () => {
  walk();
  if (!nextBtn().hidden) {
    const held = [...current().querySelectorAll('[aria-invalid="true"]')].map((n) => n.id).join(", ");
    throw new Error(`held at "${titleOf(current())}" by: ${held}`);
  }
};

// The page, and who it remembers.
function inMemory() {
  tick("pathMemory");
  tick("over18Yes");
  type("memoryName", "Margaret Exampleton");
  type("memoryDates", "1948 to 2026");
  tick("memorySetupBy-friend");
  tick("memoryPermission");
}

// Everything else the in memory path needs an answer to.
function fillRest() {
  tick("kind-memory-other");
  type("kindOther", "A collection at the golf club");
  type("description", "Margaret loved Christmas.");
  tick("listedYes");
  tick("sharesNo");
  tick("memoryShareNo");
  type("firstName", "Sam");
  type("lastName", "Sample");
  type("email", "sam@example.com");
  type("phone", "07700 900456");
}

// The sign up tidy (Jaimie, 2026-10-03): these are gone, with the Yes or No they tested ("Is this in
// memory of someone?", asked of someone raising money straight after 18 or over):
//   - "asks straight after 18 or over, with Yes and No and nothing chosen"
//   - "is only for raising money"
// In memory of someone is now the third choice on the first question (fundraise-signup-tidy-form.test.ts).
describe("in the page as it is", () => {
  beforeEach(() => load());

  it("asks who the page is for only on the in memory path, with nothing chosen", () => {
    expect(shown($("#memoryName"))).toBe(false);
    for (const id of ["pathRaising", "pathEvent"]) {
      tick(id);
      expect(shown($("#memoryName")), id).toBe(false);
      expect($("#memoryName").required, id).toBe(false);
      expect($("#memoryPermission").required, id).toBe(false);
    }
    tick("pathMemory");
    expect(shown($("#memoryName"))).toBe(true);
    expect(shown($("#memoryDates"))).toBe(true);
    expect(shown($("#memoryPermission"))).toBe(true);
    expect($("#memoryName").required).toBe(true);
    expect($("#memoryDates").required).toBe(false);
    expect($("#memoryPermission").required).toBe(true);
    expect($("#memoryPermission").checked).toBe(false);
    const who = [...document.querySelectorAll<HTMLInputElement>('input[name="memorySetupBy"]')];
    // The sign up tidy: and someone else, like a colleague, club or church.
    expect(who.map((r) => r.value)).toEqual(["family", "friend", "funeral_director", "someone_else"]);
    expect(who.some((r) => r.checked)).toBe(false);
    expect(who.every((r) => r.required)).toBe(true);
  });

  it("asks about them and the page first, then the person's own details", () => {
    inMemory();
    fillRest();
    expect(walk()).toEqual([
      "What are you planning?",
      "Are you 18 or over?",
      "Who is the page for?",
      "How will people be giving?",
      "About the page",
      "Is there an amount you hope to raise? (optional)",
      "Shall we list it on our Get involved page?",
      "Are you sharing what you raise with another cause?",
      "Sharing the page",
      "Your details",
      "Is there anything we can send you?",
      "Check the details",
    ]);
    expect($("[data-submit]").textContent).toBe("Send the details");
  });

  // Was "does not let the next question come until the name, who and the permission are given".
  it("does not let Next past until the name, who and the permission are given", () => {
    tick("pathMemory");
    tick("over18Yes");
    walk();
    expect(has("memoryName")).toBe(true);
    type("memoryName", "Margaret Exampleton");
    tick("memorySetupBy-family");
    nextBtn().click();
    expect(has("memoryName")).toBe(true);
    expect(errorOf("memoryPermission")).toBe("Please tick to say the close family are happy for it to go ahead.");
    tick("memorySetupBy-friend");
    nextBtn().click();
    expect(has("memoryName")).toBe(true);
    expect(errorOf("memoryPermission")).toBe("Please tick to say you have the family’s permission.");
    tick("memoryPermission");
    nextBtn().click();
    expect(has("kind-memory_flowers")).toBe(true);
  });
});

describe("sending one in memory", () => {
  beforeEach(() => load());

  it("sends who it remembers, and the name for the page may be left empty", async () => {
    inMemory();
    fillRest();
    toEnd();
    await submit();
    expect(sends()).toHaveLength(1);
    const body = sent();
    expect(body).toMatchObject({
      path: "raising",
      inMemory: true,
      memoryName: "Margaret Exampleton",
      memoryDates: "1948 to 2026",
      memorySetupBy: "friend",
      memoryPermission: true,
      title: "",
      kind: "other",
      kindOther: "A collection at the golf club",
      description: "Margaret loved Christmas.",
      socialOk: false,
    });
    expect(body.memoryShowTarget).toBeNull();
  });

  it("lets the words about them be left empty too", async () => {
    inMemory();
    fillRest();
    type("description", "");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ inMemory: true, description: "" });
  });

  it("asks whether to show the target only when there is one, with nothing chosen", async () => {
    inMemory();
    expect(shown($("#memoryShowTargetYes"))).toBe(false);
    type("target", "500");
    expect(shown($("#memoryShowTargetYes"))).toBe(true);
    expect($<HTMLInputElement>("#memoryShowTargetYes").checked || $<HTMLInputElement>("#memoryShowTargetNo").checked).toBe(false);
    fillRest();
    // Next waits there for the answer, so nothing can be sent.
    walk();
    expect(has("memoryShowTargetYes")).toBe(true);
    expect(errorOf("memoryShowTarget")).toBe("Please choose Yes or No.");
    await submit();
    expect(sends()).toHaveLength(0);
    tick("memoryShowTargetNo");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ targetPence: 50000, memoryShowTarget: false });
  });

  it("will not send without the family's permission", async () => {
    inMemory();
    fillRest();
    toEnd();
    $<HTMLInputElement>("#memoryPermission").checked = false;
    await submit();
    expect(sends()).toHaveLength(0);
    // Back to the question, with its gentle prompt.
    expect(has("memoryPermission")).toBe(true);
    expect(errorOf("memoryPermission")).toBe("Please tick to say you have the family’s permission.");
  });

  // The sign up tidy (the appropriateness audit): was "without promising an email". A short receipt
  // is sent now, and the thank you says so, in place of the cheerful words everyone else gets.
  it("thanks them gently, promising only a short email and a call", async () => {
    inMemory();
    fillRest();
    toEnd();
    await submit();
    expect(shown($("[data-thanks-memory]"))).toBe(true);
    expect($("[data-thanks-emailed]").textContent).toBe("We have your details, and we have sent you a short email to say so. Here is what happens next.");
    const copy = $("[data-fundraise-thanks]").cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[hidden]").forEach((n) => n.remove());
    const words = copy.textContent!.replace(/\s+/g, " ");
    expect(words).toContain("Someone from NBCC will ring you in the next few days to go through it with you.");
    expect(words).not.toMatch(/welcome pack|Sign up received|!/);
  });

  // Was "sends none of it on a No, and still asks for a name for the page": the No is now choosing
  // to raise money (or hold an event) on the first question.
  it("sends none of it for someone raising money, and still asks them for a name for the page", async () => {
    inMemory();
    type("callTime", "After 2pm");
    tick("pathRaising");
    tick("childMe");
    tick("orgNo");
    tick("teamMe");
    tick("sportingNo");
    tick("kind-quiz");
    type("description", "A quiz for NBCC.");
    tick("listedYes");
    tick("sharesNo");
    tick("shareNo");
    type("firstName", "Sam");
    type("lastName", "Sample");
    type("email", "sam@example.com");
    type("phone", "07700 900456");
    type("postLine1", "1 Example Road");
    type("postTown", "Exampleton");
    type("postPostcode", "EX1 1EX");
    walk();
    expect(has("title")).toBe(true);
    expect(errorOf("title")).toBe("Almost! Just give it a name, like Sam’s Santa Dash.");
    type("title", "Sam's Quiz");
    toEnd();
    await submit();
    const body = sent();
    expect(body.inMemory).toBe(false);
    expect(body.memoryName).toBe("");
    expect(body.memoryDates).toBe("");
    expect(body.memorySetupBy).toBe("");
    expect(body.memoryPermission).toBe(false);
    expect(body.callTime).toBe("");
  });
});

// Was two tests of the team question being answered Just me while "in memory" was Yes. On the path
// of its own the question is never asked, and Just me is what is sent.
describe("review: an in memory page is always just me", () => {
  it("never asks the team question (Just me, or a team?), and sends Just me, never a team", async () => {
    const form = load();
    const team = document.querySelector<HTMLElement>("[data-team-step]")!;
    expect(team.querySelector("legend")!.textContent!.trim()).toBe("Just me, or a team?");
    tick("pathRaising");
    tick("over18Yes");
    expect(team.hidden).toBe(false);
    tick("teamYes");
    type("teamName", "Exampleton Juniors");
    tick("pathMemory");
    expect(team.hidden).toBe(true);
    expect(form.payload()).toMatchObject({ inMemory: true, team: "me", teamMembers: [], teamShareMode: null });
    inMemory();
    fillRest();
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ inMemory: true, team: "me", teamMembers: [], title: "" });
    tick("pathRaising");
    expect(team.hidden).toBe(false);
  });
});

describe("the words at the top of the in memory questions (Jaimie, A2)", () => {
  const SORRY = "We are so sorry for your loss. Take your time: we will check everything with you before the page goes live.";
  const DIRECTOR = "Thank you for setting this up for the family. We will check everything with you before the page goes live.";
  const BEFORE = "Take your time: we will check everything with you before the page goes live.";
  const lead = () => [...document.querySelectorAll<HTMLElement>("[data-memory-lead]")].filter((n) => !n.hidden).map((n) => n.textContent!.trim());

  it("say only take your time until they choose who is setting it up", () => {
    load();
    tick("pathMemory");
    tick("over18Yes");
    expect(lead()).toEqual([BEFORE]);
  });

  it("are sorry for their loss for a family member or a friend", () => {
    load();
    tick("pathMemory");
    tick("over18Yes");
    tick("memorySetupBy-family");
    expect(lead()).toEqual([SORRY]);
    tick("memorySetupBy-friend");
    expect(lead()).toEqual([SORRY]);
  });

  it("thank a funeral director for setting it up for the family, with no sorry for your loss", () => {
    load();
    tick("pathMemory");
    tick("over18Yes");
    tick("memorySetupBy-funeral_director");
    expect(lead()).toEqual([DIRECTOR]);
  });

  // The sign up tidy: someone else (a colleague, club or church) is not assumed to be bereaved.
  it("say only take your time for someone else", () => {
    load();
    tick("pathMemory");
    tick("over18Yes");
    tick("memorySetupBy-someone_else");
    expect(lead()).toEqual([BEFORE]);
  });
});
