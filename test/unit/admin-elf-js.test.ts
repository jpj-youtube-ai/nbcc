// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// NBCC Elf Detective School's admin screen (assets/js/admin/elf.js), against a pretend server.

const require = createRequire(import.meta.url);
const { initElfAdmin } = require(resolve(__dirname, "../../assets/js/admin/elf.js"));

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function load(settings = { schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 }) {
  document.body.innerHTML = `<section id="elfAdmin"><h3>Elf Detective School</h3><p id="elfAdminState"></p></section>`;
  const calls: { method: string; url: string; body: unknown }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    let body: unknown = { settings };
    if (url.endsWith("/signups")) body = { families: 2, detectives: 3, entryPence: 1500, donationPence: 500, giftAidPence: 500, recent: [{ reference: "EDS-K4F9Q2", grownUpName: "Sam Example", detectives: ["Ruby Tinselfoot"], paidAt: "2026-11-13T09:30:00.000Z" }] };
    if (method === "PATCH") body = { settings: { ...settings, ...(JSON.parse(String(init.body)) as object) } };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "t");
  const admin = initElfAdmin(document, window, { confirm: () => true });
  return { admin, calls };
}

describe("the admin's Elf Detective School card", () => {
  it("says it is switched off, the amounts, and the sign ups so far", async () => {
    const { admin } = load();
    await admin.load();
    await flush();
    const text = document.getElementById("elfAdmin")!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Switched off");
    expect(text).toContain("£1");
    expect(text).toContain("£5");
    expect(text).toContain("2 families");
    expect(text).toContain("3 detectives");
    expect(text).toContain("Sam Example");
    expect(document.querySelector("#elfAdmin .is-error")).toBeNull();
  });

  it("switches the school on after asking, and says so", async () => {
    const { admin, calls } = load();
    await admin.load();
    await flush();
    (document.querySelector("#elfAdminSwitch") as HTMLButtonElement).click();
    await flush();
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("/api/admin/elf/settings");
    expect(patch.body).toEqual({ schoolOn: true });
    expect(document.getElementById("elfAdmin")!.textContent).toContain("Switched on");
  });

  it("saves new amounts in pounds as pence", async () => {
    const { admin, calls } = load();
    await admin.load();
    await flush();
    (document.querySelector("#elfAdminFrom") as HTMLInputElement).value = "2";
    (document.querySelector("#elfAdminSuggested") as HTMLInputElement).value = "6.50";
    (document.querySelector("#elfAdminPrices") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ entryFromPence: 200, entrySuggestedPence: 650 });
  });
});
