// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Head Elf HQ (assets/js/admin/elf-hq.js): the Elf Detective School's own admin section, against a
// pretend server. Design: docs/superpowers/specs/2026-11-05-elf-admin-design.md. Every family and
// detective here is invented.
const require = createRequire(import.meta.url);
const { initElfHq } = require(resolve(__dirname, "../../assets/js/admin/elf-hq.js"));

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const HQ = {
  settings: { schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewOn: false },
  canSwitch: true,
  numbers: { families: 0, detectives: 0, namesToCheck: 0, waitingPayments: 0, entryPence: 0, giftPence: 0, giftAidPence: 0 },
  quests: [],
  recruits: [],
  firstClueAt: "2026-12-01T17:30:00.000Z",
  daysToFirstClue: 26,
};

type Call = { method: string; url: string; body: unknown };

/** The admin page around the section, the pretend server, and Head Elf HQ started on it. */
function page(o: { answers?: Record<string, unknown>; status?: number; shown?: boolean } = {}) {
  document.body.innerHTML = `<div id="appView"><section class="admin-view" id="view-elf"${o.shown ? "" : " hidden"}><div id="elfHq"></div></section></div>`;
  const calls: Call[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const status = o.status ?? 200;
    const body = (o.answers ?? {})[url.split("?")[0]] ?? (status >= 400 ? { error: "Admin is temporarily unavailable" } : HQ);
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "t");
  const hq = initElfHq(document, window, { confirm: () => true });
  return { hq, calls };
}

const tabs = () => [...document.querySelectorAll<HTMLButtonElement>("#elfHq [role=tab]")];
const panel = (id: string) => document.querySelector<HTMLElement>(`#elfHq [role=tabpanel][data-tab="${id}"]`)!;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("Head Elf HQ's menu", () => {
  it("draws four tiles, with HQ open", () => {
    page();
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(["HQ", "Families", "Money", "Settings"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(panel("hq").hidden).toBe(false);
    for (const id of ["families", "money", "settings"]) expect(panel(id).hidden, id).toBe(true);
    expect(document.querySelector("#elfHq h1")!.textContent).toBe("Elf Detective School");
  });

  it("opens a tile's part, and remembers it for the browser tab", () => {
    page();
    tabs()[1].click();
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(panel("families").hidden).toBe(false);
    expect(panel("hq").hidden).toBe(true);
    expect(window.sessionStorage.getItem("nbcc_elf_hq_tab")).toBe("families");
    page();
    expect(panel("families").hidden).toBe(false);
  });

  it("reads HQ when the section is opened", async () => {
    const { hq, calls } = page();
    expect(calls).toHaveLength(0);
    await hq.open();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain("GET /api/admin/elf/hq");
  });

  it("reads HQ straight away when the section is already showing as it starts", async () => {
    const { calls } = page({ shown: true });
    await flush();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain("GET /api/admin/elf/hq");
  });

  it("says a failure in words, as an error", async () => {
    const { hq } = page({ status: 500 });
    await hq.open();
    const status = document.querySelector("#elfHq .hq-status")!;
    expect(status.textContent).toContain("Admin is temporarily unavailable");
    expect(status.classList.contains("is-error")).toBe(true);
  });
});
