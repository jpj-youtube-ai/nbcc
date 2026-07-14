// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-225: the donate wizard validates the CURRENT step on each "Continue" through the shared
// highlight-all helper. A step cannot be skipped with missing fields; every missing field on the
// step is flagged at once and the step's own [data-err] node is refreshed as the role=alert
// summary. Exercised against the real initGiveSteps + the give inits, mirroring give-donor-type.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { initGiveToggle, initDonorType, initContactCapture, initDeclarationCapture, initGiveSteps } =
  require(resolve(ROOT, "assets/js/main.js"));
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const doc0 = new DOMParser().parseFromString(html, "text/html");
const mainHtml = doc0.querySelector(".give-main")?.outerHTML ?? "";

const inv = (id: string) => document.getElementById(id)?.getAttribute("aria-invalid");
const visibleStep = () =>
  [...document.querySelectorAll(".give-step")]
    .find((s) => !(s as HTMLElement).hidden)
    ?.getAttribute("data-step");
const errShown = (n: string) =>
  document.querySelector(`[data-err="${n}"]`)?.classList.contains("show") === true;
const clickNextIn = (n: string) =>
  (document.querySelector(`.give-step[data-step="${n}"] [data-give-next]`) as HTMLButtonElement)?.click();
const set = (id: string, v: string) => {
  (document.getElementById(id) as HTMLInputElement).value = v;
};
const chooseMonthlyTier = () =>
  (document.querySelector('.give-tier[data-mode="monthly"]') as HTMLButtonElement).click();

beforeEach(() => {
  document.body.innerHTML = `<main>${mainHtml}</main>`;
  initGiveToggle(document);
  initDeclarationCapture(document);
  initDonorType(document);
  initContactCapture(document);
  initGiveSteps(document, window);
});

describe("donate wizard per-step validation (TASK-225)", () => {
  it("exports initGiveSteps", () => {
    expect(typeof initGiveSteps).toBe("function");
  });

  it("blocks step 1 with no amount chosen: shows the step summary and flags the amount field", () => {
    expect(visibleStep()).toBe("1");
    clickNextIn("1");
    expect(visibleStep()).toBe("1");
    expect(errShown("1")).toBe(true);
    expect(inv("customAmountMonthly")).toBe("true");
  });

  it("advances to step 2 once a tier is chosen", () => {
    chooseMonthlyTier();
    clickNextIn("1");
    expect(visibleStep()).toBe("2");
  });

  it("blocks step 2 and flags every missing detail at once, with the step summary", () => {
    chooseMonthlyTier();
    clickNextIn("1");
    expect(visibleStep()).toBe("2");
    clickNextIn("2");
    expect(visibleStep()).toBe("2");
    expect(errShown("2")).toBe(true);
    expect(inv("donorIndividual")).toBe("true"); // the donor-type radio group
    expect(inv("donorFirstName")).toBe("true");
    expect(inv("donorSurname")).toBe("true");
    expect(inv("donorEmail")).toBe("true");
  });

  it("advances to step 3 once step 2 is complete", () => {
    chooseMonthlyTier();
    clickNextIn("1");
    (document.getElementById("donorIndividual") as HTMLInputElement).click();
    set("donorFirstName", "Ada");
    set("donorSurname", "Lovelace");
    set("donorEmail", "ada@example.com");
    (document.getElementById("ageConfirmed") as HTMLInputElement).checked = true;
    clickNextIn("2");
    expect(visibleStep()).toBe("3");
  });
});
