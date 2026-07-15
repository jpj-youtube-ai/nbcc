// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-225: the shared, accessible "highlight ALL missing fields" validation helper
// that every user-facing form routes through. validateForm(scope, opts?) flags every
// invalid control at once (aria-invalid + is-invalid + an inline message linked via
// aria-describedby), refreshes ONE role=alert summary at the top of the scope, focuses
// the first invalid field, and live-clears a control as the user fixes it. Exercised
// against the real helper exported from main.js, mirroring contact.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { validateForm, clearValidation } = require(resolve(ROOT, "assets/js/main.js"));

const FORM = `
  <form id="f">
    <div class="give-field">
      <label for="name">Name</label>
      <input id="name" name="name" type="text" required />
    </div>
    <div class="give-field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required />
    </div>
    <fieldset class="give-donor-options">
      <label><input type="radio" name="kind" value="a" required /> A</label>
      <label><input type="radio" name="kind" value="b" required /> B</label>
    </fieldset>
    <div class="give-field" hidden>
      <label for="hiddenField">Hidden</label>
      <input id="hiddenField" name="hiddenField" type="text" required />
    </div>
    <div class="give-field">
      <label for="disabledField">Disabled</label>
      <input id="disabledField" name="disabledField" type="text" required disabled />
    </div>
    <div class="give-field">
      <label for="optional">Optional</label>
      <input id="optional" name="optional" type="text" />
    </div>
    <button type="submit">Go</button>
  </form>`;

const set = (id: string, v: string) => {
  (document.getElementById(id) as HTMLInputElement).value = v;
};
const inv = (id: string) => document.getElementById(id)?.getAttribute("aria-invalid");
const msg = (id: string) => document.getElementById(`${id}-error`)?.textContent?.trim();
const summaryOf = (form: HTMLElement) =>
  form.querySelector('[role="alert"]') as HTMLElement | null;

beforeEach(() => {
  document.body.innerHTML = FORM;
});

describe("shared form validation helper (TASK-225)", () => {
  it("exports validateForm and clearValidation from main.js", () => {
    expect(typeof validateForm).toBe("function");
    expect(typeof clearValidation).toBe("function");
  });

  it("an empty submit flags EVERY invalid control at once, shows a role=alert summary, and focuses the first", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    const res = validateForm(form);
    expect(res.valid).toBe(false);
    expect(inv("name")).toBe("true");
    expect(inv("email")).toBe("true");
    const firstRadio = form.querySelector('input[name="kind"]') as HTMLInputElement;
    expect(firstRadio.getAttribute("aria-invalid")).toBe("true");
    const summary = summaryOf(form);
    expect(summary).not.toBeNull();
    expect(summary?.hidden).toBe(false);
    expect((summary?.textContent ?? "").length).toBeGreaterThan(0);
    // Focus lands on the FIRST invalid field, not the last.
    expect(document.activeElement).toBe(document.getElementById("name"));
  });

  it("skips controls inside a hidden ancestor and disabled controls", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    validateForm(form);
    expect(inv("hiddenField")).not.toBe("true");
    expect(inv("disabledField")).not.toBe("true");
  });

  it("leaves optional empty fields alone", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    validateForm(form);
    expect(inv("optional")).not.toBe("true");
  });

  it("gives a specific message for a missing email and for an invalid email", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    validateForm(form);
    expect(msg("email")?.toLowerCase()).toContain("enter your email address");
    set("email", "not-an-email");
    validateForm(form);
    expect(msg("email")?.toLowerCase()).toContain("valid email address like name@example.com");
  });

  it("uses 'Select an option' for a required radio group and 'This field is required' otherwise", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    validateForm(form);
    const groupMsg =
      document.getElementById("kind-error") ??
      form.querySelector(".give-donor-options .validation-msg");
    expect((groupMsg?.textContent ?? "").toLowerCase()).toContain("select an option");
    expect(msg("name")).toBe("This field is required");
  });

  it("writes only plain, dash-free, blame-free messages", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    set("email", "bad");
    validateForm(form);
    const texts = [...form.querySelectorAll(".validation-msg, [role='alert']")].map(
      (n) => n.textContent ?? "",
    );
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t).not.toMatch(/[–—]/); // no en/em dash
      expect(t).not.toContain("!");
      expect(t.toLowerCase()).not.toContain("you must");
    }
  });

  it("a fully valid form passes, shows no summary, and returns valid:true", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    set("name", "Ada");
    set("email", "ada@example.com");
    (form.querySelector('input[name="kind"]') as HTMLInputElement).checked = true;
    const res = validateForm(form);
    expect(res.valid).toBe(true);
    const summary = summaryOf(form);
    expect(!summary || summary.hidden).toBe(true);
    expect(inv("name")).toBe("false");
    expect(inv("email")).toBe("false");
  });

  it("live-clears a control's invalid state as the user edits it, and hides the summary once all valid", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    // Only Name is left invalid.
    set("email", "ada@example.com");
    (form.querySelector('input[name="kind"]') as HTMLInputElement).checked = true;
    validateForm(form);
    expect(inv("name")).toBe("true");
    const summary = summaryOf(form) as HTMLElement;
    expect(summary.hidden).toBe(false);

    set("name", "Ada");
    document.getElementById("name")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(inv("name")).toBe("false");
    const nameMsg = document.getElementById("name-error") as HTMLElement | null;
    expect(!nameMsg || nameMsg.hidden).toBe(true);
    expect(summary.hidden).toBe(true);
  });

  it("clearValidation resets every flag, inline message, and the summary", () => {
    const form = document.getElementById("f") as HTMLFormElement;
    validateForm(form);
    clearValidation(form);
    expect(inv("name")).toBe("false");
    expect(inv("email")).toBe("false");
    const summary = summaryOf(form) as HTMLElement | null;
    expect(!summary || summary.hidden).toBe(true);
    const nameMsg = document.getElementById("name-error") as HTMLElement | null;
    expect(!nameMsg || nameMsg.hidden).toBe(true);
    expect(form.querySelector(".is-invalid")).toBeNull();
  });

  it("supports opts.summary (an existing node) and opts.extraChecks (cross-field rules)", () => {
    document.body.innerHTML = `
      <form id="f2">
        <p id="mysummary" class="give-step-err"></p>
        <div class="give-field"><label for="a">A</label><input id="a" name="a" type="text" required /></div>
        <div class="give-field"><label for="b">B</label><input id="b" name="b" type="text" /></div>
      </form>`;
    const form = document.getElementById("f2") as HTMLFormElement;
    const summary = document.getElementById("mysummary") as HTMLElement;
    const res = validateForm(form, {
      summary,
      extraChecks: () => {
        const b = document.getElementById("b") as HTMLInputElement;
        return b.value ? [] : [{ control: b, message: "Add B before continuing" }];
      },
    });
    expect(res.valid).toBe(false);
    // The caller-supplied summary is the one refreshed (with the wizard's .show convention).
    expect(summary.hidden).toBe(false);
    expect(summary.classList.contains("show")).toBe(true);
    expect(inv("a")).toBe("true");
    expect(inv("b")).toBe("true");
    expect(document.getElementById("b-error")?.textContent).toContain("Add B before continuing");
    // The helper does not also create a second summary.
    expect(form.querySelectorAll('[role="alert"]').length).toBeLessThanOrEqual(1);
  });
});
