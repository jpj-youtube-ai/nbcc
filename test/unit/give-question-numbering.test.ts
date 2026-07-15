// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-237 (donate per-question numbering): every VISIBLE question in the give
// widget's details step carries a big left-hand number, driven by a pure-CSS
// counter over `.give-question:not([hidden])`. The number auto-renumbers as the
// donor's earlier choices (individual/business, company/partnership, once/monthly,
// amount) show or hide later questions. Individual monthly of £10+: 1 who-from,
// 2 name, 3 email, 4 newsletter, 5 18+, 6 Gift Aid, 7 supporters. Business:
// 1 who-from, 2 company/partnership, 3 business name, 4 name, 5 email, 6 newsletter,
// 7 18+, 8 Gift Aid (partnership only; an incorporated company skips it) and NO
// supporters (that opt-in is individuals-only, TASK-235). The company/partnership
// options list their examples inline and drop the old explainer paragraph. To keep
// the numbers left-aligned, the business-type and business-name questions are
// promoted OUT of the donor fieldset to their own top-level `.give-question`
// siblings, so initDonorType now finds the business-type radios document-wide.
// Static markup is parsed with jsdom; the renumbering is exercised against the real
// main.js inits, mirroring give-donor-type / give-supporter-optin.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const step2 = doc.querySelector('.give-step[data-step="2"]') as HTMLElement;
// a precedes b in document order
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & 4);

describe("per-question numbering markup (TASK-237)", () => {
  it("drives numbering from a CSS counter over visible .give-question blocks", () => {
    expect(css).toMatch(/\.give-step\s*\{[^}]*counter-reset:\s*gq/);
    expect(css).toMatch(/\.give-question:not\(\[hidden\]\)\s*\{[^}]*counter-increment:\s*gq/);
    expect(css).toMatch(/\.give-question:not\(\[hidden\]\)::before\s*\{[^}]*content:\s*counter\(gq\)/);
  });

  it("orders the details-step questions: who-from, business type, business name, name, email, newsletter, 18+, Gift Aid, supporters", () => {
    const donor = step2.querySelector(".give-donor")!.closest(".give-question")!;
    const bType = doc.getElementById("businessTypeField")!;
    const bName = doc.getElementById("businessNameField")!;
    const name = step2.querySelector(".give-name-row")!;
    const email = step2.querySelector("#donorEmail")!.closest(".give-question")!;
    const news = step2.querySelector(".give-newsletter")!.closest(".give-question")!;
    const age = doc.getElementById("ageConfirmField")!;
    const giftaid = step2.querySelector(".giftaid")!.closest(".give-question")!;
    const supporter = doc.getElementById("supporterOptin")!;

    const order = [donor, bType, bName, name, email, news, age, giftaid, supporter];
    for (const q of order) {
      expect(q).not.toBeNull();
      expect((q as HTMLElement).classList.contains("give-question")).toBe(true);
    }
    for (let i = 0; i < order.length - 1; i++) {
      expect(before(order[i], order[i + 1]), `question ${i + 1} precedes ${i + 2}`).toBe(true);
    }
  });

  it("promotes company/partnership and business name to their own questions, outside the donor fieldset, shipped hidden", () => {
    const bType = doc.getElementById("businessTypeField")!;
    const bName = doc.getElementById("businessNameField")!;
    expect(bType.classList.contains("give-question")).toBe(true);
    expect(bName.classList.contains("give-question")).toBe(true);
    // No longer nested inside the donor fieldset (so their numbers align left).
    expect(bType.closest(".give-donor")).toBeNull();
    expect(bName.closest(".give-donor")).toBeNull();
    expect(bType.hasAttribute("hidden")).toBe(true);
    expect(bName.hasAttribute("hidden")).toBe(true);
  });

  it("wraps the Gift Aid callout in its own question and puts the supporters opt-in AFTER it", () => {
    const giftaidQ = step2.querySelector(".giftaid")!.closest(".give-question")!;
    const supporter = doc.getElementById("supporterOptin")!;
    expect(giftaidQ).not.toBeNull();
    // Supporters follows Gift Aid, so it numbers immediately after it (7 after 6).
    expect(before(giftaidQ, supporter)).toBe(true);
  });

  it("lists the company/partnership examples in the options and drops the old explainer paragraph", () => {
    const bType = doc.getElementById("businessTypeField")!;
    const text = norm(bType.textContent).toLowerCase();
    expect(text).toContain("ltd");
    expect(text).toContain("plc");
    expect(text).toContain("llp");
    expect(text).toContain("partnership");
    // The standalone explainer <p> under the options is gone (the inline examples replace it).
    expect(bType.querySelector("p.give-business-help")).toBeNull();
  });

  it("keeps the 18+ confirmation a numbered question with its checkbox still inside the contact fieldset", () => {
    const age = doc.getElementById("ageConfirmField")!;
    expect(age.classList.contains("give-question")).toBe(true);
    // The checkbox stays inside .give-contact (main.js reads it there; TASK-058 contract).
    expect(doc.querySelector(".give-contact #ageConfirmed")).not.toBeNull();
    expect(age.querySelector("#ageConfirmed")).not.toBeNull();
  });

  it("writes every numbered-question label without dashes (REQ-031)", () => {
    for (const q of [...step2.querySelectorAll(".give-question")]) {
      expect(norm(q.textContent)).not.toMatch(/[–—-]/);
    }
  });
});

