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

const UNDER_18 =
  "You need to be 18 or over to set up a page. Ask a parent, guardian or another grown up you trust to set it up for you: they can name you on the page (for example, 'for Ella's 10th birthday'). Any questions, call 01292 811 015 or email events@nbcc.scot.";

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
const submit = async () => {
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
