// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderJoinPage } from "../../src/fundraising/team-render";

// Team pages (Jaimie, 2026-10-03): the join form's script (assets/js/fundraise-join.js) in the page as
// the server draws it. Nothing is chosen for them; a No to 18 or over stops the form with the same
// kind note as the sign up form; an invite's link fills in the first name, surname and email (only
// for this team) and comes out of the address bar; the sharing question is only sent when it is
// asked; and the server's answers land where they belong. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initJoinForm } = require(resolve(ROOT, "assets/js/fundraise-join.js"));
const template = readFileSync(resolve(ROOT, "fundraise-join.html"), "utf8");

// The sign up tidy (Jaimie, 2026-10-03): the same words on every form.
const UNDER_18 =
  "You need to be 18 or over to sign up. A parent, carer or another adult you trust can do it for you and name you on the page. If you'd like to talk it through, call 01292 811 015 or email events@nbcc.scot.";

let calls: Array<{ url: string; body: Record<string, unknown> | null }>;
let answer: (url: string) => { status: number; body: unknown };

function load(o: { askShare?: boolean; search?: string } = {}) {
  const html = renderJoinPage(template, {
    open: true,
    team: { slug: "ej", title: "Exampleton Juniors", organisedBy: "Robin O.", kindLabel: "Santa dash", eventDate: "2026-12-05" },
    shareNote: null,
    askShare: o.askShare ?? false,
  });
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const a = answer(url);
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  window.history.replaceState(null, "", `/fundraise/ej/join${o.search ?? ""}`);
  return initJoinForm(document, window);
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const type = (id: string, v: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const tick = (id: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
// The sign up tidy: one question at a time. Next to the last step, then Join the team.
const next = () => $<HTMLButtonElement>("[data-next]").click();
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const submit = async () => {
  for (let i = 0; i < 8 && !$("[data-next]").hidden; i++) next();
  $("#joinForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};
const joins = () => calls.filter((c) => c.url === "/api/fundraise/teams/ej/join");

beforeEach(() => {
  answer = (url) =>
    url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } };
});

function fillIn() {
  type("firstName", "Jack");
  type("lastName", "Sample");
  type("email", "parent@example.com");
  tick("memberUnder18No");
  tick("over18Yes");
}

describe("the join form", () => {
  it("shows itself, with nothing chosen for them", () => {
    load();
    expect($("#joinForm").hidden).toBe(false);
    expect([...document.querySelectorAll<HTMLInputElement>('input[name="over18"]')].some((r) => r.checked)).toBe(false);
  });

  it("stops at a No to 18 or over, with the kind note, and sends nothing", async () => {
    load();
    fillIn();
    tick("over18No");
    expect($("[data-age-note]").textContent).toBe(UNDER_18);
    await submit();
    expect(joins()).toEqual([]);
  });

  it("sends what they typed to the team's join address, and thanks them", async () => {
    load();
    fillIn();
    type("target", "50");
    type("why", "For Christmas.");
    await submit();
    expect(joins()).toHaveLength(1);
    const body = joins()[0].body!;
    expect(body).toMatchObject({ firstName: "Jack", lastName: "Sample", email: "parent@example.com", over18: true, targetPence: 5000, why: "For Christmas." });
    expect(body).not.toHaveProperty("sharesWithOther");
    expect($("[data-join-thanks]").hidden).toBe(false);
    expect($("[data-thanks-name]").textContent).toBe(", Jack");
  });

  it("asks and sends the sharing question only when the team organiser's split is their own", async () => {
    load({ askShare: true });
    fillIn();
    tick("sharesYes");
    expect($("[data-split-fields]").hidden).toBe(false);
    type("nbccSharePercent", "60");
    type("otherCauseName", "Example Hospice");
    await submit();
    expect(joins()[0].body).toMatchObject({ sharesWithOther: true, nbccSharePercent: "60", otherCauseName: "Example Hospice" });
  });

  it("puts the server's messages beside their boxes", async () => {
    answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 400, body: { fields: { email: "Please check your email address." } } });
    load();
    fillIn();
    await submit();
    expect($("#email").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the closed panel when the team stopped taking members meanwhile", async () => {
    answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 404, body: {} });
    load();
    fillIn();
    await submit();
    expect($("[data-join-closed]").hidden).toBe(false);
    expect($("[data-join-open]").hidden).toBe(true);
  });
});

