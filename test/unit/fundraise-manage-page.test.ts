// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-494: /fundraise/manage. Without a link token it asks for an email and sends a link. With
// one, it opens the organiser's editable fields, sends only what they changed, and says plainly
// that a change waits for staff before it shows. Links that have run out or match nothing lead
// back to asking for a new one. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
const template = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

type Reply = { status: number; body: unknown };
let calls: Array<{ url: string; method: string; body: unknown }>;

const editable = {
  description: "Five kilometres in a red suit.",
  targetPence: 25000,
  eventDate: "2026-12-05",
  startTime: "10:30",
  venue: "Example Park",
  town: "Exampleton",
  socialLink: null,
};
const opened = (over: Record<string, unknown> = {}) => ({
  fundraiser: { id: 7, slug: "robins-santa-dash", title: "Robin's Santa Dash", path: "raising", pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", editable },
  waitingEdit: null,
  ...over,
});

async function load(search: string, reply: (url: string, method: string) => Reply) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(template, "text/html").documentElement.innerHTML;
  calls = [];
  const win = {
    location: { search },
    NBCCFormValidation: { validateForm: shared.validateForm, clearValidation: shared.clearValidation },
    fetch: vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = reply(url, method);
      return Promise.resolve({ ok: r.status < 300, status: r.status, json: () => Promise.resolve(r.body) });
    }),
  };
  const out = initManage(document, win);
  await flush();
  return out;
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const type = (id: string, value: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = async (id: string) => {
  $(`#${id}`).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};

describe("without a link", () => {
  it("asks for an email and passes on the server's answer", async () => {
    await load("", () => ({ status: 200, body: { message: "If that email belongs to an approved fundraiser, we have sent a link." } }));
    expect($("[data-manage-request]").hidden).toBe(false);
    expect($("[data-manage-edit]").hidden).toBe(true);
    type("manageEmail", "robin@example.com");
    await submit("manageRequestForm");
    expect(calls).toEqual([{ url: "/api/fundraise/manage/request", method: "POST", body: { email: "robin@example.com" } }]);
    expect($("[data-request-status]").textContent).toBe("If that email belongs to an approved fundraiser, we have sent a link.");
  });

  it("checks the address before sending", async () => {
    await load("", () => ({ status: 200, body: {} }));
    type("manageEmail", "not an address");
    await submit("manageRequestForm");
    expect(calls).toHaveLength(0);
    expect($("#manageEmail").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("with a link", () => {
  it("opens the organiser's page details", async () => {
    await load("?token=tok123", () => ({ status: 200, body: opened() }));
    expect(calls[0]).toEqual({ url: "/api/fundraise/manage/tok123", method: "GET", body: undefined });
    expect($("[data-manage-request]").hidden).toBe(true);
    expect($("[data-manage-edit]").hidden).toBe(false);
    expect($("[data-manage-title]").textContent).toBe("Robin's Santa Dash");
    expect($<HTMLTextAreaElement>("#editDescription").value).toBe(editable.description);
    expect($<HTMLInputElement>("#editTarget").value).toBe("250");
    expect($<HTMLInputElement>("#editDate").value).toBe("2026-12-05");
    expect($("[data-manage-waiting]").hidden).toBe(true);
    expect($<HTMLAnchorElement>("[data-manage-page-url]").getAttribute("href")).toBe("https://nbcc.test/fundraise/robins-santa-dash");
  });

  it("has no target for an event", async () => {
    await load("?token=tok123", () => ({ status: 200, body: opened({ fundraiser: { ...opened().fundraiser, path: "event", pageUrl: null } }) }));
    expect($("[data-edit-target]").hidden).toBe(true);
    expect($("[data-manage-page-link]").hidden).toBe(true);
  });

  it("says a change is waiting, and shows it in the form", async () => {
    await load("?token=tok123", () => ({
      status: 200,
      body: opened({ waitingEdit: { id: 3, changes: { targetPence: 40000, town: "Otherton" }, createdAt: "2026-10-01T09:00:00.000Z" } }),
    }));
    expect($("[data-manage-waiting]").hidden).toBe(false);
    expect($("[data-manage-waiting]").textContent).toContain("waiting for us to check it");
    expect($("[data-waiting-when]").textContent).toBe("You sent it on 1 October 2026.");
    expect($<HTMLInputElement>("#editTarget").value).toBe("400");
    expect($<HTMLInputElement>("#editTown").value).toBe("Otherton");
  });

  it("sends only what changed, and then says it is waiting", async () => {
    await load("?token=tok123", (_url, method) =>
      method === "GET" ? { status: 200, body: opened() } : { status: 202, body: { status: "waiting", edit: { id: 4, changes: {}, createdAt: "2026-10-02T09:00:00.000Z" } } },
    );
    type("editTarget", "300");
    type("editSocial", "https://www.facebook.com/robins-dash");
    await submit("manageEditForm");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/fundraise/manage/tok123");
    expect(post.body).toEqual({ targetPence: 30000, socialLink: "https://www.facebook.com/robins-dash" });
    expect($("[data-manage-sent]").hidden).toBe(false);
    expect($("[data-manage-edit]").hidden).toBe(true);
  });

  it("clears a date or a target that is emptied", async () => {
    await load("?token=tok123", (_url, method) => (method === "GET" ? { status: 200, body: opened() } : { status: 202, body: { status: "waiting", edit: {} } }));
    type("editTarget", "");
    type("editDate", "");
    await submit("manageEditForm");
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ targetPence: null, eventDate: null });
  });

  it("sends nothing when nothing has changed, and says so", async () => {
    await load("?token=tok123", () => ({ status: 200, body: opened() }));
    await submit("manageEditForm");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect($("[data-edit-status]").textContent).toMatch(/not changed anything/);
  });

  it("puts the server's messages beside their fields", async () => {
    await load("?token=tok123", (_url, method) =>
      method === "GET" ? { status: 200, body: opened() } : { status: 400, body: { error: "Some of your changes need another look", fields: { targetPence: "A target can be up to £100,000." } } },
    );
    type("editTarget", "200000");
    await submit("manageEditForm");
    expect(document.getElementById("editTarget-error")?.textContent).toBe("A target can be up to £100,000.");
  });

  it("leads back to asking for a new link when it has run out", async () => {
    await load("?token=old", () => ({ status: 410, body: { error: "This link has run out. Ask for a new one: links work for 24 hours." } }));
    expect($("[data-manage-edit]").hidden).toBe(true);
    expect($("[data-manage-request]").hidden).toBe(false);
    expect($("[data-manage-problem]").hidden).toBe(false);
    expect($("[data-manage-problem]").textContent).toBe("This link has run out. Ask for a new one: links work for 24 hours.");
  });

  it("says a link that matches nothing does not work", async () => {
    await load("?token=nonsense", () => ({ status: 404, body: { error: "This link is not valid" } }));
    expect($("[data-manage-problem]").textContent).toBe("This link does not work. Ask for a new one below.");
  });

  it("asks only for a token that could be one", async () => {
    await load(`?token=${"x".repeat(300)}`, () => ({ status: 200, body: opened() }));
    expect(calls).toHaveLength(0);
    expect($("[data-manage-problem]").hidden).toBe(false);
  });
});
