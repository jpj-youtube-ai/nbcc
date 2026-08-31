// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-321: the "cover the card fee" control on donate.html, exercised against the REAL
// initGiveToggle from main.js (the same jsdom approach as gift-aid.test.ts and nav.test.ts).
//
// The behaviour worth pinning is not that it hides for monthly — it is that it also UNTICKS.
// Hiding alone leaves a ticked box in the DOM, and startCheckout would then send coverFee:true
// on a monthly gift. The endpoint refuses it, so nothing would be mis-charged, but the donor
// would have been shown an offer that silently did nothing.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");

describe("the fee-cover control on donate.html", () => {
  const doc = new DOMParser().parseFromString(html, "text/html");

  it("is a real checkbox with a label pointing at it", () => {
    const input = doc.querySelector("#coverFee") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("checkbox");
    expect(doc.querySelector('label[for="coverFee"]')).not.toBeNull();
  });

  // An offer, never a default opt-out.
  it("is not pre-ticked", () => {
    const input = doc.querySelector("#coverFee") as HTMLInputElement | null;
    expect(input?.hasAttribute("checked")).toBe(false);
    expect(input?.checked).toBe(false);
  });

  it("carries a slot for the live amount", () => {
    expect(doc.querySelector("#coverFeeAmount")).not.toBeNull();
  });

  // Gift Aid is claimed on the gift only; the label says so rather than leaving a donor to
  // assume the fee is covered by it too.
  it("says Gift Aid applies to the donation only", () => {
    const label = doc.querySelector('label[for="coverFee"]');
    expect((label?.textContent ?? "").replace(/\s+/g, " ")).toMatch(/gift aid.*donation only/i);
  });
});

describe("switching to monthly (real initGiveToggle)", () => {
  let initGiveToggle: (doc: Document) => void;

  beforeEach(() => {
    document.documentElement.innerHTML = html;
    ({ initGiveToggle } = require(resolve(ROOT, "assets/js/main.js")));
  });

  const field = () => document.getElementById("coverFeeField") as HTMLElement;
  const box = () => document.getElementById("coverFee") as HTMLInputElement;
  const modeButton = (mode: string) =>
    document.querySelector(`[data-mode="${mode}"]`) as HTMLElement | null;

  it("offers the fee cover on a one-off gift", () => {
    initGiveToggle(document);
    const once = modeButton("once");
    if (once) once.click();
    expect(field().hidden).toBe(false);
  });

  it("hides it AND unticks it when the donor switches to monthly", () => {
    initGiveToggle(document);
    const once = modeButton("once");
    if (once) once.click();
    box().checked = true;

    const monthly = modeButton("monthly");
    expect(monthly, "donate.html should offer a monthly mode button").not.toBeNull();
    monthly!.click();

    expect(field().hidden).toBe(true);
    // The point of the test: a hidden box that is still ticked would be sent on the request.
    expect(box().checked).toBe(false);
  });
});
