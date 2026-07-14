// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-225: gift-aid.html's token-scoped declaration form posts natively to
// /api/gift-aid/:token (novalidate, no fetch). initGiftAidForm gates that native submit
// through the shared highlight-all helper: an invalid form is blocked and every missing
// field flagged at once; a valid form submits unchanged. The overseas-postcode toggle is
// owned by initDeclarationCapture on the same .give-declaration fieldset.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { initGiftAidForm, initDeclarationCapture } = require(resolve(ROOT, "assets/js/main.js"));
const html = readFileSync(resolve(ROOT, "gift-aid.html"), "utf8");
const doc0 = new DOMParser().parseFromString(html, "text/html");
const panelHtml = doc0.querySelector(".giftaid-panel")?.outerHTML ?? "";

const set = (id: string, v: string) => {
  (document.getElementById(id) as HTMLInputElement).value = v;
};
const inv = (id: string) => document.getElementById(id)?.getAttribute("aria-invalid");
const fireSubmit = () => {
  const ev = new Event("submit", { bubbles: true, cancelable: true });
  document.querySelector("form.giftaid-form")!.dispatchEvent(ev);
  return ev;
};

beforeEach(() => {
  document.body.innerHTML = `<main>${panelHtml}</main>`;
  initDeclarationCapture(document);
  initGiftAidForm(document);
});

describe("gift aid completion form validation (TASK-225)", () => {
  it("exports initGiftAidForm and mounts the declaration form", () => {
    expect(typeof initGiftAidForm).toBe("function");
    expect(document.querySelector("form.giftaid-form")).not.toBeNull();
  });

  // TASK-226: the first name + last name pair sits side by side at half width in the shared
  // .give-name-row wrapper (matching the donate donor name), each keeping its own .give-field.
  it("lays first name and last name side by side in one shared .give-name-row wrapper", () => {
    const row = doc0.querySelector("form.giftaid-form .give-name-row");
    expect(row).not.toBeNull();
    expect(row?.querySelector("#declFirstName")?.closest(".give-field")).not.toBeNull();
    expect(row?.querySelector("#declLastName")?.closest(".give-field")).not.toBeNull();
  });

  it("blocks the native submit and flags every missing field at once, with a role=alert summary", () => {
    const ev = fireSubmit();
    expect(ev.defaultPrevented).toBe(true);
    for (const id of ["declFirstName", "declLastName", "declHouse", "declAddress", "declPostcode"]) {
      expect(inv(id), `#${id} should be flagged`).toBe("true");
    }
    const summary = document.querySelector("form.giftaid-form [role='alert']") as HTMLElement | null;
    expect(summary).not.toBeNull();
    expect(summary?.hidden).toBe(false);
    expect((summary?.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("allows the native submit once every required field is valid", () => {
    set("declFirstName", "Ada");
    set("declLastName", "Lovelace");
    set("declHouse", "12");
    set("declAddress", "Rose Cottage, Annbank");
    set("declPostcode", "KA1 1AA");
    const ev = fireSubmit();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("does not require the postcode for an overseas donor (no UK postcode ticked)", () => {
    set("declFirstName", "Ada");
    set("declLastName", "Lovelace");
    set("declHouse", "12");
    set("declAddress", "Rose Cottage, Jersey");
    const nonUk = document.getElementById("declNonUk") as HTMLInputElement;
    nonUk.checked = true;
    nonUk.dispatchEvent(new Event("change", { bubbles: true }));
    const ev = fireSubmit();
    expect(ev.defaultPrevented).toBe(false);
  });
});
