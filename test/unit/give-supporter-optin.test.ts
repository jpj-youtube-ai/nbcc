// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-224 (individual supporters-wall opt-in): the donate form lets an INDIVIDUAL monthly donor of
// £10 a month or more choose to appear on the public supporters page, under an optional display name.
// The opt-in lives in the contact step (#supporterOptin, inside .give-contact); initGiveSteps reveals it
// ONLY for a monthly gift of at least £10 (updateSummary), the required radio has nothing preselected,
// the display-name field shows only when the donor opts in, and startCheckout folds listOnSupporters +
// creditName into the REQ-028 payload only for that eligible gift. A tiny client-side bad-word pre-check
// flags an obvious profane display name through the shared highlight-all validator (the server filter
// stays load-bearing). Static markup is parsed with jsdom; behaviour runs against the real main.js,
// mirroring give-contact-capture / give-company-capture / give-steps-validation.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("supporters opt-in markup (TASK-224)", () => {
  const contact = doc.querySelector(".give-contact");
  const block = doc.querySelector("#supporterOptin");

  it("renders the opt-in block inside the contact fieldset (step 2), shipped hidden", () => {
    expect(block).not.toBeNull();
    expect(block?.closest(".give-contact")).not.toBeNull();
    expect(block?.closest('.give-step[data-step="2"]')).not.toBeNull();
    expect((block as HTMLElement)?.hasAttribute("hidden")).toBe(true);
  });

  it("offers a REQUIRED yes/no radio group with NOTHING preselected, each with a real <label for>", () => {
    const radios = [...(block?.querySelectorAll('input[name="listOnSupporters"]') ?? [])] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios.map((r) => r.getAttribute("value")).sort()).toEqual(["no", "yes"]);
    for (const r of radios) {
      expect(r.hasAttribute("required")).toBe(true);
      expect(r.getAttribute("aria-required")).toBe("true");
      expect(r.hasAttribute("checked")).toBe(false); // nothing preselected
      const label = block?.querySelector(`label[for="${r.getAttribute("id")}"]`);
      expect(label, `label for #${r.getAttribute("id")}`).not.toBeNull();
      expect(norm(label?.textContent).length).toBeGreaterThan(0);
    }
  });

  it("has a custom display-name text input (name=creditName, maxlength 200) in a hidden wrapper, with a label", () => {
    const wrap = block?.querySelector("#supporterCreditNameField") as HTMLElement | null;
    const input = block?.querySelector("#supporterCreditName") as HTMLInputElement | null;
    expect(wrap?.hasAttribute("hidden")).toBe(true);
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("text");
    expect(input?.getAttribute("name")).toBe("creditName");
    expect(input?.getAttribute("maxlength")).toBe("200");
    expect(input?.hasAttribute("required")).toBe(true);
    expect(block?.querySelector('label[for="supporterCreditName"]')).not.toBeNull();
  });

  it("writes the opt-in copy without dashes (REQ-031) and keeps the whole contact fieldset dash-free", () => {
    expect(norm(block?.textContent)).not.toMatch(/[–—-]/);
    expect(norm(contact?.textContent)).not.toMatch(/[–—-]/);
  });
});

describe("supporters opt-in behaviour (jsdom)", () => {
  const { initGiveToggle, initContactCapture, initDonorType, initGiveSteps, startCheckout } = require(
    resolve(ROOT, "assets/js/main.js"),
  );
  const mainHtml = doc.querySelector(".give-main")?.outerHTML ?? "";

  const block = () => document.getElementById("supporterOptin") as HTMLElement;
  const creditWrap = () => document.getElementById("supporterCreditNameField") as HTMLElement;
  const monthlyTier = (i: number) => document.querySelectorAll("#tiersMonthly .give-tier")[i] as HTMLElement;
  const onceTier = (i: number) => document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;
  const clickMode = (id: string) => (document.getElementById(id) as HTMLElement).click();
  const typeCustomMonthly = (v: string) => {
    const inp = document.getElementById("customAmountMonthly") as HTMLInputElement;
    inp.value = v;
    inp.dispatchEvent(new Event("input"));
  };

  beforeEach(() => {
    document.body.innerHTML = `<main>${mainHtml}</main>`;
    window.alert = () => {}; // startCheckout previews via alert when fetch is absent; we read its return value
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initGiveToggle(document);
    initContactCapture(document);
    initDonorType(document);
    initGiveSteps(document, window);
  });

  it("ships hidden on load (nothing selected yet)", () => {
    expect(block().hidden).toBe(true);
  });

  it("reveals for a monthly gift of at least £10 and hides again for a one-off gift", () => {
    monthlyTier(0).click(); // bronze £10 (the floor)
    expect(block().hidden).toBe(false);
    clickMode("giveOnce");
    onceTier(2).click(); // £50 one-off
    expect(block().hidden).toBe(true);
  });

  it("stays hidden for a monthly custom amount under £10 and reveals at £10 or more", () => {
    typeCustomMonthly("5"); // £5/mo — below the wall floor
    expect(block().hidden).toBe(true);
    typeCustomMonthly("15"); // £15/mo
    expect(block().hidden).toBe(false);
  });

  it("reveals the display-name field only when 'show' is chosen", () => {
    monthlyTier(2).click(); // gold £50
    expect(creditWrap().hidden).toBe(true);
    (document.getElementById("supporterListYes") as HTMLInputElement).click();
    expect(creditWrap().hidden).toBe(false);
    (document.getElementById("supporterListNo") as HTMLInputElement).click();
    expect(creditWrap().hidden).toBe(true);
  });

  it("folds listOnSupporters:true + creditName into the payload for an eligible monthly gift when shown", () => {
    monthlyTier(2).click(); // gold £50, reveals the block
    (document.getElementById("supporterListYes") as HTMLInputElement).click();
    (document.getElementById("supporterCreditName") as HTMLInputElement).value = "The Campbell Family";
    const p = startCheckout(monthlyTier(2), window);
    expect(p.mode).toBe("monthly");
    expect(p.listOnSupporters).toBe(true);
    expect(p.creditName).toBe("The Campbell Family");
  });

  it("folds listOnSupporters:false and omits creditName when the donor keeps private", () => {
    monthlyTier(2).click();
    (document.getElementById("supporterListNo") as HTMLInputElement).click();
    const p = startCheckout(monthlyTier(2), window);
    expect(p.listOnSupporters).toBe(false);
    expect("creditName" in p).toBe(false);
  });

  it("omits both fields entirely for a one-off gift (the opt-in never applies)", () => {
    clickMode("giveOnce");
    onceTier(0).click(); // £10 one-off
    const p = startCheckout(onceTier(0), window);
    expect("listOnSupporters" in p).toBe(false);
    expect("creditName" in p).toBe(false);
  });

  it("omits both fields for a sub-£10 monthly custom gift (below the wall floor)", () => {
    typeCustomMonthly("5"); // £5/mo
    const custom = document.querySelector("#tiersMonthly .give-tier-custom") as HTMLElement;
    const p = startCheckout(custom, window);
    expect("listOnSupporters" in p).toBe(false);
    expect("creditName" in p).toBe(false);
  });
});

