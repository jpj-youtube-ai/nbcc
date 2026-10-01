// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-NNN: assets/js/contact-captcha.js, the contact page's Cloudflare Turnstile box. jsdom does
// not fetch external scripts, so each test stands in for Cloudflare: it sets window.turnstile and
// calls the onload callback the script asked Cloudflare to call.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "contact.html"), "utf8");
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const { initContactCaptcha } = require(resolve(ROOT, "assets/js/contact-captcha.js"));
const { initContactForm } = require(resolve(ROOT, "assets/js/main.js"));

type Win = Window & { fetch?: unknown; turnstile?: unknown; nbccTurnstileReady?: () => void };
const win = window as unknown as Win;
const KEY = "1x00000000000000000000AA";
const WAITING = "One moment, we're still checking you're not a robot.";
const BROKEN = "The spam check could not load. Please try again in a moment, or email info@nbcc.scot.";
const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement & { value?: string };
const turnstile = { render: vi.fn(() => "w1"), reset: vi.fn() };
const cloudflareScript = () =>
  document.head.querySelector('script[src*="challenges.cloudflare.com"]') as HTMLScriptElement | null;
const submit = () => el("contactForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const renderOptions = () => (turnstile.render.mock.calls[0] as unknown as [HTMLElement, Record<string, (...a: unknown[]) => void>])[1];

function fillValidForm() {
  el("firstName").value = "Ada";
  el("email").value = "ada@example.com";
  el("message").value = "Happy to help.";
}

async function start(siteKey: string | null) {
  win.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ siteKey }) });
  initContactCaptcha(document, window);
  await flush();
  await flush();
}

function cloudflareArrives() {
  win.turnstile = turnstile;
  win.nbccTurnstileReady!();
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = bodyHtml;
  turnstile.render.mockClear();
  turnstile.reset.mockClear();
  delete win.turnstile;
  delete win.nbccTurnstileReady;
});

describe("with the check off", () => {
  it("asks the server, then draws nothing, loads nothing from Cloudflare, and never holds Send", async () => {
    await start(null);
    expect(win.fetch).toHaveBeenCalledWith("/api/contact/captcha");
    expect(cloudflareScript()).toBeNull();
    expect(el("contactCaptcha").hidden).toBe(true);
    fillValidForm();
    expect(submit()).toBe(true);
  });
});

describe("with the check on", () => {
  it("loads Cloudflare's script for explicit rendering, and draws the box once it is ready", async () => {
    await start(KEY);
    expect(cloudflareScript()?.src).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccTurnstileReady",
    );
    cloudflareArrives();
    expect(turnstile.render).toHaveBeenCalledWith(el("contactCaptcha"), expect.objectContaining({ sitekey: KEY }));
    expect(el("contactCaptcha").hidden).toBe(false);
  });

  it("draws the Compact box when the form is narrower than 300px, so nothing scrolls sideways", async () => {
    await start(KEY);
    cloudflareArrives();
    expect(renderOptions().size).toBe("compact");
  });

  it("draws the Flexible box when the form has room for it", async () => {
    await start(KEY);
    el("contactCaptcha").getBoundingClientRect = () => ({ width: 340 }) as DOMRect;
    cloudflareArrives();
    expect(renderOptions().size).toBe("flexible");
  });

  it("holds Send, saying why, while there is no pass yet", async () => {
    await start(KEY);
    cloudflareArrives();
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(WAITING);
  });

  it("leaves an invalid form to main.js, which flags its fields", async () => {
    await start(KEY);
    cloudflareArrives();
    expect(submit()).toBe(true);
    expect(el("formStatus").textContent).not.toBe(WAITING);
  });

  it("puts the pass in the hidden field, lets Send through, and resets the box straight after", async () => {
    await start(KEY);
    cloudflareArrives();
    renderOptions().callback("tok-1");
    expect(el("captchaToken").value).toBe("tok-1");
    fillValidForm();
    expect(submit()).toBe(true);
    await flush();
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
    expect(el("captchaToken").value).toBe("");
  });

  it("clears a pass that expires", async () => {
    await start(KEY);
    cloudflareArrives();
    renderOptions().callback("tok-1");
    renderOptions()["expired-callback"]();
    expect(el("captchaToken").value).toBe("");
  });

  it("says the check could not load, with the email address, when Cloudflare reports an error", async () => {
    await start(KEY);
    cloudflareArrives();
    renderOptions()["error-callback"]("110200");
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(BROKEN);
  });

  it("says the same when Cloudflare's script cannot be fetched at all", async () => {
    await start(KEY);
    cloudflareScript()!.onerror!(new Event("error"));
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(BROKEN);
  });
});

describe("with main.js", () => {
  it("sends the pass with the message, once, and resets the box for the next", async () => {
    const posted: string[] = [];
    win.fetch = vi.fn((url: string, init?: { body?: string }) => {
      if (url === "/api/contact/captcha") return Promise.resolve({ ok: true, json: async () => ({ siteKey: KEY }) });
      posted.push(JSON.parse(init!.body!).captchaToken);
      return Promise.resolve({ ok: true, json: async () => ({ status: "sent" }) });
    });
    initContactForm(document, window);
    initContactCaptcha(document, window);
    await flush();
    await flush();
    cloudflareArrives();
    renderOptions().callback("tok-1");
    fillValidForm();
    submit();
    await flush();
    await flush();
    expect(posted).toEqual(["tok-1"]);
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
  });
});
