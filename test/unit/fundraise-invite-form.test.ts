// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// TASK-503: the sign up form opened from a staff invite's link (/fundraise?invite=...). It asks the
// server for the invite and fills in the first name, surname and email, and nothing else; anything typed already
// stays. The sign up carries the invite back, so the server can mark it used. A link that no longer
// works changes nothing: the form is just the form. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let inviteAnswer: { status: number; body: unknown };

function load(search: string) {
  window.history.replaceState({}, "", "/fundraise" + search);
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderFundraiseSignUp(template, true), "text/html").documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = url === "/api/fundraise/invite" ? inviteAnswer : { status: 200, body: { siteKey: null } };
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  return initFundraiseForm(document, window);
}
const $ = (sel: string) => document.querySelector<HTMLInputElement>(sel)!;
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const inviteCalls = () => calls.filter((c) => c.url === "/api/fundraise/invite");

beforeEach(() => {
  // As the server answers now: the two boxes, and the one name for pages loaded before them.
  inviteAnswer = { status: 200, body: { name: "Mary Jane Smith", firstName: "Mary Jane", lastName: "Smith", email: "alex@example.com" } };
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("a form opened from an invite", () => {
  it("asks for the invite by POST, and fills in only the first name, surname and email", async () => {
    const form = load(`?invite=${TOKEN}`);
    await settle();
    expect(inviteCalls()).toHaveLength(1);
    expect(inviteCalls()[0].init?.method).toBe("POST");
    expect(JSON.parse(String(inviteCalls()[0].init?.body))).toEqual({ token: TOKEN });
    // Jaimie 2026-10-03: the first name and surname exactly as staff typed them in their own boxes.
    expect($("#firstName").value).toBe("Mary Jane");
    expect($("#lastName").value).toBe("Smith");
    expect($("#email").value).toBe("alex@example.com");
    for (const id of ["title", "description", "phone", "town"]) expect($(`#${id}`).value).toBe("");
    expect(form.payload().invite).toBe(TOKEN);
  });

  it("still splits a one name answer at its first space", async () => {
    inviteAnswer = { status: 200, body: { name: "Alex Example Jones", email: "alex@example.com" } };
    load(`?invite=${TOKEN}`);
    await settle();
    expect($("#firstName").value).toBe("Alex");
    expect($("#lastName").value).toBe("Example Jones");
  });

  it("takes the invite out of the address as soon as it has asked, keeping the rest", async () => {
    const form = load(`?ref=qr&invite=${TOKEN}`);
    // At once, before the answer: the token never stays in the address bar or the history.
    expect(inviteCalls()).toHaveLength(1);
    expect(window.location.pathname).toBe("/fundraise");
    expect(window.location.search).toBe("?ref=qr");
    expect(window.location.href).not.toContain(TOKEN);
    await settle();
    // The sign up still carries it back.
    expect(form.payload().invite).toBe(TOKEN);
  });

  it("leaves an address with no invite in it alone", async () => {
    load("?ref=qr");
    expect(window.location.search).toBe("?ref=qr");
  });

  it("never fills in more, whatever comes back", async () => {
    inviteAnswer = { status: 200, body: { firstName: "Alex", lastName: "Example", email: "alex@example.com", title: "Sneaky", phone: "07700 900999" } };
    load(`?invite=${TOKEN}`);
    await settle();
    expect($("#title").value).toBe("");
    expect($("#phone").value).toBe("");
  });

  it("keeps anything already typed", async () => {
    load(`?invite=${TOKEN}`);
    $("#firstName").value = "Alexandra";
    await settle();
    expect($("#firstName").value).toBe("Alexandra");
    expect($("#email").value).toBe("alex@example.com");
  });

  it("is just the form when the link no longer works", async () => {
    inviteAnswer = { status: 404, body: { error: "That invite link has expired or already been used. You can still fill in the form." } };
    const form = load(`?invite=${TOKEN}`);
    await settle();
    expect($("#firstName").value).toBe("");
    expect($("#lastName").value).toBe("");
    expect(form.payload().invite).toBeUndefined();
  });
});

describe("a form opened without an invite", () => {
  it("asks for nothing and sends no invite", async () => {
    const form = load("");
    await settle();
    expect(inviteCalls()).toHaveLength(0);
    expect(form.payload()).not.toHaveProperty("invite");
  });

  it("ignores something in the link that is not an invite", async () => {
    load("?invite=<script>");
    await settle();
    expect(inviteCalls()).toHaveLength(0);
  });
});
