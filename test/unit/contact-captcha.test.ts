// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-490: assets/js/contact-captcha.js, the contact page's Cloudflare Turnstile box. jsdom does
// not fetch external scripts, so each test stands in for Cloudflare: it sets window.turnstile and
// calls the onload callback the script asked Cloudflare to call. jsdom has no layout either, so the
// form's room and the window's width are set by hand where a test needs them.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "contact.html"), "utf8");
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const { initContactCaptcha } = require(resolve(ROOT, "assets/js/contact-captcha.js"));
const { initContactForm, validateForm, clearValidation } = require(resolve(ROOT, "assets/js/main.js"));

type Win = Window & {
  fetch?: unknown;
  turnstile?: unknown;
  nbccTurnstileReady?: () => void;
  NBCCFormValidation?: unknown;
};
const win = window as unknown as Win;
const KEY = "1x00000000000000000000AA";
const WAITING = "One moment, we're still checking you're not a robot.";
const STILL_WAITING = "Still checking you're not a robot. If this keeps happening, please email info@nbcc.scot.";
const TICK = "Please tick the box above Send to show you're not a robot.";
const BROKEN = "The spam check could not load. Please try again in a moment, or email info@nbcc.scot.";
const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement & { value?: string };
const turnstile = { render: vi.fn(() => "w1"), reset: vi.fn(), remove: vi.fn() };
const cloudflareScripts = () =>
  Array.from(document.head.querySelectorAll('script[src*="challenges.cloudflare.com"]')) as HTMLScriptElement[];
const cloudflareScript = () => cloudflareScripts()[0] ?? null;
const submit = () => el("contactForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
type Options = Record<string, (...a: unknown[]) => unknown> & { size?: string };
const renderOptions = (n = 0) => (turnstile.render.mock.calls[n] as unknown as [HTMLElement, Options])[1];
const roomIs = (width: number) => Object.defineProperty(el("contactForm"), "clientWidth", { value: width, configurable: true });
const windowIs = (width: number) =>
  Object.defineProperty(document.documentElement, "clientWidth", { value: width, configurable: true });

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

// The visitor taps into the first field.
function startOnTheForm() {
  el("firstName").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
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
  turnstile.remove.mockClear();
  delete win.turnstile;
  delete win.nbccTurnstileReady;
  delete win.NBCCFormValidation;
  delete (document.documentElement as { clientWidth?: number }).clientWidth;
});

describe("with the check off", () => {
  it("asks the server, then draws nothing, loads nothing from Cloudflare, and never holds Send", async () => {
    await start(null);
    expect(win.fetch).toHaveBeenCalledWith("/api/contact/captcha");
    startOnTheForm();
    expect(cloudflareScript()).toBeNull();
    expect(el("contactCaptcha").hidden).toBe(true);
    fillValidForm();
    expect(submit()).toBe(true);
  });

  it.each([
    ["cannot be asked", () => vi.fn().mockRejectedValue(new TypeError("offline"))],
    ["answers with an error", () => vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })],
  ])("stays out of the way when the server %s", async (_how, fetchImpl) => {
    win.fetch = fetchImpl();
    initContactCaptcha(document, window);
    await flush();
    await flush();
    startOnTheForm();
    expect(cloudflareScript()).toBeNull();
    fillValidForm();
    expect(submit()).toBe(true);
  });
});

