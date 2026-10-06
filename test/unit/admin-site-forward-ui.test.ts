// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, roleToPermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-568: Admin > Site pages > Spare addresses can forward to an NBCC subdomain. In the admin's
// jsdom harness (admin.html's <body>, a fake fetch, app.js evaluated against it): the "Sends people
// to" list gains a last choice that shows a box to type the subdomain in, what is typed is what is
// sent, and the list marks the forwards that leave the main site. Every address here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const tokenFor = (role: string) =>
  signAdminSession({ sub: 3, email: role + "@nbcc", role, now: new Date(), secret: "s" }).token;

type Alias = { id: number; fromPath: string; toPath: string; createdBy: string; createdAt: string };
let role = "admin";
let perms: PermissionMap = {};
let aliases: Alias[] = [];
let posted: { from: string; to: string }[] = [];
let postAnswer: { status: number; body: unknown } = { status: 201, body: { ok: true } };

function respond(method: string, path: string, body?: string) {
  const j = (payload: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token: tokenFor(role), user: { email: role + "@nbcc", role } });
  if (path === "/api/admin/me") return j({ email: role + "@nbcc", permissions: perms });
  if (path === "/api/admin/site-pages") {
    return j({
      pages: [
        { path: "/donate", title: "Donate", ballGated: false, listedByDefault: true, listed: true, overridden: false },
        { path: "/about-us", title: "About us", ballGated: false, listedByDefault: true, listed: true, overridden: false },
      ],
      aliases,
      privatePages: [],
    });
  }
  if (path === "/api/admin/site-aliases" && method === "POST") {
    posted.push(JSON.parse(body || "{}"));
    return j(postAnswer.body, postAnswer.status);
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const toSelect = () => el("siteAliasTo") as HTMLSelectElement;
const hostWrap = () => el("siteAliasHostWrap");
const hostBox = () => el("siteAliasHost") as HTMLInputElement;

async function openSitePages() {
  (el("adminEmail") as HTMLInputElement).value = role + "@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="site"]') as HTMLElement).click();
  await settle();
}
function choose(value: string) {
  toSelect().value = value;
  toSelect().dispatchEvent(new Event("change", { bubbles: true }));
}
async function add(from: string) {
  (el("siteAliasFrom") as HTMLInputElement).value = from;
  el("siteAliasForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}

beforeEach(() => {
  role = "admin";
  perms = effectivePermissions({ role: "admin", permissions: null });
  aliases = [
    { id: 1, fromPath: "/give", toPath: "/donate", createdBy: "seed", createdAt: "2026-09-01T09:00:00Z" },
    { id: 2, fromPath: "/drop", toPath: "https://drop.nbcc.scot", createdBy: "seed", createdAt: "2026-10-06T09:00:00Z" },
  ];
  posted = [];
  postAnswer = { status: 201, body: { ok: true } };
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string; body?: string }) =>
    Promise.resolve(respond((init && init.method) || "GET", String(url).split("?")[0], init && init.body));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("spare addresses that forward to an NBCC subdomain (TASK-568)", () => {
  it("offers the site's pages first and a subdomain last, with its box hidden until chosen", async () => {
    await openSitePages();
    const options = Array.from(toSelect().options).map((o) => o.textContent);
    expect(options.slice(0, 2)).toEqual(["Donate (/donate)", "About us (/about-us)"]);
    expect(options[options.length - 1]).toMatch(/^An NBCC subdomain/);
    expect(hostWrap().hidden).toBe(true);
    expect(hostBox().required).toBe(false);
  });

  it("shows the box when the subdomain choice is picked, and hides it again for a page", async () => {
    await openSitePages();
    choose("subdomain");
    expect(hostWrap().hidden).toBe(false);
    expect(hostBox().required).toBe(true);
    choose("/donate");
    expect(hostWrap().hidden).toBe(true);
    expect(hostBox().required).toBe(false);
  });

  it("sends what was typed as the destination, then clears the form", async () => {
    await openSitePages();
    choose("subdomain");
    hostBox().value = "  parcels.nbcc.scot/in ";
    await add("/parcels");
    expect(posted).toEqual([{ from: "/parcels", to: "parcels.nbcc.scot/in" }]);
    expect(hostBox().value).toBe("");
    expect(el("siteStatus").textContent).toContain("works right away");
    expect(el("siteStatus").className).toBe("ty-status is-ok");
  });

  it("still sends a chosen page exactly as before", async () => {
    await openSitePages();
    choose("/about-us");
    await add("/who");
    expect(posted).toEqual([{ from: "/who", to: "/about-us" }]);
  });

  it("keeps what was typed and says why when the server refuses it", async () => {
    postAnswer = { status: 400, body: { error: "Type an NBCC subdomain, like drop.nbcc.scot. It must end in .nbcc.scot." } };
    await openSitePages();
    choose("subdomain");
    hostBox().value = "example.com";
    await add("/elsewhere");
    expect(el("siteStatus").textContent).toContain("must end in .nbcc.scot");
    // Since 1 September this line carried the class "err", which the public stylesheet hides
    // (.err{display:none}), so no refusal on this screen was ever seen. It takes the classes
    // .ty-status has.
    expect(el("siteStatus").className).toBe("ty-status is-error");
    const publicCss = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
    const errRule = publicCss.slice(publicCss.indexOf(".err{"), publicCss.indexOf("}", publicCss.indexOf(".err{")));
    expect(errRule).toContain("display:none");
    expect(hostBox().value).toBe("example.com");
    expect(hostWrap().hidden).toBe(false);
  });

  it("marks a forward to a subdomain in the list, and leaves a page forward plain", async () => {
    await openSitePages();
    const rows = Array.from(document.querySelectorAll("#siteAliasTable tbody tr")) as HTMLElement[];
    expect(rows).toHaveLength(2);
    const drop = rows.find((r) => r.textContent!.includes("/drop")) as HTMLElement;
    const give = rows.find((r) => r.textContent!.includes("/give")) as HTMLElement;
    expect(drop.textContent).toContain("drop.nbcc.scot");
    expect(drop.querySelector(".admin-pill")?.textContent).toBe("Subdomain");
    expect(give.querySelector(".admin-pill")).toBeNull();
  });

  // On a phone the list is labelled cards, as Donations and Stories are: four squeezed columns broke
  // "drop.nbcc.scot" and the word Subdomain in half. The labels ride on the cells; the stylesheet
  // turns the table into cards when its own box is narrow.
  it("labels every cell of the list, so it can be cards on a phone", async () => {
    await openSitePages();
    expect(el("siteAliasTable").classList.contains("sa-list")).toBe(true);
    const table = document.querySelector("#siteAliasTable table") as HTMLElement;
    expect(table.classList.contains("sa-table")).toBe(true);
    const first = Array.from(table.querySelectorAll("tbody tr")[0].children) as HTMLElement[];
    expect(first.map((c) => c.getAttribute("data-label"))).toEqual(["Spare address", "Sends people to", "Added by", ""]);
    const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
    expect(css).toContain(".sa-list{container:salist / inline-size}");
    const cards = css.slice(css.indexOf("@container salist (max-width:759px){"));
    expect(cards.startsWith("@container salist")).toBe(true);
    expect(cards.slice(0, 1200)).toContain(".sa-table td::before{content:attr(data-label)");
    // The pill is one word and never breaks; a long address may wrap inside its own box.
    expect(css).toContain(".sa-table .admin-pill{white-space:nowrap}");
    expect(css).toContain(".sa-to{overflow-wrap:anywhere}");
  });

  it("shows no form at all to someone who can only view Site pages", async () => {
    role = "viewer";
    perms = { ...roleToPermissions("viewer") };
    await openSitePages();
    expect(el("siteAliasForm").hidden).toBe(true);
  });
});
