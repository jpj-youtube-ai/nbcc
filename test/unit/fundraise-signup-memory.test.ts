// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// In memory pages (Jaimie, 2026-10-03): on the raising money path, "Is this in memory of someone?",
// Yes or No with nothing chosen for them. A Yes asks their name, optional dates in their own words,
// who is setting up the page and "I have the family's permission"; the name for the page becomes
// optional; and with a target, whether to show it on the page (asked, never chosen). The server
// checks it all again. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

let calls: Array<{ url: string; init?: RequestInit }>;

function load() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderFundraiseSignUp(template, true), "text/html").documentElement.innerHTML;
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
const steps = () => [...document.querySelectorAll<HTMLElement>("[data-step]")];
const sends = () => calls.filter((c) => c.url === "/api/fundraise");
const sent = () => JSON.parse(String(sends()[0].init?.body));
const shown = (el: Element) => {
  for (let n: Element | null = el; n; n = n.parentElement) if ((n as HTMLElement).hidden) return false;
  return true;
};

function fillRest() {
  // Team pages: Just me (an in memory page has it chosen for them already).
  tick("teamMe");
  tick("kind-other");
  type("kindOther", "A collection at the funeral");
  type("description", "Margaret loved Christmas.");
  tick("sharesNo");
  tick("publicYes");
  type("firstName", "Sam");
  type("lastName", "Sample");
  type("email", "sam@example.com");
  type("phone", "07700 900456");
  tick("socialOkNo");
  tick("shoutOutNo");
  tick("attendNo");
}

function inMemory() {
  tick("pathRaising");
  tick("over18Yes");
  tick("inMemoryYes");
  type("memoryName", "Margaret Exampleton");
  type("memoryDates", "1948 to 2026");
  tick("memorySetupBy-friend");
  tick("memoryPermission");
}

describe("in the page as it is", () => {
  beforeEach(() => load());

  it("asks straight after 18 or over, with Yes and No and nothing chosen", () => {
    const step = $("#inMemoryYes").closest("[data-step]")!;
    expect(steps().indexOf(step as HTMLElement)).toBe(steps().indexOf($("#over18Yes").closest("[data-step]") as HTMLElement) + 1);
    expect(step.querySelector("legend")!.textContent!.trim()).toBe("Is this in memory of someone?");
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="inMemory"]')];
    expect(radios.map((r) => r.value)).toEqual(["yes", "no"]);
    expect(radios.some((r) => r.checked || r.hasAttribute("checked"))).toBe(false);
    expect(radios.every((r) => r.required)).toBe(true);
    expect(step.querySelector('[role="radiogroup"]')!.getAttribute("aria-required")).toBe("true");
  });

  it("is only for raising money", () => {
    tick("pathEvent");
    expect(shown($("#inMemoryYes"))).toBe(false);
    tick("pathRaising");
    expect(shown($("#inMemoryYes"))).toBe(true);
  });

  it("asks nothing more until they say Yes", () => {
    tick("pathRaising");
    tick("over18Yes");
    expect(shown($("#memoryName"))).toBe(false);
    tick("inMemoryNo");
    expect(shown($("#memoryName"))).toBe(false);
    tick("inMemoryYes");
    expect(shown($("#memoryName"))).toBe(true);
    expect(shown($("#memoryDates"))).toBe(true);
    expect(shown($("#memoryPermission"))).toBe(true);
    const who = [...document.querySelectorAll<HTMLInputElement>('input[name="memorySetupBy"]')];
    expect(who.map((r) => r.value)).toEqual(["family", "friend", "funeral_director"]);
    expect(who.some((r) => r.checked)).toBe(false);
  });

  it("does not let the next question come until the name, who and the permission are given", () => {
    tick("pathRaising");
    tick("over18Yes");
    tick("inMemoryYes");
    const kindStep = $("#kind-walk").closest("[data-step]")!;
    expect(kindStep.classList.contains("is-waiting")).toBe(true);
    type("memoryName", "Margaret Exampleton");
    tick("memorySetupBy-family");
    expect(kindStep.classList.contains("is-waiting")).toBe(true);
    tick("memoryPermission");
    expect(kindStep.classList.contains("is-waiting")).toBe(false);
  });
});

