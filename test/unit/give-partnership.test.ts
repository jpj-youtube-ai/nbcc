// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-080 (REQ-051): the partnership donor path in the give widget. Choosing "A business"
// asks whether it is an incorporated company (no Gift Aid) or a business partnership
// (partners are individuals in law, so Gift Aid stays). The partnership path reveals a
// repeatable .give-partners fieldset — one Gift Aid declaration per partner (the same
// declaration fields as .give-declaration plus a required share amount) — and hides the
// single-declaration fieldset. Behaviour (initDonorType + initPartnershipCapture in
// main.js): the sub-type radios drive the path; add/remove partner rows; startCheckout
// folds a `partners: [{...declaration fields, sharePence}]` array into the REQ-028 payload
// (instead of a single `declaration`) when the partnership path is chosen and #giftAid is
// checked. Static markup is parsed with jsdom; behaviour runs against the real main.js,
// mirroring give-donor-type / declaration-capture.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("partnership markup (REQ-051)", () => {
  const widget = doc.querySelector("section.give-widget");
  const donor = widget?.querySelector(".give-donor");
  const partners = widget?.querySelector(".give-partners");

  it("adds a business sub-type control (company vs partnership) with real labels (REQ-032), shipped hidden", () => {
    const radios = [
      ...(donor?.querySelectorAll('input[type="radio"][name="businessType"]') ?? []),
    ] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios.map((r) => r.getAttribute("value")).sort()).toEqual(["company", "partnership"]);
    for (const r of radios) {
      const id = r.getAttribute("id");
      expect(id, "sub-type radio has an id").toBeTruthy();
      const label = donor?.querySelector(`label[for="${id}"]`);
      expect(label, `label for #${id}`).not.toBeNull();
      expect(norm(label?.textContent).length).toBeGreaterThan(0);
    }
    // Only relevant once "A business" is chosen, so its wrapper ships hidden.
    const field = doc.getElementById("businessTypeField");
    expect(field).not.toBeNull();
    expect(field?.hasAttribute("hidden")).toBe(true);
  });

  it("renders a .give-partners fieldset with a legend in the give-card main column, shipped hidden", () => {
    expect(partners).not.toBeNull();
    expect(doc.querySelector(".give-card .give-main .give-partners")).not.toBeNull();
    expect(partners?.tagName).toBe("FIELDSET");
    expect(norm(partners?.querySelector("legend")?.textContent).length).toBeGreaterThan(0);
    expect(partners?.hasAttribute("hidden")).toBe(true);
  });

  it("provides an add-partner button and an empty partners list container", () => {
    expect(doc.getElementById("addPartner")).not.toBeNull();
    expect(doc.getElementById("partnersList")).not.toBeNull();
  });

  it("carries a partner-row template capturing the declaration fields plus a share, each with a label", () => {
    const tpl = doc.getElementById("partnerRowTemplate") as HTMLTemplateElement | null;
    expect(tpl).not.toBeNull();
    const content = tpl!.content;
    // The declaration fields (mirroring .give-declaration) plus a required share.
    for (const field of ["title", "firstName", "lastName", "houseNameNumber", "address", "postcode", "nonUk", "share"]) {
      const input = content.querySelector(`[data-field="${field}"]`);
      expect(input, `template has a ${field} input`).not.toBeNull();
    }
    // Every input in the template is paired with a <label for> its placeholder id.
    for (const input of [...content.querySelectorAll("input")]) {
      const id = input.getAttribute("id");
      expect(id, "template input has an id placeholder").toBeTruthy();
      expect(content.querySelector(`label[for="${id}"]`), `template label for ${id}`).not.toBeNull();
    }
    // The share is required (REQ-051 needs a share per partner).
    expect(content.querySelector('[data-field="share"]')?.hasAttribute("required")).toBe(true);
  });

  it("writes the partnership copy without dashes (REQ-031)", () => {
    expect(norm(partners?.textContent)).not.toMatch(/[–—-]/);
  });
});

