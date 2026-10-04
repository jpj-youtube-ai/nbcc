// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// Team pages (Jaimie, 2026-10-03): "Just me, or a team?" on the sign up form, for someone raising
// money (never an event), with nothing chosen. A team asks for the team's name and target, says the
// person setting it up is the team organiser, and may add team members (first name, surname and
// email per person, up to 30), held until staff approve the team. Sharing with another cause asks one
// more question: "Just you, or the whole team?".
//
// The sign up tidy (Jaimie, 2026-10-03): one step at a time, so the answers are set and then Next is
// pressed through to the last step, where Send is. A team is always listed on Get involved
// ("listed"; the question was "public"). Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

const ORGANISER_NOTE = "As the person setting up the team, you’ll be the team organiser: you’ll get the team’s emails and look after the team page.";

// A walk through every step is a few seconds in jsdom on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

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
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  w.NBCCSocialHandles = socialHandles;
  w.NBCCFormSteps = stepsLib;
  window.history.replaceState(null, "", "/fundraise");
  return initFundraiseForm(document, window);
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLInputElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const type = (el: HTMLInputElement | string, value: string) => {
  const box = typeof el === "string" ? $<HTMLInputElement>(`#${el}`) : el;
  box.value = value;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
};
const tick = (id: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const steps = () => $$<HTMLElement>("[data-step]");
const sends = () => calls.filter((c) => c.url === "/api/fundraise");
const sent = () => JSON.parse(String(sends()[0].init?.body));
const rows = () => $$<HTMLElement>("[data-team-row]");
const nextBtn = () => $<HTMLButtonElement>("[data-next]");
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const has = (id: string) => current().contains(document.getElementById(id));
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

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

function fillTeam() {
  tick("pathRaising");
  tick("over18Yes");
  tick("childMe");
  tick("orgNo");
  type("firstName", "Robin");
  type("lastName", "Organiser");
  type("email", "robin@example.com");
  type("phone", "07700 900111");
  tick("teamYes");
  type("teamName", "Exampleton Juniors");
  type("teamTarget", "2000");
  // The sign up tidy: a sporting event, so a sporting category and a t-shirt size.
  tick("sportingYes");
  tick("kind-santa_dash");
  const size = $<HTMLSelectElement>("#tshirtSize");
  size.value = "adult_m";
  size.dispatchEvent(new Event("change", { bubbles: true }));
  type("description", "The under 12s, dashing in Santa suits.");
  tick("sharesNo");
  tick("shareNo");
  type("postLine1", "1 Example Road");
  type("postTown", "Exampleton");
  type("postPostcode", "EX1 1EX");
}

const submit = async () => {
  $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};

describe("Just me, or a team?, in the page as it is", () => {
  // Jaimie, 2026-10-03: the fundraiser comes first, so for someone raising money it is the first
  // question after "Are you 18 or over?" (only the in memory step sits between them in the page).
  it("is the first question about the fundraiser, straight after 18 or over, with nothing chosen", () => {
    load();
    const step = $("#teamYes").closest("[data-step]") as HTMLElement;
    const raising = steps().filter((s) => (s.getAttribute("data-paths") ?? "raising").includes("raising"));
    expect(raising[raising.indexOf(step) - 1]).toBe($("#over18Yes").closest("[data-step]"));
    expect(step.getAttribute("data-stage")).toBe("1");
    expect(step.getAttribute("data-paths")).toBe("raising");
    expect(step.querySelector("legend")!.textContent!.trim()).toBe("Just me, or a team?");
    const radios = $$<HTMLInputElement>('input[name="team"]');
    expect(radios.map((r) => r.value)).toEqual(["me", "team"]);
    expect(radios.some((r) => r.checked || r.hasAttribute("checked"))).toBe(false);
    expect(radios.every((r) => r.required)).toBe(true);
  });

  it("never says captain", () => {
    expect(template).not.toMatch(/captain/i);
  });
});

describe("choosing", () => {
  it("is only for raising money: holding an event never sees it", () => {
    load();
    tick("pathEvent");
    expect(($("#teamYes").closest("[data-step]") as HTMLElement).hidden).toBe(true);
  });

  it("a team asks the team's name and target, says who the team organiser is, and drops the page name and target", () => {
    load();
    tick("pathRaising");
    tick("teamYes");
    expect($("[data-team-fields]").hidden).toBe(false);
    expect($("[data-team-organiser-note]").textContent!.trim()).toBe(ORGANISER_NOTE);
    expect($("#teamName").required).toBe(true);
    expect(($("#title").closest("[data-not-team]") as HTMLElement).hidden).toBe(true);
    expect($("#title").required).toBe(false);
    expect($<HTMLElement>("[data-target-question]").hidden).toBe(true);
    tick("teamMe");
    expect($("[data-team-fields]").hidden).toBe(true);
    expect($("#title").required).toBe(true);
    expect($<HTMLElement>("[data-target-question]").hidden).toBe(false);
  });

  it("adds and removes team members, each with a first name, surname and email, up to 30", () => {
    load();
    tick("pathRaising");
    tick("teamYes");
    expect($("[data-team-members-note]").textContent).toContain("If someone is under 18, tick the box in their row and give their parent or guardian’s email.");
    expect(rows()).toHaveLength(1);
    const add = $<HTMLButtonElement>("[data-team-add]");
    click(add);
    click(add);
    expect(rows()).toHaveLength(3);
    const labels = rows()[1].querySelectorAll("label");
    expect([...labels].map((l) => l.textContent!.replace(/\s+/g, " ").trim())).toEqual(["First name", "Surname", "Email", "This person is under 18"]);
    click(rows()[1].querySelector<HTMLElement>("[data-team-remove]")!);
    expect(rows()).toHaveLength(2);
    for (let i = 0; i < 40; i++) click(add);
    expect(rows()).toHaveLength(30);
    expect(add.disabled).toBe(true);
  });

  it("has a tick per person for under 18, which makes the email box their parent's or guardian's", () => {
    load();
    tick("pathRaising");
    tick("teamYes");
    click($<HTMLButtonElement>("[data-team-add]"));
    const [one, two] = rows();
    const box = (li: HTMLElement) => li.querySelector<HTMLInputElement>("input[data-team-under18]")!;
    const emailLabel = (li: HTMLElement) => li.querySelector<HTMLLabelElement>(`label[for="${li.querySelector<HTMLInputElement>('input[data-part="email"]')!.id}"]`)!.textContent;
    expect(box(one).type).toBe("checkbox");
    expect(box(one).checked).toBe(false);
    // Its label is its own, so a screen reader says which tick this is.
    expect(one.querySelector(`label[for="${box(one).id}"]`)!.textContent).toBe("This person is under 18");
    expect(box(one).id).not.toBe(box(two).id);
    box(one).checked = true;
    box(one).dispatchEvent(new Event("change", { bubbles: true }));
    expect(emailLabel(one)).toBe("Parent or guardian’s email");
    expect(one.querySelector<HTMLInputElement>('input[data-part="email"]')!.getAttribute("data-invalid-message")).toBe("Almost! Just check their parent or guardian’s email address.");
    expect(emailLabel(two)).toBe("Email");
    box(one).checked = false;
    box(one).dispatchEvent(new Event("change", { bubbles: true }));
    expect(emailLabel(one)).toBe("Email");
    // The tick alone asks for nothing: an empty row is still nobody.
    box(two).checked = true;
    box(two).dispatchEvent(new Event("change", { bubbles: true }));
    expect([...two.querySelectorAll<HTMLInputElement>("input[data-part]")].some((b) => b.required)).toBe(false);
  });

  it("sends the tick with the person it is beside, and nothing for anyone else", async () => {
    load();
    fillTeam();
    click($<HTMLButtonElement>("[data-team-add]"));
    const fill = (li: HTMLElement, first: string, email: string) => {
      type(li.querySelector<HTMLInputElement>('input[data-part="firstName"]')!, first);
      type(li.querySelector<HTMLInputElement>('input[data-part="lastName"]')!, "Example");
      type(li.querySelector<HTMLInputElement>('input[data-part="email"]')!, email);
    };
    fill(rows()[0], "Ava", "ava@example.com");
    fill(rows()[1], "Jack", "parent@example.com");
    const under = rows()[1].querySelector<HTMLInputElement>("input[data-team-under18]")!;
    under.checked = true;
    under.dispatchEvent(new Event("change", { bubbles: true }));
    toEnd();
    await submit();
    expect(sent().teamMembers).toEqual([
      { firstName: "Ava", lastName: "Example", email: "ava@example.com" },
      { firstName: "Jack", lastName: "Example", email: "parent@example.com", under18: true },
    ]);
  });

  it("asks for all three of a person once any is typed", () => {
    load();
    tick("pathRaising");
    tick("teamYes");
    const [first, last, email] = [...rows()[0].querySelectorAll<HTMLInputElement>("input")];
    expect(first.required || last.required || email.required).toBe(false);
    type(first, "Ava");
    expect(last.required && email.required).toBe(true);
  });

  it("asks a sharing team whether the split is just the organiser's or the whole team's", () => {
    load();
    tick("pathRaising");
    tick("teamYes");
    tick("sharesYes");
    expect($("[data-team-share]").hidden).toBe(false);
    expect($("[data-team-share] legend").textContent!.trim()).toBe("Just you, or the whole team?");
    expect($$<HTMLInputElement>('input[name="teamShareMode"]').every((r) => r.required && !r.checked)).toBe(true);
    tick("sharesNo");
    expect($("[data-team-share]").hidden).toBe(true);
  });
});

describe("sending a team", () => {
  it("sends the team's name as its name, its target, and the people added", async () => {
    load();
    fillTeam();
    type(rows()[0].querySelector<HTMLInputElement>('input[data-part="firstName"]')!, "Ava");
    type(rows()[0].querySelector<HTMLInputElement>('input[data-part="lastName"]')!, "Example");
    type(rows()[0].querySelector<HTMLInputElement>('input[data-part="email"]')!, "ava@example.com");
    toEnd();
    await submit();
    expect(sends()).toHaveLength(1);
    const body = sent();
    expect(body).toMatchObject({ team: "team", title: "Exampleton Juniors", targetPence: 200000 });
    expect(body.teamMembers).toEqual([{ firstName: "Ava", lastName: "Example", email: "ava@example.com" }]);
    expect(body.teamShareMode).toBeNull();
  });

  it("sends just me as before, with no one to invite", async () => {
    load();
    fillTeam();
    tick("teamMe");
    type("title", "Robin's Dash");
    // Just me is asked whether to list it; a team never is.
    walk();
    expect(has("listedYes")).toBe(true);
    tick("listedYes");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ team: "me", title: "Robin's Dash", teamMembers: [] });
  });

  it("puts the server's message beside the right person's box", async () => {
    answer = (url) =>
      url === "/api/fundraise/captcha"
        ? { status: 200, body: { siteKey: null } }
        : { status: 400, body: { fields: { "teamMembers.1.email": "Check this email address." } } };
    load();
    fillTeam();
    click($<HTMLButtonElement>("[data-team-add]"));
    for (const [i, name] of [[0, "Ava"], [1, "Ben"]] as const) {
      type(rows()[i].querySelector<HTMLInputElement>('input[data-part="firstName"]')!, name);
      type(rows()[i].querySelector<HTMLInputElement>('input[data-part="lastName"]')!, "Example");
      type(rows()[i].querySelector<HTMLInputElement>('input[data-part="email"]')!, `${name.toLowerCase()}@example.com`);
    }
    toEnd();
    await submit();
    const box = rows()[1].querySelector<HTMLInputElement>('input[data-part="email"]')!;
    expect(box.getAttribute("aria-invalid")).toBe("true");
    // And goes back to the team step, where that person is.
    expect(current().contains(box)).toBe(true);
  });

  it("thanks a team with what happens next for its members", async () => {
    load();
    fillTeam();
    toEnd();
    await submit();
    expect($<HTMLElement>("[data-thanks-team]").hidden).toBe(false);
    expect($<HTMLElement>("[data-thanks-team]").textContent).toBe("We also email you the link for your team to join, and invite anyone you added.");
    expect($<HTMLElement>("[data-thanks-listed]").hidden).toBe(false);
  });
});

// The sign up tidy (Jaimie, 2026-10-03): "Shall we show it on the NBCC website?" (public) is now
// "Shall we list it on our Get involved page?" (listed); every sign up is sent as public.
describe("a team is always on Get involved (review)", () => {
  it("never asks a team whether to list it, and sends it as listed", async () => {
    load();
    tick("pathRaising");
    tick("teamYes");
    expect(($("#listedYes").closest("[data-step]") as HTMLElement).hidden).toBe(true);
    tick("teamMe");
    expect(($("#listedYes").closest("[data-step]") as HTMLElement).hidden).toBe(false);
    tick("teamYes");
    fillTeam();
    tick("listedNo");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({ team: "team", public: true, listed: true });
  });
});