describe("with the check on", () => {
  it("does not contact Cloudflare until the visitor starts on the form, then loads its script once", async () => {
    await start(KEY);
    expect(cloudflareScript()).toBeNull();
    startOnTheForm();
    expect(cloudflareScript()?.src).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=nbccTurnstileReady",
    );
    startOnTheForm();
    el("message").dispatchEvent(new Event("input", { bubbles: true }));
    expect(cloudflareScripts()).toHaveLength(1);
  });

  it("starts straight away when the visitor is already in the form as the server answers", async () => {
    el("firstName").focus();
    await start(KEY);
    expect(cloudflareScript()).not.toBeNull();
  });

  it("starts when Send is pressed before any field was touched, and holds it", async () => {
    await start(KEY);
    fillValidForm();
    expect(submit()).toBe(false);
    expect(cloudflareScript()).not.toBeNull();
    expect(el("formStatus").textContent).toBe(WAITING);
  });

  it("draws the box once Cloudflare is ready", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    expect(turnstile.render).toHaveBeenCalledWith(el("contactCaptcha"), expect.objectContaining({ sitekey: KEY }));
    expect(el("contactCaptcha").hidden).toBe(false);
  });

  it("draws the Compact box when the form is narrower than 300px, so nothing scrolls sideways", async () => {
    await start(KEY);
    roomIs(230);
    startOnTheForm();
    cloudflareArrives();
    expect(renderOptions().size).toBe("compact");
  });

  it("draws the Flexible box when the form has room for it", async () => {
    await start(KEY);
    roomIs(340);
    startOnTheForm();
    cloudflareArrives();
    expect(renderOptions().size).toBe("flexible");
  });

  it("holds Send, saying why, while there is no pass yet", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(WAITING);
  });

  it("mentions the email address if Send is pressed again while still waiting", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    fillValidForm();
    submit();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(STILL_WAITING);
  });

  it("asks the visitor to tick the box when Cloudflare shows one", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    renderOptions()["before-interactive-callback"]();
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(TICK);
    renderOptions()["after-interactive-callback"]();
    renderOptions().callback("tok-1");
    expect(submit()).toBe(true);
  });

  it("leaves an invalid form to main.js, which flags its fields", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    expect(submit()).toBe(true);
    expect(el("formStatus").textContent).not.toBe(WAITING);
  });

  it("uses main.js's own form check when the page has it, so the two always agree", async () => {
    const check = vi.fn(() => ({ valid: false }));
    win.NBCCFormValidation = { validateForm: check };
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    fillValidForm();
    expect(submit()).toBe(true);
    expect(check).toHaveBeenCalledWith(el("contactForm"));
    check.mockReturnValue({ valid: true });
    el("email").value = "";
    expect(submit()).toBe(false);
  });

  it("puts the pass in the hidden field, lets Send through, and resets the box straight after", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    renderOptions().callback("tok-1");
    expect(el("captchaToken").value).toBe("tok-1");
    fillValidForm();
    expect(submit()).toBe(true);
    await flush();
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
    expect(el("captchaToken").value).toBe("");
  });

  it("takes its own message back once the pass arrives", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    fillValidForm();
    submit();
    renderOptions().callback("tok-1");
    expect(el("formStatus").textContent).toBe("");
    expect(el("formStatus").className).toBe("form-status");
  });

  it("leaves main.js's messages alone when a pass arrives", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    el("formStatus").textContent = "Thank you Ada, your message has reached the NBCC inbox. We will be in touch soon.";
    renderOptions().callback("tok-2");
    expect(el("formStatus").textContent).toMatch(/^Thank you Ada/);
  });

  it.each(["expired-callback", "timeout-callback"])("clears the pass on Cloudflare's %s", async (name) => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    renderOptions().callback("tok-1");
    renderOptions()[name]();
    expect(el("captchaToken").value).toBe("");
  });

  it("says the check could not load, with the email address, when Cloudflare reports an error", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    renderOptions()["error-callback"]("110200");
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(BROKEN);
  });

  it("recovers when a pass follows an error", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareArrives();
    renderOptions()["error-callback"]("110200");
    fillValidForm();
    submit();
    renderOptions().callback("tok-1");
    expect(el("formStatus").textContent).toBe("");
    expect(submit()).toBe(true);
  });

  it("says the same when Cloudflare's script cannot be fetched, and tries again when Send is pressed", async () => {
    await start(KEY);
    startOnTheForm();
    cloudflareScript()!.onerror!(new Event("error"));
    expect(cloudflareScripts()).toHaveLength(0);
    fillValidForm();
    expect(submit()).toBe(false);
    expect(el("formStatus").textContent).toBe(BROKEN);
    expect(cloudflareScripts()).toHaveLength(1);
    el("message").dispatchEvent(new Event("input", { bubbles: true }));
    expect(cloudflareScripts()).toHaveLength(1);
  });

  it("draws the box again at the size that fits when the form gets narrower, like a phone turned upright", async () => {
    windowIs(700);
    await start(KEY);
    roomIs(560);
    startOnTheForm();
    cloudflareArrives();
    renderOptions().callback("tok-1");
    expect(renderOptions().size).toBe("flexible");
    roomIs(270);
    windowIs(360);
    window.dispatchEvent(new Event("resize"));
    expect(turnstile.remove).toHaveBeenCalledWith("w1");
    expect(renderOptions(1).size).toBe("compact");
    expect(el("captchaToken").value).toBe("");
  });

  it("leaves the box alone when only the height changes, or the size still fits", async () => {
    windowIs(700);
    await start(KEY);
    roomIs(560);
    startOnTheForm();
    cloudflareArrives();
    roomIs(270);
    window.dispatchEvent(new Event("resize"));
    roomIs(400);
    windowIs(540);
    window.dispatchEvent(new Event("resize"));
    expect(turnstile.remove).not.toHaveBeenCalled();
    expect(turnstile.render).toHaveBeenCalledTimes(1);
  });
});

describe("with main.js", () => {
  function startBoth(posted: string[]) {
    win.fetch = vi.fn((url: string, init?: { body?: string }) => {
      if (url === "/api/contact/captcha") return Promise.resolve({ ok: true, json: async () => ({ siteKey: KEY }) });
      posted.push(JSON.parse(init!.body!).captchaToken);
      return Promise.resolve({ ok: true, json: async () => ({ status: "sent" }) });
    });
    // As on the live page, where main.js exposes its form check before this script runs.
    win.NBCCFormValidation = { validateForm, clearValidation };
    initContactForm(document, window);
    initContactCaptcha(document, window);
  }

  it("sends the pass with the message, once, and resets the box for the next", async () => {
    const posted: string[] = [];
    startBoth(posted);
    await flush();
    await flush();
    startOnTheForm();
    cloudflareArrives();
    renderOptions().callback("tok-1");
    fillValidForm();
    submit();
    await flush();
    await flush();
    expect(posted).toEqual(["tok-1"]);
    expect(turnstile.reset).toHaveBeenCalledWith("w1");
  });

  it("posts nothing while there is no pass", async () => {
    const posted: string[] = [];
    startBoth(posted);
    await flush();
    await flush();
    startOnTheForm();
    cloudflareArrives();
    fillValidForm();
    submit();
    await flush();
    expect(posted).toEqual([]);
    expect(el("formStatus").textContent).toBe(WAITING);
  });

  it("lets main.js flag an email it does not accept, keeping the unused pass", async () => {
    const posted: string[] = [];
    startBoth(posted);
    await flush();
    await flush();
    startOnTheForm();
    cloudflareArrives();
    renderOptions().callback("tok-1");
    fillValidForm();
    el("email").value = "ada@example";
    submit();
    await flush();
    expect(posted).toEqual([]);
    expect(turnstile.reset).not.toHaveBeenCalled();
    expect(el("captchaToken").value).toBe("tok-1");
    expect(el("formStatus").textContent).not.toBe(WAITING);
  });
});
