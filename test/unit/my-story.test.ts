// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "my-story.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("my story page shell (REQ-NNN)", () => {
  it("has a centred intro whose H1 is 'Share your story'", () => {
    const intro = doc.querySelector("section.story-intro");
    expect(intro).not.toBeNull();
    expect(norm(intro?.querySelector("h1")?.textContent)).toBe("Share your story");
    expect(intro?.querySelector(".rule")).not.toBeNull();
  });
  it("writes the intro dash-free and names NBCC (REQ-031)", () => {
    const intro = norm(doc.querySelector("section.story-intro")?.textContent);
    expect(intro).toContain("NBCC");
    expect(intro).not.toMatch(/[–—-]/);
  });
});

describe("my story form progressively enhances (REQ-NNN)", () => {
  it("has no novalidate and posts to the my-story API without JS", () => {
    const form = doc.querySelector("#storyForm");
    expect(form).not.toBeNull();
    expect(form?.hasAttribute("novalidate")).toBe(false);
    expect(form?.getAttribute("action")).toBe("/api/my-story");
    expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
  });
  it("renders steps 2 and 3 visible (no static hidden) so no-JS is one scrollable form", () => {
    const step2 = doc.querySelector('.give-step[data-step="2"]');
    const step3 = doc.querySelector('.give-step[data-step="3"]');
    expect(step2).not.toBeNull();
    expect(step3).not.toBeNull();
    expect(step2?.hasAttribute("hidden")).toBe(false);
    expect(step3?.hasAttribute("hidden")).toBe(false);
  });
});