describe("sending one in memory", () => {
  beforeEach(() => load());

  it("sends who it remembers, and the name for the page may be left empty", async () => {
    inMemory();
    fillRest();
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
    });
    expect(body.memoryShowTarget).toBeNull();
  });

  it("asks whether to show the target only when there is one, with nothing chosen", async () => {
    inMemory();
    expect(shown($("#memoryShowTargetYes"))).toBe(false);
    type("target", "500");
    expect(shown($("#memoryShowTargetYes"))).toBe(true);
    expect($<HTMLInputElement>("#memoryShowTargetYes").checked || $<HTMLInputElement>("#memoryShowTargetNo").checked).toBe(false);
    fillRest();
    await submit();
    expect(sends()).toHaveLength(0);
    tick("memoryShowTargetNo");
    await submit();
    expect(sent()).toMatchObject({ targetPence: 50000, memoryShowTarget: false });
  });

  it("will not send without the family's permission", async () => {
    inMemory();
    $<HTMLInputElement>("#memoryPermission").checked = false;
    fillRest();
    await submit();
    expect(sends()).toHaveLength(0);
  });

  it("thanks them gently, without promising an email", async () => {
    inMemory();
    fillRest();
    await submit();
    expect(shown($("[data-thanks-memory]"))).toBe(true);
    expect(shown($("[data-thanks-emailed]"))).toBe(false);
  });

  it("sends none of it on a No, and still asks for a name for the page", async () => {
    tick("pathRaising");
    tick("over18Yes");
    tick("inMemoryNo");
    fillRest();
    await submit();
    expect(sends()).toHaveLength(0);
    type("title", "Sam's Walk");
    await submit();
    const body = sent();
    expect(body.inMemory).toBe(false);
    expect(body.memoryName).toBe("");
    expect(body.memoryPermission).toBe(false);
  });
});

describe("review: an in memory page is always just me", () => {
  it("hides the team question (Just me, or a team?) and answers it Just me while in memory is Yes", () => {
    load();
    const team = document.querySelector<HTMLElement>("[data-team-step]")!;
    expect(team.querySelector("legend")!.textContent!.trim()).toBe("Just me, or a team?");
    tick("pathRaising");
    tick("over18Yes");
    tick("teamYes");
    tick("inMemoryYes");
    expect(team.hidden).toBe(true);
    expect(($("#teamMe") as HTMLInputElement).checked).toBe(true);
    tick("inMemoryNo");
    expect(team.hidden).toBe(false);
  });
});

describe("review: in memory with the real team question", () => {
  it("sends Just me for an in memory page, never a team", async () => {
    load();
    inMemory();
    fillRest();
    tick("teamYes");
    tick("inMemoryNo");
    tick("inMemoryYes");
    await submit();
    expect(sent()).toMatchObject({ inMemory: true, team: "me" });
  });
});

describe("the words at the top of the in memory questions (Jaimie, A2)", () => {
  const SORRY = "We are so sorry for your loss. Take your time: we will check everything with you before the page goes live.";
  const DIRECTOR = "Thank you for setting this up for the family. We will check everything with you before the page goes live.";
  const BEFORE = "Take your time: we will check everything with you before the page goes live.";
  const lead = () => [...document.querySelectorAll<HTMLElement>("[data-memory-lead]")].filter((n) => !n.hidden).map((n) => n.textContent!.trim());

  it("say only take your time until they choose who is setting it up", () => {
    load();
    tick("pathRaising");
    tick("over18Yes");
    tick("inMemoryYes");
    expect(lead()).toEqual([BEFORE]);
  });

  it("are sorry for their loss for a family member or a friend", () => {
    load();
    tick("pathRaising");
    tick("over18Yes");
    tick("inMemoryYes");
    tick("memorySetupBy-family");
    expect(lead()).toEqual([SORRY]);
    tick("memorySetupBy-friend");
    expect(lead()).toEqual([SORRY]);
  });

  it("thank a funeral director for setting it up for the family, with no sorry for your loss", () => {
    load();
    tick("pathRaising");
    tick("over18Yes");
    tick("inMemoryYes");
    tick("memorySetupBy-funeral_director");
    expect(lead()).toEqual([DIRECTOR]);
  });
});
