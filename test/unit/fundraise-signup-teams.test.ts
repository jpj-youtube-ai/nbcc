// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// Team pages (Jaimie, 2026-10-03): "Just me, or a team?" on the sign up form, for someone raising
// money (never an event), with nothing chosen. A team asks for the team's name and target, says the
// person setting it up is the team organiser, and may add team members (first name, surname and
// email per person, up to 30), held until staff approve the team. Sharing with another cause asks one
// more question: "Just you, or the whole team?". Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

const ORGANISER_NOTE = "As the person setting up the team, you’ll be the team organiser: you’ll get the team’s emails and look after the team page.";

let calls: Array<{ url: string; init?: RequestInit }>;
let answer: (url: string) => { status: number; body: unknown };

function load() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderFundraiseSignUp(template, true), "text/html").documentElement.innerHTML;
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

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

function fillTeam() {
  tick("pathRaising");
  tick("over18Yes");
  tick("teamYes");
  type("teamName", "Exampleton Juniors");
  type("teamTarget", "2000");
  tick("kind-santa_dash");
  type("description", "The under 12s, dashing in Santa suits.");
  tick("sharesNo");
  tick("publicYes");
  type("firstName", "Robin");
  type("lastName", "Organiser");
  type("email", "robin@example.com");
  type("phone", "07700 900111");
  tick("socialOkNo");
  tick("shoutOutNo");
  tick("attendNo");
}

const submit = async () => {
  $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};

describe("Just me, or a team?, in the page as it is", () => {
  it("comes straight after 18 or over, with nothing chosen", () => {
    load();
    const step = $("#teamYes").closest("[data-step]") as HTMLElement;
    expect(steps().indexOf(step)).toBe(2);
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
    expect($("[data-team-members-note]").textContent).toContain("If they’re under 18, give their parent or guardian’s email.");
    expect(rows()).toHaveLength(1);
    const add = $<HTMLButtonElement>("[data-team-add]");
    click(add);
    click(add);
    expect(rows()).toHaveLength(3);
    const labels = rows()[1].querySelectorAll("label");
    expect([...labels].map((l) => l.textContent!.replace(/\s+/g, " ").trim())).toEqual(["First name", "Surname", "Email"]);
    click(rows()[1].querySelector<HTMLElement>("[data-team-remove]")!);
    expect(rows()).toHaveLength(2);
    for (let i = 0; i < 40; i++) click(add);
    expect(rows()).toHaveLength(30);
    expect(add.disabled).toBe(true);
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
    await submit();
    expect(rows()[1].querySelector<HTMLInputElement>('input[data-part="email"]')!.getAttribute("aria-invalid")).toBe("true");
  });

  it("thanks a team with what happens next for its members", async () => {
    load();
    fillTeam();
    await submit();
    expect($<HTMLElement>("[data-thanks-team]").hidden).toBe(false);
  });
});

describe("a team is always on the website (review)", () => {
  it("never asks a team whether to show it, and sends it as shown", async () => {
    load();
    tick("pathRaising");
    tick("teamYes");
    expect(($("#publicYes").closest("[data-step]") as HTMLElement).hidden).toBe(true);
    tick("teamMe");
    expect(($("#publicYes").closest("[data-step]") as HTMLElement).hidden).toBe(false);
    tick("teamYes");
    fillTeam();
    tick("publicNo");
    await submit();
    expect(sent().public).toBe(true);
  });
});
