// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-084 (REQ-038): the company-specific field capture in the give widget. On the
// incorporated-company path (donorType business + businessType company) a .give-company
// fieldset captures an optional registration number plus a required contact name/email and
// billing address/postcode. Behaviour (initDonorType in main.js): the fieldset shows ONLY on
// the company path (its inputs disabled otherwise), the Gift Aid callout stays hidden, and
// startCheckout folds a `company` object into the REQ-028 payload with giftAid:false. Static
// markup is parsed with jsdom; behaviour runs against the real main.js, mirroring
// give-donor-type / give-partnership.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("company capture markup (REQ-038)", () => {
  const widget = doc.querySelector("section.give-widget");
  const company = widget?.querySelector(".give-company");

  it("renders a .give-company fieldset with a legend in the give-card main column, shipped hidden", () => {
    expect(company).not.toBeNull();
    expect(doc.querySelector(".give-card .give-main .give-company")).not.toBeNull();
    expect(company?.tagName).toBe("FIELDSET");
    expect(norm(company?.querySelector("legend")?.textContent).length).toBeGreaterThan(0);
    expect(company?.hasAttribute("hidden")).toBe(true);
  });

  it("captures the five company fields, each with a real <label for> (REQ-032)", () => {
    for (const id of [
      "companyRegNumber",
      "companyContactName",
      "companyContactEmail",
      "companyBillingAddress",
      "companyBillingPostcode",
    ]) {
      const input = company?.querySelector(`#${id}`) as HTMLInputElement | null;
      expect(input, `#${id} present`).not.toBeNull();
      const label = company?.querySelector(`label[for="${id}"]`);
      expect(label, `label for #${id}`).not.toBeNull();
      expect(norm(label?.textContent).length).toBeGreaterThan(0);
    }
  });

  it("marks the registration number OPTIONAL and the other four REQUIRED (required + aria-required)", () => {
    const reg = company?.querySelector("#companyRegNumber") as HTMLInputElement | null;
    expect(reg?.hasAttribute("required")).toBe(false);

    for (const id of ["companyContactName", "companyContactEmail", "companyBillingAddress", "companyBillingPostcode"]) {
      const input = company?.querySelector(`#${id}`) as HTMLInputElement | null;
      expect(input?.hasAttribute("required"), `#${id} required`).toBe(true);
      expect(input?.getAttribute("aria-required"), `#${id} aria-required`).toBe("true");
    }
    // The contact email is a real email input.
    expect((company?.querySelector("#companyContactEmail") as HTMLInputElement)?.getAttribute("type")).toBe("email");
  });

  it("writes the company copy without dashes (REQ-031)", () => {
    expect(norm(company?.textContent)).not.toMatch(/[–—-]/);
  });
});

describe("company capture behaviour (jsdom)", () => {
  const { initDonorType, initContactCapture, initCheckout } = require(resolve(ROOT, "assets/js/main.js"));
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  const giftAidRegion = () => document.querySelector(".giftaid") as HTMLElement;
  const giftAidBox = () => document.getElementById("giftAid") as HTMLInputElement;
  const company = () => document.querySelector(".give-company") as HTMLElement;
  const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

  const selectDonor = (value: string) =>
    (document.querySelector(`input[name="donorType"][value="${value}"]`) as HTMLElement).click();
  const selectBusinessType = (value: string) =>
    (document.querySelector(`input[name="businessType"][value="${value}"]`) as HTMLElement).click();
  const onceTier = (i: number) => document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;

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
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initDonorType(document);
    initContactCapture(document);
    initCheckout(document, window);
  });

  const fillCompany = () => {
    byId("businessName").value = "Acme Ltd";
    byId("companyRegNumber").value = "SC123456";
    byId("companyContactName").value = "Ada Lovelace";
    byId("companyContactEmail").value = "finance@acme.test";
    byId("companyBillingAddress").value = "1 Office Park, London";
    byId("companyBillingPostcode").value = "SW1A 1AA";
  };

  it("keeps .give-company hidden and its inputs disabled for an individual", () => {
    expect(company().hidden).toBe(true);
    expect(byId("companyContactName").disabled).toBe(true);
  });

  it("reveals .give-company (inputs enabled) and hides Gift Aid on the company path", () => {
    selectDonor("business");
    selectBusinessType("company");
    expect(company().hidden).toBe(false);
    expect(byId("companyContactName").disabled).toBe(false);
    expect(giftAidRegion().hidden).toBe(true);
  });

  it("hides .give-company again (inputs disabled) on the partnership path", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    expect(company().hidden).toBe(true);
    expect(byId("companyContactName").disabled).toBe(true);
  });

  it("folds a company object with the captured values and giftAid:false into the payload", () => {
    selectDonor("business");
    selectBusinessType("company");
    giftAidBox().checked = true; // even if somehow ticked, the company path forces it false
    fillCompany();
    onceTier(0).click(); // £10
    const payload = lastPayload();
    expect(payload.giftAid).toBe(false);
    expect(payload.company).toEqual({
      legalName: "Acme Ltd",
      registrationNumber: "SC123456",
      contactName: "Ada Lovelace",
      contactEmail: "finance@acme.test",
      billingAddress: "1 Office Park, London",
      billingPostcode: "SW1A 1AA",
    });
    // A company makes no Gift Aid declaration.
    expect("declaration" in payload).toBe(false);
  });

  it("omits the company object on the individual path (unaffected)", () => {
    onceTier(0).click();
    expect("company" in lastPayload()).toBe(false);
  });

  it("omits the company object on the partnership path (unaffected)", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    onceTier(0).click();
    expect("company" in lastPayload()).toBe(false);
  });
});
