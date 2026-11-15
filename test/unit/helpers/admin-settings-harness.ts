import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../../src/admin/permissions";

// The admin in jsdom, for the tests of Site pages, QR codes, Team, Manage access and My account
// (docs/superpowers/specs/2026-11-14-admin-refresh-settings.md): admin.html's <body>, the helpers and
// the kit as the page loads them, a fake fetch a test answers, and app.js run against it. The same
// harness as admin-app.test.ts, made once so five files do not each carry a copy. Every person,
// address and figure a test puts through it is invented.

const require = createRequire(import.meta.url);
export const ROOT = resolve(__dirname, "../../..");
export const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");
export const adminHtml = read("admin.html");
export const appSrc = read("assets/js/admin/app.js");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (adminHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

export type Reply = { status?: number; body?: unknown; blob?: Blob };
export type Call = { method: string; path: string; url: string; body: unknown };
/** A test's answers: return nothing to get the empty, harmless answer a quiet list gives. */
export type Route = (call: Call) => Reply | undefined | void;

export type Who = {
  sub?: number;
  email?: string;
  role?: string;
  fullName?: string;
  /** Saved access of their own; left out, they have their role's usual access, as on the server. */
  permissions?: PermissionMap | null;
};

export type Admin = {
  calls: Call[];
  signIn: () => Promise<void>;
  open: (view: string) => Promise<void>;
  settle: (turns?: number) => Promise<void>;
};

const flush = () => new Promise((r) => setTimeout(r, 0));
export const settle = async (turns = 8) => {
  for (let i = 0; i < turns; i++) await flush();
};
export const el = (id: string) => document.getElementById(id) as HTMLElement;
export const q = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement | null;
export const qa = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as HTMLElement[];
export const text = (node: Element | null | undefined) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
export const press = (node: Element | null | undefined) => {
  if (!node) throw new Error("nothing to press");
  (node as HTMLElement).click();
};
export const type = (node: Element | null | undefined, value: string) => {
  if (!node) throw new Error("nothing to type into");
  (node as HTMLInputElement).value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
};
export const choose = (node: Element | null | undefined, value: string) => {
  if (!node) throw new Error("nothing to choose from");
  (node as HTMLSelectElement).value = value;
  node.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Puts the admin on the page, signed out, with `route` answering its requests as `who`. */
export function mountAdmin(who: Who, route: Route): Admin {
  const me = { sub: 3, email: "fern@example.com", role: "admin", fullName: "Fern Example", permissions: null, ...who };
  const calls: Call[] = [];
  const token = signAdminSession({ sub: me.sub, email: me.email, role: me.role, now: new Date(), secret: "s" }).token;

  function respond(url: string, init?: { method?: string; body?: string }) {
    const method = (init?.method || "GET").toUpperCase();
    const path = url.split("?")[0];
    let body: unknown = undefined;
    try {
      body = init?.body ? JSON.parse(init.body) : undefined;
    } catch {
      body = init?.body;
    }
    const call = { method, path, url, body };
    calls.push(call);
    let reply: Reply | undefined | void;
    if (path === "/api/admin/login") reply = { body: { token, user: { email: me.email, role: me.role } } };
    else reply = route(call);
    if (!reply && path === "/api/admin/me" && method === "GET") {
      reply = { body: { email: me.email, fullName: me.fullName, permissions: effectivePermissions({ role: me.role, permissions: me.permissions }) } };
    }
    if (!reply && path === "/api/admin/whats-new") reply = { body: { areas: [] } };
    if (!reply) reply = { body: { results: [] } };
    const status = reply.status ?? 200;
    const payload = reply.body;
    const blob = reply.blob;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(typeof payload === "string" ? payload : ""),
      blob: () => Promise.resolve(blob ?? new Blob(["x"])),
      headers: { get: () => "application/json" },
    };
  }

  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = Kit;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);

  return {
    calls,
    settle,
    async signIn() {
      (el("adminEmail") as HTMLInputElement).value = me.email;
      (el("adminPassword") as HTMLInputElement).value = "pw";
      el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
    },
    async open(view: string) {
      press(q('.admin-nav-link[data-view="' + view + '"]'));
      await settle();
    },
  };
}

/** The declarations of the rule that starts exactly `start` in a stylesheet with its comments removed. */
export function ruleIn(css: string, start: string): string {
  const at = css.indexOf(start);
  if (at < 0) throw new Error("no rule starting: " + start);
  return css.slice(at, css.indexOf("}", at));
}
