// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-054 (REQ-038): donate.html's donor-type routing question inside the give
// widget. A labelled two-option control (individual vs business) at the top of
// .give-main, above the tiers and the Gift Aid callout, with helper text that a
// sole trader (and partners) is legally an individual and stays on the Gift Aid
// path while only an incorporated company (Ltd, PLC, LLP) takes the path with no
// Gift Aid, plus an optional business-name display field. Behaviour (initDonorType
// in main.js): choosing business hides + unticks the #giftAid callout and reveals
// the business-name field; individual restores the callout and hides the field.
// The business-name field is a Donors Page display label ONLY and never switches
// the Gift Aid path. startCheckout folds donorType (once the control is wired) and
// businessName (when filled) into the REQ-028 payload. Static markup is parsed with
// jsdom; behaviour runs against the real initDonorType/startCheckout/initCheckout
// from main.js, mirroring give-widget.test.ts / give-checkout.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("donor type control markup (REQ-038)", () => {
  const widget = doc.querySelector("section.give-widget");
  const donor = widget?.querySelector(".give-donor");

  it("renders the donor-type control in the give-card main column", () => {
    expect(donor).not.toBeNull();
    expect(doc.querySelector(".give-card .give-main .give-donor")).not.toBeNull();
  });

  it("places the control above the tiers and the Gift Aid callout", () => {
    const main = widget?.querySelector(".give-card .give-main");
    const donorEl = main?.querySelector(".give-donor");
    const tiersEl = main?.querySelector("#tiersOnce");
    const giftaidEl = main?.querySelector(".giftaid");
    // DOCUMENT_POSITION_FOLLOWING (4): the target comes after the donor control.
    expect(donorEl!.compareDocumentPosition(tiersEl!) & 4).toBeTruthy();
    expect(donorEl!.compareDocumentPosition(giftaidEl!) & 4).toBeTruthy();
  });

  it("is a fieldset whose legend poses the individual/business question (REQ-032)", () => {
    expect(donor?.tagName).toBe("FIELDSET");
    const legend = donor?.querySelector("legend");
    const text = norm(legend?.textContent).toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("individual");
    expect(text).toContain("business");
  });

  it("offers two native radios, defaulting to individual, each with a real <label for> (REQ-032)", () => {
    const radios = [...(donor?.querySelectorAll('input[type="radio"][name="donorType"]') ?? [])];
    expect(radios).toHaveLength(2);
    expect(radios.map((r) => r.getAttribute("value")).sort()).toEqual(["business", "individual"]);
    for (const r of radios) {
      const id = r.getAttribute("id");
      expect(id).toBeTruthy();
      const label = donor?.querySelector(`label[for="${id}"]`);
      expect(label).not.toBeNull();
      expect(norm(label?.textContent).length).toBeGreaterThan(0);
    }
    // Individual is the default (Gift Aid eligible path) so the page works without JS.
    expect(donor?.querySelector('input[value="individual"]')?.hasAttribute("checked")).toBe(true);
    expect(donor?.querySelector('input[value="business"]')?.hasAttribute("checked")).toBe(false);
  });

  it("explains a sole trader and partners stay on the Gift Aid path, only companies do not", () => {
    const help = norm(donor?.textContent).toLowerCase();
    expect(help).toContain("sole trader");
    expect(help).toContain("partner");
    expect(help).toContain("gift aid");
    // Names the incorporated company forms that take the no-Gift-Aid path.
    expect(help).toContain("ltd");
    expect(help).toContain("plc");
    expect(help).toContain("llp");
  });

  it("adds an optional business-name field as a real <label for> (REQ-032), starting hidden", () => {
    const input = donor?.querySelector("#businessName") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("text");
    expect(input?.hasAttribute("required")).toBe(false); // optional
    const label = donor?.querySelector('label[for="businessName"]');
    expect(label).not.toBeNull();
    expect(norm(label?.textContent).length).toBeGreaterThan(0);
    // Revealed only for business donors (initDonorType), so its wrapper ships hidden.
    const field = doc.getElementById("businessNameField");
    expect(field).not.toBeNull();
    expect(field?.hasAttribute("hidden")).toBe(true);
  });

  it("writes the donor-type copy without dashes (REQ-031)", () => {
    expect(norm(donor?.textContent)).not.toMatch(/[–—-]/);
  });

  it("collapses a [hidden] Gift Aid callout in CSS (so the flex box actually hides)", () => {
    expect(css).toMatch(/\.giftaid\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});

describe("donor type behaviour (jsdom)", () => {
  const { initDonorType, startCheckout, initCheckout } = require(resolve(ROOT, "assets/js/main.js"));
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  const giftAidRegion = () => document.querySelector(".giftaid") as HTMLElement;
  const giftAidBox = () => document.getElementById("giftAid") as HTMLInputElement;
  const businessField = () => document.getElementById("businessNameField") as HTMLElement;
  const businessInput = () => document.getElementById("businessName") as HTMLInputElement;
  const selectDonor = (value: string) =>
    (document.querySelector(`input[name="donorType"][value="${value}"]`) as HTMLElement).click();

  const onceTier = (i: number) => document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;
  const monthlyTier = (i: number) =>
    document.querySelectorAll("#tiersMonthly .give-tier")[i] as HTMLElement;

  let alerts: string[];
  const lastPayload = () => {
    const a = alerts[alerts.length - 1];
    return JSON.parse(a.slice(a.indexOf("{")));
  };

  beforeEach(() => {
    document.body.innerHTML = `<main>${cardHtml}</main>`;
    alerts = [];
    window.alert = (m?: string) => {
      alerts.push(String(m));
    };
    // Preview behaviour: no backend wired, so the payload is shown (REQ-029).
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initDonorType(document);
    initCheckout(document, window);
  });

  it("exports initDonorType from the shared script", () => {
    expect(typeof initDonorType).toBe("function");
  });

  it("starts on individual: Gift Aid shown, business-name field hidden", () => {
    expect(giftAidRegion().hidden).toBe(false);
    expect(businessField().hidden).toBe(true);
  });

  it("choosing business hides and unticks the Gift Aid callout and reveals the business field", () => {
    giftAidBox().checked = true; // the donor had opted into Gift Aid as an individual
    selectDonor("business");
    expect(giftAidRegion().hidden).toBe(true);
    expect(giftAidBox().checked).toBe(false);
    expect(businessField().hidden).toBe(false);
  });

  it("choosing individual again restores the Gift Aid callout and hides the business field", () => {
    selectDonor("business");
    selectDonor("individual");
    expect(giftAidRegion().hidden).toBe(false);
    expect(businessField().hidden).toBe(true);
  });

  it("the optional business-name field never switches the Gift Aid path", () => {
    // Filling a business name while still an individual must not touch Gift Aid.
    businessInput().value = "Acme Ltd";
    businessInput().dispatchEvent(new Event("input", { bubbles: true }));
    expect(giftAidRegion().hidden).toBe(false);
    // And the individual can still opt into Gift Aid regardless of the field.
    giftAidBox().checked = true;
    expect(giftAidRegion().hidden).toBe(false);
    expect(giftAidBox().checked).toBe(true);
  });

  it("folds donorType into the checkout payload, individual by default", () => {
    monthlyTier(2).click(); // gold £50
    expect(lastPayload()).toEqual({
      mode: "monthly",
      plan: "gold",
      amount: 5000,
      giftAid: false,
      donorType: "individual",
    });
  });

  it("carries donorType=business and the businessName when a business donor fills it", () => {
    selectDonor("business");
    businessInput().value = "Acme Ltd";
    onceTier(0).click(); // £10 one-off
    // The default business sub-type is company, so the payload also folds the REQ-038
    // company object with giftAid:false (covered precisely in give-company-capture.test.ts);
    // here we assert the donor-type routing carries donorType + businessName.
    expect(lastPayload()).toMatchObject({
      mode: "once",
      plan: null,
      amount: 1000,
      giftAid: false,
      donorType: "business",
      businessName: "Acme Ltd",
    });
  });

  it("omits businessName from the payload when the field is empty", () => {
    selectDonor("business");
    onceTier(0).click();
    const p = lastPayload();
    expect(p.donorType).toBe("business");
    expect("businessName" in p).toBe(false);
  });

  it("startCheckout returns the assembled payload including donorType", () => {
    const payload = startCheckout(monthlyTier(0), window); // bronze £10
    expect(payload).toEqual({
      mode: "monthly",
      plan: "bronze",
      amount: 1000,
      giftAid: false,
      donorType: "individual",
    });
  });
});
