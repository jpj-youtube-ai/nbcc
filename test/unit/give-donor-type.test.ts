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

  it("places the control above the Gift Aid callout in the details step (step 2)", () => {
    const main = widget?.querySelector(".give-card .give-main");
    const donorEl = main?.querySelector(".give-donor");
    const giftaidEl = main?.querySelector(".giftaid");
    // DOCUMENT_POSITION_FOLLOWING (4): the Gift Aid callout comes after donor-type,
    // so the individual/business choice that drives the Gift Aid path is asked first.
    expect(donorEl!.compareDocumentPosition(giftaidEl!) & 4).toBeTruthy();
    // Both share the "your details" wizard step (step 2); the amount tiers are the
    // earlier "your gift" step (step 1), so the routing question follows the amount.
    expect(donorEl?.closest('.give-step[data-step="2"]')).not.toBeNull();
    expect(giftaidEl?.closest('.give-step[data-step="2"]')).not.toBeNull();
    expect(main?.querySelector("#tiersOnce")?.closest('.give-step[data-step="1"]')).not.toBeNull();
  });

  it("is a fieldset whose legend poses the individual/business question (REQ-032)", () => {
    expect(donor?.tagName).toBe("FIELDSET");
    const legend = donor?.querySelector("legend");
    const text = norm(legend?.textContent).toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("individual");
    expect(text).toContain("business");
  });

  it("offers two native radios, NONE preselected, both required, each with a real <label for> (REQ-032, TASK-204)", () => {
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
    // TASK-204: nothing is preselected — the donor must actively choose who the gift is
    // from, and the wizard's step-2 validate() blocks Continue until they pick. Both radios
    // therefore carry required + aria-required (accessibility floor) and neither ships checked.
    expect(donor?.querySelector('input[value="individual"]')?.hasAttribute("checked")).toBe(false);
    expect(donor?.querySelector('input[value="business"]')?.hasAttribute("checked")).toBe(false);
    for (const r of radios) {
      expect(r.hasAttribute("required")).toBe(true);
      expect(r.getAttribute("aria-required")).toBe("true");
    }
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

  it("adds the optional business-name field as its own numbered question outside the donor fieldset (REQ-032), starting hidden", () => {
    // TASK-237: business name is promoted to its own top-level .give-question so its
    // number aligns left; it is no longer nested inside the .give-donor fieldset.
    const field = doc.getElementById("businessNameField");
    expect(field).not.toBeNull();
    expect(field?.classList.contains("give-question")).toBe(true);
    expect(field?.closest(".give-donor")).toBeNull();
    expect(field?.closest('.give-step[data-step="2"]')).not.toBeNull();
    // Revealed only for business donors (initDonorType), so the question ships hidden.
    expect(field?.hasAttribute("hidden")).toBe(true);
    const input = field?.querySelector("#businessName") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("text");
    expect(input?.hasAttribute("required")).toBe(false); // optional
    const label = field?.querySelector('label[for="businessName"]');
    expect(label).not.toBeNull();
    expect(norm(label?.textContent).length).toBeGreaterThan(0);
  });

  it("writes the donor-type copy without dashes (REQ-031)", () => {
    expect(norm(donor?.textContent)).not.toMatch(/[–—-]/);
  });

  it("collapses a [hidden] Gift Aid callout in CSS (so the flex box actually hides)", () => {
    // The callout is a flex box; the settled stylesheet collapses any hidden element
    // with a global [hidden]{display:none !important} rule, whose !important beats
    // display:flex so the callout genuinely hides on the company path.
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
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

  it("folds the chosen donorType into the checkout payload (TASK-204: chosen, not defaulted)", () => {
    selectDonor("individual"); // nothing is preselected now, so the donor picks first
    startCheckout(monthlyTier(2), window); // gold £50
    expect(lastPayload()).toEqual({
      mode: "monthly",
      plan: "gold",
      amount: 5000,
      giftAid: false,
      donorType: "individual",
    });
  });

  it("carries the mapped donorType (company) and the businessName when a business donor fills it", () => {
    selectDonor("business");
    businessInput().value = "Acme Ltd";
    startCheckout(onceTier(0), window); // £10 one-off
    // TASK-242: the form's individual/business radio maps to the SERVER's donor-type value
    // (individual/company/partnership). The default business sub-type is company, so a business donor
    // sends donorType:"company" — the enum the API accepts — plus the folded REQ-038 company object
    // (covered precisely in give-company-capture.test.ts). Sending the raw "business" was rejected 400.
    expect(lastPayload()).toMatchObject({
      mode: "once",
      plan: null,
      amount: 1000,
      giftAid: false,
      donorType: "company",
      businessName: "Acme Ltd",
    });
  });

  it("omits businessName from the payload when the field is empty", () => {
    selectDonor("business");
    startCheckout(onceTier(0), window);
    const p = lastPayload();
    expect(p.donorType).toBe("company"); // mapped from the business sub-type (TASK-242)
    expect("businessName" in p).toBe(false);
  });

  it("requires the business name on the business path and un-requires it for an individual (TASK-243)", () => {
    // TASK-243: the business name IS the company's legal name (companyFieldsSchema.legalName, min 1),
    // so a blank one was rejected server-side with a raw JSON alert. Requiring it on the business path
    // makes the wizard's validate() flag it inline instead. Un-required for an individual (not shown).
    const bn = () => document.getElementById("businessName") as HTMLInputElement;
    selectDonor("business");
    expect(bn().hasAttribute("required")).toBe(true);
    expect(bn().getAttribute("aria-required")).toBe("true");
    selectDonor("individual");
    expect(bn().hasAttribute("required")).toBe(false);
  });

  it("startCheckout returns the assembled payload including the chosen donorType", () => {
    selectDonor("individual"); // nothing is preselected now, so the donor picks first
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

// TASK-198 (REQ-043 fix): the Gift Aid declaration is a Gift Aid declaration, so its
// fields must only be shown — and only required — when the donor has opted into Gift
// Aid. On the individual/partnership paths the on-screen copy promises "we ask for
// these only if you add Gift Aid", but the fieldset was shown (and its first name,
// last name, house and address inputs left `required`) purely because the donor path
// was individual/partnership, regardless of the #giftAid checkbox — so validate() on
// the confirm step blocked a donor who had NOT opted into Gift Aid. initDonorType now
// gates the declaration/partners fieldsets on #giftAid as well as the donor path, and
// re-applies when the box is toggled. validate() already skips fields inside a [hidden]
// ancestor, so hiding the fieldset un-requires them.
describe("Gift Aid declaration shows only when Gift Aid is opted in (TASK-198)", () => {
  const { initDonorType } = require(resolve(ROOT, "assets/js/main.js"));
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  const declaration = () => document.querySelector(".give-declaration") as HTMLElement;
  const giftAidBox = () => document.getElementById("giftAid") as HTMLInputElement;
  const setGiftAid = (on: boolean) => {
    giftAidBox().checked = on;
    giftAidBox().dispatchEvent(new Event("change", { bubbles: true }));
  };

  beforeEach(() => {
    document.body.innerHTML = `<main>${cardHtml}</main>`;
    initDonorType(document);
  });

  it("hides the individual declaration until Gift Aid is ticked, and re-hides it when unticked", () => {
    // Individual is the default donor path and #giftAid ships unchecked, so a donor who
    // does not add Gift Aid must never be asked for the HMRC declaration details.
    expect(giftAidBox().checked).toBe(false);
    expect(declaration().hidden).toBe(true);

    setGiftAid(true);
    expect(declaration().hidden).toBe(false);

    setGiftAid(false);
    expect(declaration().hidden).toBe(true);
  });

  it("hides the partner declarations until Gift Aid is opted in on the partnership path", () => {
    // A business partnership keeps Gift Aid (partners are individuals in law), so the same
    // gating applies to its per-partner declarations (.give-partners).
    const partners = () => document.querySelector(".give-partners") as HTMLElement;
    (document.querySelector('input[name="donorType"][value="business"]') as HTMLElement).click();
    (document.querySelector('input[name="businessType"][value="partnership"]') as HTMLElement).click();

    expect(giftAidBox().checked).toBe(false);
    expect(partners().hidden).toBe(true);

    setGiftAid(true);
    expect(partners().hidden).toBe(false);

    setGiftAid(false);
    expect(partners().hidden).toBe(true);
  });
});