describe("supporters opt-in validation interplay (jsdom, TASK-224 / TASK-225)", () => {
  const { initGiveToggle, initContactCapture, initDonorType, initDeclarationCapture, initGiveSteps } =
    require(resolve(ROOT, "assets/js/main.js"));
  const mainHtml = doc.querySelector(".give-main")?.outerHTML ?? "";

  const inv = (id: string) => document.getElementById(id)?.getAttribute("aria-invalid");
  const visibleStep = () =>
    [...document.querySelectorAll(".give-step")].find((s) => !(s as HTMLElement).hidden)?.getAttribute("data-step");
  const clickNextIn = (n: string) =>
    (document.querySelector(`.give-step[data-step="${n}"] [data-give-next]`) as HTMLButtonElement)?.click();
  const set = (id: string, v: string) => {
    (document.getElementById(id) as HTMLInputElement).value = v;
  };
  const fillCommonStep2 = () => {
    (document.getElementById("donorIndividual") as HTMLInputElement).click();
    set("donorFirstName", "Ada");
    set("donorSurname", "Lovelace");
    set("donorEmail", "ada@example.com");
    (document.getElementById("ageConfirmed") as HTMLInputElement).checked = true;
  };
  const chooseMonthly = (i: number) =>
    (document.querySelectorAll("#tiersMonthly .give-tier")[i] as HTMLButtonElement).click();
  const chooseOnce = (i: number) => {
    (document.getElementById("giveOnce") as HTMLElement).click();
    (document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLButtonElement).click();
  };

  beforeEach(() => {
    document.body.innerHTML = `<main>${mainHtml}</main>`;
    initGiveToggle(document);
    initDeclarationCapture(document);
    initDonorType(document);
    initContactCapture(document);
    initGiveSteps(document, window);
  });

  it("REQUIRES an opt-in answer when the block is visible (monthly £10) and blocks step 2 until answered", () => {
    chooseMonthly(0); // bronze £10 — reveals the opt-in
    clickNextIn("1");
    expect(visibleStep()).toBe("2");
    fillCommonStep2(); // everything except the opt-in answer
    clickNextIn("2");
    expect(visibleStep()).toBe("2"); // still blocked
    expect(inv("supporterListYes")).toBe("true"); // the required radio group is flagged
  });

  it("SKIPS the opt-in for a one-off gift (block hidden), so step 2 completes without it", () => {
    chooseOnce(2); // £50 one-off — the opt-in never shows
    clickNextIn("1");
    fillCommonStep2();
    clickNextIn("2");
    expect(visibleStep()).toBe("3"); // advanced; the hidden radio was skipped
  });

  it("flags an obvious profane display name through the shared validator before checkout", () => {
    chooseMonthly(2); // gold £50 — reveals the opt-in
    clickNextIn("1");
    fillCommonStep2();
    (document.getElementById("supporterListYes") as HTMLInputElement).click();
    set("supporterCreditName", "total fuck off");
    clickNextIn("2");
    expect(visibleStep()).toBe("2"); // blocked by the client bad-word pre-check
    expect(inv("supporterCreditName")).toBe("true");
  });

  it("lets a clean display name through to step 3", () => {
    chooseMonthly(2);
    clickNextIn("1");
    fillCommonStep2();
    (document.getElementById("supporterListYes") as HTMLInputElement).click();
    set("supporterCreditName", "The Campbell Family");
    clickNextIn("2");
    expect(visibleStep()).toBe("3");
  });
});
