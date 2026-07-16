// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-261: the footer "keep in touch" signup — injected by main.js into the shared footer, so ONE
// implementation covers every page. What must hold:
//   - the consent checkbox starts UNTICKED and gates the submit (PECR: a positive action, never a
//     pre-tick);
//   - the payload that leaves the browser is exactly what the server's schema expects;
//   - the honeypot exists, is hidden from assistive tech, and rides along in the payload;
//   - success replaces the form (no double-submits), failure re-enables it.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const { initFooterSignup } = require(resolve(ROOT, "assets/js/main.js"));

const el = (id: string) => document.getElementById(id) as HTMLElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(fetchImpl: unknown) {
  document.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
  const win = { fetch: fetchImpl } as unknown as Window;
  initFooterSignup(document, win);
  return win;
}

function fill(consent: boolean) {
  (el("fsName") as HTMLInputElement).value = "Ann Volunteer";
  (el("fsEmail") as HTMLInputElement).value = "ann@example.com";
  (el("fsConsent") as HTMLInputElement).checked = consent;
}

const submit = () =>
  el("footSignupForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("footer signup (TASK-261)", () => {
  it("renders into the shared footer, once — a second init cannot duplicate it", () => {
    mount(vi.fn());
    initFooterSignup(document, { fetch: vi.fn() } as unknown as Window);
    expect(document.querySelectorAll("#footSignup")).toHaveLength(1);
    expect(document.querySelector(".site-footer #footSignup")).toBeTruthy();
  });

  it("starts with the consent box UNTICKED — consent is an action, never a default", () => {
    mount(vi.fn());
    expect((el("fsConsent") as HTMLInputElement).checked).toBe(false);
  });

  it("carries a honeypot that people never meet: hidden from assistive tech and the tab order", () => {
    mount(vi.fn());
    const trap = el("fsWebsite");
    expect(trap.getAttribute("aria-hidden")).toBe("true");
    expect(trap.getAttribute("tabindex")).toBe("-1");
  });

  it("refuses to submit without the consent tick, saying why, and never calls the server", async () => {
    const fetchSpy = vi.fn();
    mount(fetchSpy);
    fill(false);
    submit();
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el("fsError").hidden).toBe(false);
    expect(el("fsError").textContent).toMatch(/tick the box/i);
  });

  it("posts exactly the payload the server's schema expects, then swaps to the thank-you", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }));
    mount(fetchSpy);
    fill(true);
    (el("fsPhone") as HTMLInputElement).value = "07000 000001";
    submit();
    await flush();
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/subscribe");
    expect(JSON.parse(init.body)).toEqual({
      name: "Ann Volunteer",
      email: "ann@example.com",
      phone: "07000 000001",
      consent: true,
    });
    expect(el("footSignupForm").hidden).toBe(true);
    expect(el("fsDone").hidden).toBe(false);
  });

  it("surfaces a server refusal and lets the visitor try again", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "Too many attempts. Please try again shortly." }) }),
    );
    mount(fetchSpy);
    fill(true);
    submit();
    await flush();
    await flush();
    expect(el("fsError").hidden).toBe(false);
    expect(el("fsError").textContent).toMatch(/too many attempts/i);
    expect((el("fsSubmit") as HTMLButtonElement).disabled).toBe(false);
  });
});
