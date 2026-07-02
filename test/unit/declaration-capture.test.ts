// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-062 (REQ-043): the Gift Aid declaration capture fields in the give widget.
// Below the Gift Aid callout, a .give-declaration fieldset captures the HMRC
// declaration (title optional; first name, last name, house name/number, home address
// and postcode) with a non-UK donor checkbox (Channel Islands / Isle of Man) that
// hides, disables and un-requires the postcode. Behaviour (initDeclarationCapture in
// main.js): marks the fieldset data-ready, toggles the postcode on the non-UK box, and
// startCheckout folds a `declaration` object into the REQ-028 payload ONLY when #giftAid
// is checked (mirroring how initDonorType folds donorType). Static markup is parsed with
// jsdom; behaviour runs against the real main.js, mirroring give-contact-capture /
// give-donor-type.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("Gift Aid declaration capture markup (REQ-043)", () => {
  const widget = doc.querySelector("section.give-widget");
  const decl = widget?.querySelector(".give-declaration");

  it("renders the declaration fieldset with a legend in the give-card main column", () => {
    expect(decl).not.toBeNull();
    expect(doc.querySelector(".give-card .give-main .give-declaration")).not.toBeNull();
    expect(decl?.tagName).toBe("FIELDSET");
    expect(norm(decl?.querySelector("legend")?.textContent).length).toBeGreaterThan(0);
  });

  it("offers an OPTIONAL title field with a real <label for>, not required", () => {
    const input = decl?.querySelector("#declTitle") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("name")).toBe("title");
    expect(input?.hasAttribute("required")).toBe(false);
    expect(decl?.querySelector('label[for="declTitle"]')).not.toBeNull();
  });

  it("marks first name, last name and house name/number REQUIRED with required + aria-required and real labels (REQ-032)", () => {
    const required: [string, string][] = [
      ["declFirstName", "firstName"],
      ["declLastName", "lastName"],
      ["declHouse", "houseNameNumber"],
    ];
    for (const [id, name] of required) {
      const input = decl?.querySelector(`#${id}`) as HTMLInputElement | null;
      expect(input, `#${id} present`).not.toBeNull();
      expect(input?.getAttribute("name")).toBe(name);
      expect(input?.hasAttribute("required"), `#${id} required`).toBe(true);
      expect(input?.getAttribute("aria-required"), `#${id} aria-required`).toBe("true");
      const label = decl?.querySelector(`label[for="${id}"]`);
      expect(label, `label for #${id}`).not.toBeNull();
      expect(norm(label?.textContent).length).toBeGreaterThan(0);
    }
  });

  it("captures a single home address field with a real <label for>", () => {
    const input = decl?.querySelector("#declAddress") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("name")).toBe("address");
    expect(decl?.querySelector('label[for="declAddress"]')).not.toBeNull();
    // Exactly one address input in the fieldset (no work / c-o address).
    expect(decl?.querySelectorAll('input[name="address"]').length).toBe(1);
  });

  it("ships the postcode required (with aria-required) and a real <label for>, in a toggleable wrapper", () => {
    const input = decl?.querySelector("#declPostcode") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("name")).toBe("postcode");
    expect(input?.hasAttribute("required")).toBe(true);
    expect(input?.getAttribute("aria-required")).toBe("true");
    expect(decl?.querySelector('label[for="declPostcode"]')).not.toBeNull();
    expect(doc.getElementById("declPostcodeField")).not.toBeNull();
  });

  it("offers a non-UK donor checkbox with a real <label for>", () => {
    const box = decl?.querySelector("#declNonUk") as HTMLInputElement | null;
    expect(box).not.toBeNull();
    expect(box?.getAttribute("type")).toBe("checkbox");
    expect(box?.getAttribute("name")).toBe("nonUk");
    expect(decl?.querySelector('label[for="declNonUk"]')).not.toBeNull();
  });

  it("offers a declaration-scope radio pair keyed to the scope values, with real labels (REQ-032/REQ-044)", () => {
    const radios = [...(decl?.querySelectorAll('input[type="radio"][name="declScope"]') ?? [])] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios.map((r) => r.getAttribute("value")).sort()).toEqual(["all_donations", "this_donation"]);
    for (const r of radios) {
      const id = r.getAttribute("id");
      expect(id, "radio has an id").toBeTruthy();
      const label = decl?.querySelector(`label[for="${id}"]`);
      expect(label, `label for #${id}`).not.toBeNull();
      expect(norm(label?.textContent).length).toBeGreaterThan(0);
    }
    // Ships all_donations checked, matching the give-monthly default mode (works without JS).
    expect(decl?.querySelector('input[value="all_donations"]')?.hasAttribute("checked")).toBe(true);
    expect(decl?.querySelector('input[value="this_donation"]')?.hasAttribute("checked")).toBe(false);
  });

  it("writes the declaration copy without dashes (REQ-031)", () => {
    expect(norm(decl?.textContent)).not.toMatch(/[–—-]/);
  });
});