describe("one question at a time (the sign up tidy)", () => {
  it("shows a progress bar of three stages, and says how long it takes", () => {
    load();
    expect([...document.querySelectorAll(".fr-progress__label")].map((n) => n.textContent)).toEqual(["About you", "Your page", "Send"]);
    expect($("[data-progress-step]").textContent).toBe("Step 1 of 3: About you");
    expect(document.querySelector(".fr-progress__stage.is-current")!.getAttribute("aria-current")).toBe("step");
    expect($(".fr-one-liner").textContent).toBe("It only takes a couple of minutes.");
  });

  it("stays on a step with something missing, with a warm prompt and the focus on it", () => {
    load();
    next();
    expect(current().contains($("#firstName"))).toBe(true);
    expect(document.getElementById("firstName-error")!.textContent).toBe("Almost! Just add the first name.");
    expect(document.activeElement).toBe($("#firstName"));
  });

  it("goes on with Next, back with Back keeping every answer, and lifts on the last step", () => {
    load();
    fillIn();
    next();
    expect(current().contains($("#over18Yes"))).toBe(true);
    next();
    expect($("[data-progress-step]").textContent).toBe("Step 2 of 3: Your page");
    next();
    expect(($("[data-progress-step]").textContent ?? "") + ($("[data-progress-lift]").textContent ?? "")).toBe("Step 3 of 3: Send Last step!");
    expect($("[data-next]").hidden).toBe(true);
    $<HTMLButtonElement>("[data-back]").click();
    $<HTMLButtonElement>("[data-back]").click();
    $<HTMLButtonElement>("[data-back]").click();
    expect($("#firstName").value).toBe("Jack");
    expect($("[data-back]").hidden).toBe(true);
  });

  it("skips the sharing question when the team is not asked it", () => {
    load();
    fillIn();
    next();
    next();
    next();
    expect(current().contains($("#sharesYes"))).toBe(false);
  });

  it("holds an under 18 on that step", () => {
    load();
    fillIn();
    tick("over18No");
    next();
    next();
    expect(current().contains($("#over18Yes"))).toBe(true);
  });
});

describe("joining for someone under 18 (Jaimie, 2026-10-03)", () => {
  it("asks whether the person joining is under 18, with nothing chosen", () => {
    load();
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="memberUnder18"]')];
    expect(radios).toHaveLength(2);
    expect(radios.some((r) => r.checked)).toBe(false);
    expect($("#memberUnder18Group legend").textContent).toBe("Is the person joining under 18?");
    expect($("[data-guardian-fields]").hidden).toBe(true);
    next();
    expect(document.getElementById("memberUnder18-error")!.textContent).toBe("Almost! Just tell us whether the person joining is under 18.");
  });

  it("asks a parent or guardian for their first name and their tick", () => {
    load();
    type("firstName", "Jack");
    type("lastName", "Sample");
    type("email", "parent@example.com");
    tick("memberUnder18Yes");
    expect($("[data-guardian-fields]").hidden).toBe(false);
    expect($("label[for=guardianFirstName]").textContent!.replace(/\s+/g, " ").trim()).toBe("Your first name, as their parent or guardian *");
    expect($("label[for=guardianConsent] .give-check-text").textContent).toBe(
      "I’m their parent or guardian, and I’m happy for their first name and any photo to be shown on the page and our social media.",
    );
    next();
    expect(document.getElementById("guardianFirstName-error")!.textContent).toBe("Almost! Just add your first name.");
    expect(document.getElementById("guardianConsent-error")!.textContent).toBe("Almost! Just tick to say you're happy for their first name to be shown.");
  });

  it("asks why they are taking part by their name", () => {
    load();
    expect($("label[for=why]").textContent!.replace(/\s+/g, " ").trim()).toBe("Why are you taking part? (optional)");
    type("firstName", "Jack");
    tick("memberUnder18Yes");
    expect($("label[for=why]").textContent!.replace(/\s+/g, " ").trim()).toBe("Why is Jack taking part? (optional)");
    tick("memberUnder18No");
    expect($("label[for=why]").textContent!.replace(/\s+/g, " ").trim()).toBe("Why are you taking part? (optional)");
  });

  it("sends the parent's first name and tick, and nothing of them for an adult", async () => {
    load();
    fillIn();
    tick("memberUnder18Yes");
    type("guardianFirstName", "Sarah");
    tick("guardianConsent");
    await submit();
    expect(joins()[0].body).toMatchObject({ memberUnder18: true, guardianFirstName: "Sarah", guardianConsent: true });
    load();
    fillIn();
    await submit();
    expect(joins()[0].body).toMatchObject({ memberUnder18: false, guardianFirstName: "", guardianConsent: false });
  });
});

describe("the trap box (after review)", () => {
  it("has a name no autofill fills in, and is sent under it", async () => {
    load();
    expect(document.querySelector('[name="company"]')).toBeNull();
    fillIn();
    await submit();
    expect(joins()[0].body).toHaveProperty("nbccCheck", "");
  });
});

describe("an invite's link", () => {
  const token = "a".repeat(43);

  it("fills in the first name, surname and email, takes the token out of the address, and carries it back", async () => {
    answer = (url) =>
      url === "/api/fundraise/team-invite"
        ? { status: 200, body: { firstName: "Jack", lastName: "Sample", email: "parent@example.com", teamSlug: "ej" } }
        : url === "/api/fundraise/captcha"
          ? { status: 200, body: { siteKey: null } }
          : { status: 200, body: { status: "received" } };
    load({ search: `?invite=${token}&utm_source=email` });
    expect(window.location.search).toBe("?utm_source=email");
    await flush();
    expect(calls.find((c) => c.url === "/api/fundraise/team-invite")?.body).toEqual({ token });
    expect($("#firstName").value).toBe("Jack");
    expect($("#email").value).toBe("parent@example.com");
    tick("memberUnder18No");
    tick("over18Yes");
    await submit();
    expect(joins()[0].body).toMatchObject({ invite: token });
  });

  it("fills in nothing for another team's invite", async () => {
    answer = (url) =>
      url === "/api/fundraise/team-invite"
        ? { status: 200, body: { firstName: "Jack", lastName: "Sample", email: "parent@example.com", teamSlug: "other" } }
        : { status: 200, body: { siteKey: null } };
    load({ search: `?invite=${token}` });
    await flush();
    expect($("#firstName").value).toBe("");
  });
});