describe("partnership behaviour (jsdom)", () => {
  const { initDonorType, initPartnershipCapture, initDeclarationCapture, initCheckout } = require(
    resolve(ROOT, "assets/js/main.js"),
  );
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  const giftAidRegion = () => document.querySelector(".giftaid") as HTMLElement;
  const giftAidBox = () => document.getElementById("giftAid") as HTMLInputElement;
  const declaration = () => document.querySelector(".give-declaration") as HTMLElement;
  const partners = () => document.querySelector(".give-partners") as HTMLElement;
  const businessTypeField = () => document.getElementById("businessTypeField") as HTMLElement;
  const partnerRows = () => [...document.querySelectorAll(".give-partner")] as HTMLElement[];

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
    initPartnershipCapture(document);
    initDeclarationCapture(document);
    initDonorType(document);
    initCheckout(document, window);
  });

  it("exports initPartnershipCapture from the shared script", () => {
    expect(typeof initPartnershipCapture).toBe("function");
  });

  it("keeps the sub-type control hidden for an individual and reveals it for a business", () => {
    expect(businessTypeField().hidden).toBe(true);
    selectDonor("business");
    expect(businessTypeField().hidden).toBe(false);
  });

  it("the partnership path reveals the partners fieldset, hides the single declaration, and keeps Gift Aid", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    expect(partners().hidden).toBe(false);
    expect(declaration().hidden).toBe(true);
    // Partners are individuals in law, so Gift Aid stays available.
    expect(giftAidRegion().hidden).toBe(false);
  });

  it("the company path hides Gift Aid and the partners fieldset", () => {
    selectDonor("business");
    selectBusinessType("company");
    expect(giftAidRegion().hidden).toBe(true);
    expect(partners().hidden).toBe(true);
  });

  it("starts the partnership with one partner row and adds and removes rows", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    expect(partnerRows()).toHaveLength(1);
    (document.getElementById("addPartner") as HTMLElement).click();
    expect(partnerRows()).toHaveLength(2);
    // Remove the second row.
    (partnerRows()[1].querySelector("[data-remove-partner]") as HTMLElement).click();
    expect(partnerRows()).toHaveLength(1);
  });

  it("gives every partner-row field a matching <label for> with a unique id (REQ-032)", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    (document.getElementById("addPartner") as HTMLElement).click();
    const seen = new Set<string>();
    for (const row of partnerRows()) {
      for (const input of [...row.querySelectorAll("input")] as HTMLInputElement[]) {
        const id = input.getAttribute("id")!;
        expect(id, "row input has an id").toBeTruthy();
        expect(seen.has(id), `id ${id} is unique across rows`).toBe(false);
        seen.add(id);
        expect(row.querySelector(`label[for="${id}"]`), `label for ${id}`).not.toBeNull();
      }
    }
  });

  const fillPartner = (row: HTMLElement, fields: Record<string, string>, sharePounds: string) => {
    const set = (name: string, val: string) => {
      const el = row.querySelector(`[data-field="${name}"]`) as HTMLInputElement;
      el.value = val;
    };
    set("firstName", fields.firstName);
    set("lastName", fields.lastName);
    set("houseNameNumber", fields.house);
    set("address", fields.address);
    set("postcode", fields.postcode);
    set("share", sharePounds);
  };

  it("folds a partners array into the payload whose sharePence values sum to the amount, and drops the single declaration", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    giftAidBox().checked = true;
    (document.getElementById("addPartner") as HTMLElement).click();
    const rows = partnerRows();
    // £10 one-off = 1000 pence; split £6 + £4.
    fillPartner(rows[0], { firstName: "Ada", lastName: "Lovelace", house: "12", address: "Analytical Ave", postcode: "SW1A 1AA" }, "6");
    fillPartner(rows[1], { firstName: "Grace", lastName: "Hopper", house: "7", address: "Navy Yard", postcode: "M1 1AE" }, "4");
    onceTier(0).click(); // £10

    const payload = lastPayload();
    expect(payload.amount).toBe(1000);
    expect(Array.isArray(payload.partners)).toBe(true);
    expect(payload.partners).toHaveLength(2);
    const sum = payload.partners.reduce((a: number, p: { sharePence: number }) => a + p.sharePence, 0);
    expect(sum).toBe(payload.amount);
    expect(payload.partners[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      houseNameNumber: "12",
      address: "Analytical Ave",
      postcode: "SW1A 1AA",
      nonUk: false,
      sharePence: 600,
    });
    // The partnership path uses partners, not the single declaration object.
    expect("declaration" in payload).toBe(false);
  });

  it("omits partners when the partnership donor has not opted into Gift Aid", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    giftAidBox().checked = false;
    onceTier(0).click();
    expect("partners" in lastPayload()).toBe(false);
  });

  it("a non-UK partner omits the postcode from its payload entry", () => {
    selectDonor("business");
    selectBusinessType("partnership");
    giftAidBox().checked = true;
    const row = partnerRows()[0];
    fillPartner(row, { firstName: "Jean", lastName: "Le Maistre", house: "La Rue", address: "St Helier, Jersey", postcode: "" }, "10");
    (row.querySelector('[data-field="nonUk"]') as HTMLElement).click();
    onceTier(0).click();
    const p = lastPayload().partners[0];
    expect(p.nonUk).toBe(true);
    expect("postcode" in p).toBe(false);
  });

  it("leaves the individual path on the single declaration, with no partners", () => {
    giftAidBox().checked = true;
    document.getElementById("declFirstName")!.setAttribute("value", "Ada");
    (document.getElementById("declFirstName") as HTMLInputElement).value = "Ada";
    (document.getElementById("declLastName") as HTMLInputElement).value = "Lovelace";
    (document.getElementById("declHouse") as HTMLInputElement).value = "12";
    (document.getElementById("declAddress") as HTMLInputElement).value = "Analytical Ave";
    (document.getElementById("declPostcode") as HTMLInputElement).value = "SW1A 1AA";
    onceTier(0).click();
    const payload = lastPayload();
    expect("partners" in payload).toBe(false);
    expect(payload.declaration).toBeTruthy();
  });
});