describe("per-question renumbering behaviour (jsdom)", () => {
  const { initGiveToggle, initContactCapture, initDonorType, initGiveSteps } = require(
    resolve(ROOT, "assets/js/main.js"),
  );
  const mainHtml = doc.querySelector(".give-main")?.outerHTML ?? "";

  const step = () => document.querySelector('.give-step[data-step="2"]') as HTMLElement;
  // A .give-question numbers iff it is not itself hidden (the CSS counter test
  // above :not([hidden])); none of them nest inside another, so its own flag is
  // the whole story regardless of the step section's own hidden state.
  const shownCount = () =>
    [...step().querySelectorAll(".give-question")].filter((q) => !(q as HTMLElement).hidden).length;
  const id = (x: string) => document.getElementById(x) as HTMLElement;
  const giftaidQ = () => document.querySelector(".giftaid")!.closest(".give-question") as HTMLElement;
  const clickMode = (x: string) => (document.getElementById(x) as HTMLElement).click();
  const monthlyTier = (i: number) => document.querySelectorAll("#tiersMonthly .give-tier")[i] as HTMLElement;
  const onceTier = (i: number) => document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;
  const pickDonor = (v: string) =>
    (document.querySelector(`input[name="donorType"][value="${v}"]`) as HTMLElement).click();
  const pickType = (v: string) =>
    (document.querySelector(`input[name="businessType"][value="${v}"]`) as HTMLElement).click();

  beforeEach(() => {
    document.body.innerHTML = `<main>${mainHtml}</main>`;
    window.alert = () => {};
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initGiveToggle(document);
    initContactCapture(document);
    initDonorType(document);
    initGiveSteps(document, window);
  });

  it("numbers 7 questions for an individual monthly gift of £10+ (who, name, email, newsletter, 18+, Gift Aid, supporters)", () => {
    pickDonor("individual");
    monthlyTier(1).click(); // silver £25 (>= £10 floor, so supporters shows)
    expect(id("businessTypeField").hidden).toBe(true);
    expect(id("businessNameField").hidden).toBe(true);
    expect(id("supporterOptin").hidden).toBe(false);
    expect(shownCount()).toBe(7);
  });

  it("drops the 18+ and supporters questions for an individual one-off gift (Gift Aid becomes 5)", () => {
    pickDonor("individual");
    clickMode("giveOnce");
    onceTier(2).click(); // £50 one-off
    expect(id("ageConfirmField").hidden).toBe(true); // 18+ is monthly-only
    expect(id("supporterOptin").hidden).toBe(true); // supporters is monthly-only
    // who, name, email, newsletter, Gift Aid
    expect(shownCount()).toBe(5);
  });

  it("numbers 7 questions for a company (business type + name appear, Gift Aid and supporters drop)", () => {
    pickDonor("business"); // company is the default business sub-type
    monthlyTier(1).click();
    expect(id("businessTypeField").hidden).toBe(false);
    expect(id("businessNameField").hidden).toBe(false);
    expect(giftaidQ().hidden).toBe(true); // an incorporated company skips Gift Aid
    expect(id("supporterOptin").hidden).toBe(true); // supporters is individuals-only
    // who, business type, business name, name, email, newsletter, 18+
    expect(shownCount()).toBe(7);
  });

  it("numbers 8 questions for a partnership (Gift Aid returns as number 8)", () => {
    pickDonor("business");
    pickType("partnership");
    monthlyTier(1).click();
    expect(giftaidQ().hidden).toBe(false); // a partnership keeps Gift Aid
    // who, business type, business name, name, email, newsletter, 18+, Gift Aid
    expect(shownCount()).toBe(8);
  });

  it("re-wires the Gift Aid question when the company/partnership choice changes (business-type radios now live outside .give-donor)", () => {
    pickDonor("business");
    expect(giftaidQ().hidden).toBe(true); // company default: Gift Aid hidden
    pickType("partnership");
    expect(giftaidQ().hidden).toBe(false); // partnership: Gift Aid returns
    pickType("company");
    expect(giftaidQ().hidden).toBe(true); // company again: Gift Aid hidden
  });
});