describe("my story form structure (REQ-NNN)", () => {
  const form = doc.querySelector("#storyForm");
  const steps = [...(doc.querySelectorAll("[data-story-steps] .give-step") ?? [])];
  const field = (n: string) => form?.querySelector(`[name="${n}"]`);

  it("is a 3-step guided form with a progress list and a polite status region", () => {
    expect(form).not.toBeNull();
    expect(steps).toHaveLength(3);
    expect(doc.querySelector("[data-story-steps] .give-progress")).not.toBeNull();
    expect(doc.querySelector("#storyStatus")?.getAttribute("aria-live")).toBe("polite");
  });
  it("step 1 has the required role choice and required story textarea", () => {
    expect(field("submitterRole")).not.toBeNull();
    const story = field("storyText");
    expect(story?.tagName).toBe("TEXTAREA");
    expect(story?.hasAttribute("required")).toBe(true);
  });
  it("step 2 has the required use-scope choice and default-OFF identifier opt-ins", () => {
    expect(form?.querySelector('[name="useScope"][required]')).not.toBeNull();
    const first = field("shareFirstName") as HTMLInputElement | null;
    const town = field("shareTown") as HTMLInputElement | null;
    expect(first?.getAttribute("type")).toBe("checkbox");
    expect(first?.hasAttribute("checked")).toBe(false);
    expect(town?.hasAttribute("checked")).toBe(false);
  });
  it("step 3 fields are optional except the final confirm; 'how did you hear' is optional", () => {
    for (const n of ["firstName", "email", "phone", "ageBand", "gender", "town", "recipientType", "heardAbout"]) {
      expect(field(n), `#${n} present`).not.toBeNull();
      expect(field(n)?.hasAttribute("required"), `${n} optional`).toBe(false);
    }
    expect((field("confirmOver16") as HTMLInputElement)?.hasAttribute("required")).toBe(true);
  });
  it("has a hidden honeypot field named website", () => {
    const hp = field("website") as HTMLInputElement | null;
    expect(hp).not.toBeNull();
    expect(hp?.closest("[hidden], [aria-hidden='true']") || hp?.hasAttribute("hidden")).toBeTruthy();
  });
  it("writes the retention notice as a permanent archive with a real withdraw/delete route (G2 item 7)", () => {
    const text = norm(form?.textContent).toLowerCase();
    expect(text).toContain("archive");
    expect(text).toContain("withdraw");
    expect(text).toContain("delete");
    // A real route to act on it: a mailto link and a link to the contact form, not
    // just prose asking the submitter to "email us" with no actual link.
    expect(form?.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(form?.querySelector('a[href="/contact"]')).not.toBeNull();
  });
  it("keeps the form copy dash-free (REQ-031)", () => {
    expect(norm(form?.textContent)).not.toMatch(/[–—-]/);
  });
  it("links to the privacy notice near the final confirm, step 3 (G2 item 8)", () => {
    const step3 = doc.querySelector('.give-step[data-step="3"]');
    const link = step3?.querySelector('a[href="/privacy"]');
    expect(link, "no visible /privacy link inside step 3").not.toBeNull();
    expect((link?.textContent ?? "").toLowerCase()).toContain("privacy");
  });
  it("gives purpose microcopy for gender and recipientType, never published (G2 item 11)", () => {
    const genderHelp = field("gender")?.closest(".give-field")?.querySelector(".give-field-help");
    expect(genderHelp, "no give-field-help near gender").not.toBeNull();
    expect(norm(genderHelp?.textContent).toLowerCase()).toContain("never published");

    const recipientFieldset = field("recipientType")?.closest("fieldset");
    const recipientHelp = recipientFieldset?.querySelector(".give-field-help");
    expect(recipientHelp, "no give-field-help near recipientType").not.toBeNull();
    expect(norm(recipientHelp?.textContent).toLowerCase()).toContain("never published");
  });
  it("separates the public-use edit clause from the end of the radio label (G2 item 12)", () => {
    const scopePublicLabel = doc.querySelector('label[for="scopePublic"]');
    expect(scopePublicLabel).not.toBeNull();
    // The "we may edit lightly..." clause is its own sentence/help line, not buried as the
    // final clause inside the radio's single .give-check-text span.
    const checkText = norm(scopePublicLabel?.querySelector(".give-check-text")?.textContent);
    expect(checkText.toLowerCase()).not.toContain("edit lightly");
    const editClause = doc.querySelector(".give-field-help.public-edit-note");
    expect(editClause, "no separated edit-lightly clause").not.toBeNull();
    expect(norm(editClause?.textContent).toLowerCase()).toContain("edit");
  });
});

import { readFileSync as read2 } from "node:fs";
describe("my story CSS is token-only (REQ-NNN)", () => {
  const css = read2(resolve(ROOT, "assets/css/styles.css"), "utf8");
  it("declares a MY STORY PAGE block", () => {
    expect(css).toMatch(/MY STORY PAGE/);
  });
  it("uses no raw hex or rgb in the story block", () => {
    const block = (css.split("MY STORY PAGE")[1] || "").split("/*")[0];
    expect(block.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(block.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});

import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);

describe("my story stepping + validation (jsdom)", () => {
  const { initStorySteps } = require2(resolve(ROOT, "assets/js/main.js"));
  const formHtml = doc.querySelector("[data-story-steps]")?.outerHTML ?? "";
  const setVal = (n: string, v: string) => {
    (document.querySelector(`[name="${n}"]`) as HTMLInputElement | HTMLTextAreaElement).value = v;
  };
  const check = (n: string) => { (document.querySelector(`[name="${n}"]`) as HTMLInputElement).checked = true; };
  const clickNext = () => (document.querySelector("[data-story-next]") as HTMLButtonElement)?.click();
  const visibleStep = () =>
    [...document.querySelectorAll(".give-step")].find((s) => !(s as HTMLElement).hidden)?.getAttribute("data-step");

  beforeEach(() => {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initStorySteps(document, window);
  });

  it("exports initStorySteps", () => {
    expect(typeof initStorySteps).toBe("function");
  });
  it("takes over validation and JS-hides steps 2 and 3 on init", () => {
    const form = document.getElementById("storyForm") as HTMLFormElement;
    expect(form.noValidate).toBe(true);
    const step2 = document.querySelector('.give-step[data-step="2"]') as HTMLElement;
    const step3 = document.querySelector('.give-step[data-step="3"]') as HTMLElement;
    expect(step2.hidden).toBe(true);
    expect(step3.hidden).toBe(true);
  });
  it("starts on step 1 and blocks advancing until required fields are filled", () => {
    expect(visibleStep()).toBe("1");
    clickNext();
    expect(visibleStep()).toBe("1"); // still, story + role missing
    const err = document.querySelector('[data-err="1"]');
    expect(err?.classList.contains("show")).toBe(true);
  });
  it("advances to step 2 once role and story are provided", () => {
    check("submitterRole"); // first radio
    setVal("storyText", "The Red Bag brought my daughter such comfort.");
    clickNext();
    expect(visibleStep()).toBe("2");
  });
  it("reveals the public identifier opt-ins only when 'public' is chosen", () => {
    check("submitterRole");
    setVal("storyText", "A lovely moment.");
    clickNext();
    const publicRadio = document.querySelector('[name="useScope"][value="public"]') as HTMLInputElement;
    publicRadio.checked = true;
    publicRadio.dispatchEvent(new Event("change", { bubbles: true }));
    const reveal = document.querySelector('[data-reveal="public"]') as HTMLElement;
    expect(reveal.hidden).toBe(false);
  });

  // G2 item 10: a professional partner must confirm third party permission before
  // advancing past step 2 (client side mirror of the schema's authoritative refine —
  // src/stories/schema.ts). thirdPartyConsent has no native `required` (it sits in a
  // conditionally hidden reveal, which would break the no-JS path), so this check is
  // explicit business logic in initStorySteps, not the generic required-field validate().
  describe("professional partner third party consent gate", () => {
    function chooseProfessionalRoleAndAdvanceToStep2() {
      const professionalRadio = document.querySelector(
        '[name="submitterRole"][value="professional_partner"]',
      ) as HTMLInputElement;
      professionalRadio.checked = true;
      professionalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      setVal("storyText", "A story about a family I support.");
      clickNext();
    }

    it("reveals the third party consent checkbox when professional_partner is chosen", () => {
      chooseProfessionalRoleAndAdvanceToStep2();
      const reveal = document.querySelector('[data-reveal="professional"]') as HTMLElement;
      expect(reveal.hidden).toBe(false);
    });

    it("blocks advancing from step 2 when thirdPartyConsent is not checked", () => {
      chooseProfessionalRoleAndAdvanceToStep2();
      expect(visibleStep()).toBe("2");
      const internalRadio = document.querySelector(
        '[name="useScope"][value="internal_only"]',
      ) as HTMLInputElement;
      internalRadio.checked = true;
      internalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      clickNext();
      expect(visibleStep()).toBe("2"); // still — thirdPartyConsent unchecked
      const err = document.querySelector('[data-err="2"]');
      expect(err?.classList.contains("show")).toBe(true);
    });

    it("advances from step 2 once thirdPartyConsent is checked", () => {
      chooseProfessionalRoleAndAdvanceToStep2();
      const internalRadio = document.querySelector(
        '[name="useScope"][value="internal_only"]',
      ) as HTMLInputElement;
      internalRadio.checked = true;
      internalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      check("thirdPartyConsent");
      clickNext();
      expect(visibleStep()).toBe("3");
    });

    it("does not require thirdPartyConsent for a non professional submitter role", () => {
      check("submitterRole"); // first radio: "supported"
      setVal("storyText", "A lovely moment.");
      clickNext();
      const internalRadio = document.querySelector(
        '[name="useScope"][value="internal_only"]',
      ) as HTMLInputElement;
      internalRadio.checked = true;
      internalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      clickNext();
      expect(visibleStep()).toBe("3");
    });
  });
});