describe("Gift Aid declaration capture behaviour (jsdom)", () => {
  const { initDeclarationCapture, initCheckout } = require(resolve(ROOT, "assets/js/main.js"));
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  const onceTier = (i: number) =>
    document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;
  const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

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
    initDeclarationCapture(document);
    initCheckout(document, window);
  });

  it("exports initDeclarationCapture from the shared script", () => {
    expect(typeof initDeclarationCapture).toBe("function");
  });

  it("hides, disables and un-requires the postcode when non-UK is checked, and restores it when unchecked", () => {
    const field = document.getElementById("declPostcodeField") as HTMLElement;
    const input = byId("declPostcode");
    expect(field.hidden).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.hasAttribute("required")).toBe(true);

    byId("declNonUk").click();
    expect(field.hidden).toBe(true);
    expect(input.disabled).toBe(true);
    expect(input.hasAttribute("required")).toBe(false);

    byId("declNonUk").click();
    expect(field.hidden).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.hasAttribute("required")).toBe(true);
  });

  it("folds a declaration object with the captured fields into the payload when Gift Aid is checked", () => {
    byId("giftAid").checked = true;
    byId("declTitle").value = "Dr";
    byId("declFirstName").value = "Ada";
    byId("declLastName").value = "Lovelace";
    byId("declHouse").value = "12";
    byId("declAddress").value = "Analytical Avenue, London";
    byId("declPostcode").value = "SW1A 1AA";
    onceTier(0).click();
    expect(lastPayload().declaration).toEqual({
      title: "Dr",
      firstName: "Ada",
      lastName: "Lovelace",
      houseNameNumber: "12",
      address: "Analytical Avenue, London",
      postcode: "SW1A 1AA",
      nonUk: false,
      scope: "all_donations", // the give-monthly default (REQ-044/TASK-064)
    });
  });

  it("omits the declaration object entirely when Gift Aid is not checked", () => {
    byId("declFirstName").value = "Ada";
    onceTier(0).click();
    expect("declaration" in lastPayload()).toBe(false);
  });

  it("marks a non-UK declaration and omits the postcode from the payload", () => {
    byId("giftAid").checked = true;
    byId("declFirstName").value = "Jean";
    byId("declLastName").value = "Le Maistre";
    byId("declHouse").value = "La Rue";
    byId("declAddress").value = "St Helier, Jersey";
    byId("declNonUk").click();
    onceTier(0).click();
    const d = lastPayload().declaration;
    expect(d.nonUk).toBe(true);
    expect("postcode" in d).toBe(false);
    expect(d.firstName).toBe("Jean");
  });

  it("omits an empty optional title from the declaration", () => {
    byId("giftAid").checked = true;
    byId("declFirstName").value = "Ada";
    byId("declLastName").value = "Lovelace";
    byId("declHouse").value = "12";
    byId("declAddress").value = "Analytical Avenue";
    byId("declPostcode").value = "SW1A 1AA";
    onceTier(0).click();
    expect("title" in lastPayload().declaration).toBe(false);
  });
});

describe("Gift Aid declaration scope (REQ-044 / TASK-064)", () => {
  const { initGiveToggle, initDeclarationCapture, initCheckout } = require(
    resolve(ROOT, "assets/js/main.js"),
  );
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  const scopeChecked = () =>
    (document.querySelector('input[name="declScope"]:checked') as HTMLInputElement | null)?.value;
  const clickMode = (id: string) => (document.getElementById(id) as HTMLElement).click();
  const onceTier = (i: number) =>
    document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;
  const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

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
    initGiveToggle(document);
    initDeclarationCapture(document);
    initCheckout(document, window);
  });

  it("defaults the scope to all_donations in give-monthly mode (the default)", () => {
    expect(scopeChecked()).toBe("all_donations");
  });

  it("re-syncs the scope default to this_donation for give once and back to all_donations for give monthly", () => {
    clickMode("giveOnce");
    expect(scopeChecked()).toBe("this_donation");
    clickMode("giveMonthly");
    expect(scopeChecked()).toBe("all_donations");
  });

  it("stops re-syncing once the donor picks a scope (sticky through later mode switches)", () => {
    byId("declScopeThis").click(); // donor overrides to this_donation while in monthly mode
    expect(scopeChecked()).toBe("this_donation");
    clickMode("giveOnce");
    expect(scopeChecked()).toBe("this_donation");
    clickMode("giveMonthly");
    expect(scopeChecked()).toBe("this_donation"); // stays on the donor's choice
  });

  it("folds the selected scope into the declaration payload when Gift Aid is checked", () => {
    clickMode("giveOnce"); // give-mode once → scope this_donation
    byId("giftAid").checked = true;
    byId("declFirstName").value = "Ada";
    byId("declLastName").value = "Lovelace";
    byId("declHouse").value = "12";
    byId("declAddress").value = "Analytical Avenue";
    byId("declPostcode").value = "SW1A 1AA";
    onceTier(0).click();
    expect(lastPayload().declaration.scope).toBe("this_donation");
  });
});
