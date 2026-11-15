import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// The three Giving screens (Claims, GASDS, Subscriptions) as admin.html holds them, in jsdom, with
// assets/js/admin/giving.js run against a pretend server. Shared by the admin-giving-*.test.ts files.
// Nothing real is in here: every answer comes from the test that asks.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../../..");
export const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
export const Giving = require(resolve(ROOT, "assets/js/admin/giving.js"));

/** One screen of admin.html: from its own <section> to the next screen's. */
export function screenHtml(id: string): string {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return "";
  const start = html.lastIndexOf("<section", at);
  const next = html.indexOf('<section class="admin-view', at);
  const cut = html.slice(start, next < 0 ? html.length : next);
  return cut.slice(0, cut.lastIndexOf("</section>") + "</section>".length);
}

export type Call = { method: string; path: string; query: string; body: unknown };
export type Reply = { status?: number; body?: unknown; text?: string };
type Level = "none" | "view" | "edit";

export interface Screen {
  giving: { openClaims: () => void; openGasds: () => void; openSubs: () => void };
  calls: Call[];
  /** The calls that change something. */
  writes: () => Call[];
}

/**
 * Puts the three screens on the page and makes the Giving object, as app.js does. `replies` answers
 * each request; anything it leaves gets the { results: [] } an empty list answers with.
 */
export function givingScreen(
  replies: (call: Call) => Reply | undefined = () => undefined,
  perms: Record<string, Level> = { claims: "edit", gasds: "edit", subscriptions: "view", donations: "view" },
): Screen {
  document.body.innerHTML =
    '<div class="admin-content">' + ["view-claims", "view-gasds", "view-subscriptions"].map(screenHtml).join("") + "</div>";
  const win = window as unknown as Record<string, unknown>;
  win.AdminHelpers = helpers;
  win.AdminKit = Kit;
  // jsdom draws nothing, so it cannot scroll; the bar of parts asks it to.
  Element.prototype.scrollIntoView = function () {};
  const calls: Call[] = [];
  const rank: Record<Level, number> = { none: 0, view: 1, edit: 2 };
  const can = (section: string, level: Level) => rank[perms[section] || "none"] >= rank[level];
  const host = {
    authFetch(url: string, init: { method?: string; body?: string } = {}) {
      const [path, query = ""] = String(url).split("?");
      const call: Call = { method: (init.method || "GET").toUpperCase(), path, query, body: init.body ? JSON.parse(init.body) : null };
      calls.push(call);
      const reply = replies(call) || { body: { results: [] } };
      const status = reply.status ?? 200;
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () => (reply.body === undefined ? Promise.reject(new Error("not json")) : Promise.resolve(reply.body)),
        text: () => Promise.resolve(reply.text ?? ""),
      });
    },
    canView: (section: string) => can(section, "view"),
    canEdit: (section: string) => can(section, "edit"),
  };
  const giving = Giving.create(document, window, host);
  return { giving, calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

export const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};
export const el = (id: string) => document.getElementById(id) as HTMLElement;
export const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
export const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
export const text = (node: Element | null | undefined) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
export const press = async (node: Element | null) => {
  (node as HTMLElement).click();
  await settle();
};
