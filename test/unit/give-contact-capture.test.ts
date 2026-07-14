// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-058 (REQ-039): consent-based contact capture inside the give widget. Below
// the donor-type fieldset and above the tiers sits a contact fieldset: a REQUIRED
// donor name captured as two fields (first name + surname, TASK-210), an email paired
// with an email-consent tick that is NEVER
// ticked in advance, an anonymous option, and a monthly-only 18-or-over
// confirmation. The 18+ row shows only in give-monthly mode (initGiveToggle,
// mirroring the tier + Gift Aid statement swap). startCheckout combines the two name
// fields into a single fullName and folds fullName,
// email, emailConsent, anonymous and (monthly) ageConfirmed into the REQ-028 payload
// once initContactCapture has wired the fieldset (data-ready) — without JS the base
// { mode, plan, amount, giftAid } contract is unchanged. Static markup is parsed with
// jsdom; behaviour runs against the real initGiveToggle/initContactCapture/
// startCheckout/initCheckout from main.js, mirroring give-donor-type/give-checkout.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("contact capture markup (REQ-039)", () => {
  const widget = doc.querySelector("section.give-widget");
  const contact = widget?.querySelector(".give-contact");

  it("renders the contact-capture fieldset in the give-card main column", () => {
    expect(contact).not.toBeNull();
    expect(doc.querySelector(".give-card .give-main .give-contact")).not.toBeNull();
    expect(contact?.tagName).toBe("FIELDSET");
    expect(norm(contact?.querySelector("legend")?.textContent).length).toBeGreaterThan(0);
  });

  it("sits below the donor-type fieldset in the details step (step 2)", () => {
    const main = widget?.querySelector(".give-card .give-main");
    const donorEl = main?.querySelector(".give-donor");
    const contactEl = main?.querySelector(".give-contact");
    // DOCUMENT_POSITION_FOLLOWING (4): the contact fieldset comes after donor-type.
    expect(donorEl!.compareDocumentPosition(contactEl!) & 4).toBeTruthy();
    // The wizard groups donor-type and contact in the "your details" step (step 2),
    // while the amount tiers live in the earlier "your gift" step (step 1).
    expect(donorEl?.closest('.give-step[data-step="2"]')).not.toBeNull();
    expect(contactEl?.closest('.give-step[data-step="2"]')).not.toBeNull();
    expect(main?.querySelector("#tiersOnce")?.closest('.give-step[data-step="1"]')).not.toBeNull();
  });

  // TASK-210: the donor name is captured as two REQUIRED fields — First name and Surname —
  // each a real text input with a <label for>, aria-required, and a sensible autocomplete
  // token. startCheckout combines them into the single fullName the checkout contract POSTs.
  it("has a REQUIRED first-name text input with a real <label for>, aria-required and given-name autocomplete", () => {
    const input = contact?.querySelector("#donorFirstName") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("text");
    expect(input?.hasAttribute("required")).toBe(true);
    expect(input?.getAttribute("aria-required")).toBe("true");
    expect(input?.getAttribute("autocomplete")).toBe("given-name");
    const label = contact?.querySelector('label[for="donorFirstName"]');
    expect(label).not.toBeNull();
    expect(norm(label?.textContent).length).toBeGreaterThan(0);
  });

  it("has a REQUIRED surname text input with a real <label for>, aria-required and family-name autocomplete", () => {
    const input = contact?.querySelector("#donorSurname") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("text");
    expect(input?.hasAttribute("required")).toBe(true);
    expect(input?.getAttribute("aria-required")).toBe("true");
    expect(input?.getAttribute("autocomplete")).toBe("family-name");
    const label = contact?.querySelector('label[for="donorSurname"]');
    expect(label).not.toBeNull();
    expect(norm(label?.textContent).length).toBeGreaterThan(0);
  });

  it("no longer renders the old single full-name field (#donorName)", () => {
    expect(contact?.querySelector("#donorName")).toBeNull();
  });

  // TASK-219: the first-name and surname fields sit side by side in one shared row wrapper
  // (.give-name-row), so the donor name reads as one field split in two. Each input keeps its
  // own .give-field wrapper (markup reused, not restyled); only the row wrapper is new.
  it("lays first name and surname side by side in one shared .give-name-row wrapper", () => {
    const row = contact?.querySelector(".give-name-row");
    expect(row).not.toBeNull();
    // both name inputs live inside the one row wrapper...
    const first = row?.querySelector("#donorFirstName");
    const surname = row?.querySelector("#donorSurname");
    expect(first).not.toBeNull();
    expect(surname).not.toBeNull();
    // ...each still inside its own reused .give-field wrapper...
    expect(first?.closest(".give-field")).not.toBeNull();
    expect(surname?.closest(".give-field")).not.toBeNull();
    // ...and the row itself sits in the contact fieldset.
    expect(row?.closest(".give-contact")).not.toBeNull();
    // The email field is NOT pulled into the name row (it stays full width below).
    expect(row?.querySelector("#donorEmail")).toBeNull();
  });

  it("styles the name row as two equal half-width columns in CSS (TASK-219)", () => {
    expect(css).toMatch(/\.give-name-row\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  });

  it("has a REQUIRED email input with a real <label for> and aria-required (REQ-039)", () => {
    const input = contact?.querySelector("#donorEmail") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("email");
    expect(input?.getAttribute("name")).toBe("email");
    expect(input?.hasAttribute("required")).toBe(true);
    expect(input?.getAttribute("aria-required")).toBe("true");
    expect(contact?.querySelector('label[for="donorEmail"]')).not.toBeNull();
  });

  it("pairs email with an email-consent checkbox that is NOT ticked in advance", () => {
    const box = contact?.querySelector("#emailConsent") as HTMLInputElement | null;
    expect(box).not.toBeNull();
    expect(box?.getAttribute("type")).toBe("checkbox");
    expect(box?.getAttribute("name")).toBe("emailConsent");
    expect(box?.hasAttribute("checked")).toBe(false); // consent is never pre-selected
    expect(contact?.querySelector('label[for="emailConsent"]')).not.toBeNull();
  });

  it("offers an anonymous-donor checkbox with a real <label for>, not pre-ticked", () => {
    const box = contact?.querySelector("#anonymousDonor") as HTMLInputElement | null;
    expect(box).not.toBeNull();
    expect(box?.getAttribute("type")).toBe("checkbox");
    expect(box?.getAttribute("name")).toBe("anonymous");
    expect(box?.hasAttribute("checked")).toBe(false);
    expect(contact?.querySelector('label[for="anonymousDonor"]')).not.toBeNull();
  });

  it("offers a monthly-only 18-or-over confirmation checkbox with a real <label for>", () => {
    const box = contact?.querySelector("#ageConfirmed") as HTMLInputElement | null;
    expect(box).not.toBeNull();
    expect(box?.getAttribute("type")).toBe("checkbox");
    expect(box?.getAttribute("name")).toBe("ageConfirmed");
    expect(contact?.querySelector('label[for="ageConfirmed"]')).not.toBeNull();
    // Its toggle wrapper carries the id the give-mode swap reveals/hides.
    expect(doc.getElementById("ageConfirmField")).not.toBeNull();
    const ageText = norm(doc.getElementById("ageConfirmField")?.textContent).toLowerCase();
    expect(ageText).toContain("18 or over");
  });

  it("writes the contact copy without dashes (REQ-031)", () => {
    expect(norm(contact?.textContent)).not.toMatch(/[–—-]/);
  });

  it("collapses a [hidden] 18+ block in CSS (so the flex row actually hides)", () => {
    // The 18+ row is a flex .give-check; the settled stylesheet collapses any hidden
    // element with a global [hidden]{display:none !important} rule, whose !important
    // beats display:flex so the row genuinely hides when the give-mode swap sets it.
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});

describe("contact capture behaviour (jsdom)", () => {
  const { initGiveToggle, initContactCapture, initCheckout, startCheckout } = require(
    resolve(ROOT, "assets/js/main.js"),
  );
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  const ageField = () => document.getElementById("ageConfirmField") as HTMLElement;
  const monthlyTier = (i: number) =>
    document.querySelectorAll("#tiersMonthly .give-tier")[i] as HTMLElement;
  const onceTier = (i: number) =>
    document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;
  const clickMode = (id: string) => (document.getElementById(id) as HTMLElement).click();

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
    initContactCapture(document);
    initCheckout(document, window);
  });

  it("exports initContactCapture from the shared script", () => {
    expect(typeof initContactCapture).toBe("function");
  });

  it("shows the 18+ confirmation in monthly mode (the default) and hides it in once mode", () => {
    expect(ageField().hidden).toBe(false); // monthly is the default give mode
    clickMode("giveOnce");
    expect(ageField().hidden).toBe(true);
    clickMode("giveMonthly");
    expect(ageField().hidden).toBe(false);
  });

  it("folds fullName, email, emailConsent, anonymous and ageConfirmed for a monthly gift", () => {
    // TASK-210: fullName is the two name fields combined (first + " " + surname).
    (document.getElementById("donorFirstName") as HTMLInputElement).value = "Ada";
    (document.getElementById("donorSurname") as HTMLInputElement).value = "Lovelace";
    (document.getElementById("donorEmail") as HTMLInputElement).value = "ada@example.com";
    (document.getElementById("emailConsent") as HTMLInputElement).checked = true;
    (document.getElementById("anonymousDonor") as HTMLInputElement).checked = true;
    (document.getElementById("ageConfirmed") as HTMLInputElement).checked = true;
    startCheckout(monthlyTier(2), window); // gold £50
    expect(lastPayload()).toEqual({
      mode: "monthly",
      plan: "gold",
      amount: 5000,
      giftAid: false,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      emailConsent: true,
      anonymous: true,
      ageConfirmed: true,
    });
  });

  it("omits ageConfirmed for a one-off gift (18+ applies to monthly only)", () => {
    clickMode("giveOnce");
    (document.getElementById("donorFirstName") as HTMLInputElement).value = "Grace";
    (document.getElementById("donorSurname") as HTMLInputElement).value = "Hopper";
    startCheckout(onceTier(0), window); // £10
    const p = lastPayload();
    expect(p.mode).toBe("once");
    expect(p.fullName).toBe("Grace Hopper");
    expect(p.emailConsent).toBe(false);
    expect(p.anonymous).toBe(false);
    expect("ageConfirmed" in p).toBe(false);
  });

  it("carries emailConsent=false and anonymous=false when neither is ticked", () => {
    (document.getElementById("donorFirstName") as HTMLInputElement).value = "Anon";
    (document.getElementById("donorSurname") as HTMLInputElement).value = "Donor";
    startCheckout(monthlyTier(0), window);
    const p = lastPayload();
    expect(p.emailConsent).toBe(false);
    expect(p.anonymous).toBe(false);
  });

  it("combines the two name fields into a single fullName equal to first + ' ' + surname (TASK-210)", () => {
    (document.getElementById("donorFirstName") as HTMLInputElement).value = "Katherine";
    (document.getElementById("donorSurname") as HTMLInputElement).value = "Johnson";
    const payload = startCheckout(monthlyTier(1), window);
    // The checkout contract is unchanged: one combined fullName, no first/surname keys leak in.
    expect(payload.fullName).toBe("Katherine Johnson");
    expect("firstName" in payload).toBe(false);
    expect("surname" in payload).toBe(false);
  });

  it("does not fold contact fields until the fieldset is wired (base contract without JS)", () => {
    // A fresh card with ONLY the checkout wired (no initContactCapture) must emit the
    // base { mode, plan, amount, giftAid } payload — the enhancement is opt-in.
    document.body.innerHTML = `<main>${cardHtml}</main>`;
    initCheckout(document, window);
    startCheckout(monthlyTier(1), window);
    expect(lastPayload()).toEqual({ mode: "monthly", plan: "silver", amount: 2500, giftAid: false });
  });
});
