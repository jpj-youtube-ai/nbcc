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

  it("orders the progress labels as Your story, A little about you, How we can use it", () => {
    const items = [...doc.querySelectorAll("[data-story-steps] .give-progress li")];
    expect(items).toHaveLength(3);
    expect(norm(items[0]?.textContent)).toContain("Your story");
    expect(norm(items[1]?.textContent)).toContain("A little about you");
    expect(norm(items[2]?.textContent)).toContain("How we can use it");
  });

  it("step 1 has the required role choice and required story textarea", () => {
    const step1 = doc.querySelector('.give-step[data-step="1"]');
    expect(step1?.querySelector('[name="submitterRole"]')).not.toBeNull();
    const story = step1?.querySelector('[name="storyText"]');
    expect(story?.tagName).toBe("TEXTAREA");
    expect(story?.hasAttribute("required")).toBe(true);
    expect(step1?.querySelector('[name="shortQuote"]')).not.toBeNull();
  });

  it("step 2 is 'A little about you' and holds only the optional detail fields, none required", () => {
    const step2 = doc.querySelector('.give-step[data-step="2"]');
    expect(norm(step2?.querySelector(".give-step-title")?.textContent)).toBe("A little about you");
    for (const n of ["firstName", "email", "phone", "ageBand", "gender", "town", "recipientType", "heardAbout"]) {
      const el = step2?.querySelector(`[name="${n}"]`);
      expect(el, `#${n} present in step 2`).not.toBeNull();
      expect(el?.hasAttribute("required"), `${n} optional`).toBe(false);
    }
    // No final confirm and no submit button on step 2.
    expect(step2?.querySelector('[name="confirmOver16"]')).toBeNull();
    expect(step2?.querySelector('button[type="submit"]')).toBeNull();
  });

  it("step 3 is 'How we can use it' and holds the consent choice, reveals, contact opt in, retention notice, final confirm and submit", () => {
    const step3 = doc.querySelector('.give-step[data-step="3"]');
    expect(norm(step3?.querySelector(".give-step-title")?.textContent)).toBe("How we can use it");
    expect(step3?.querySelector('[name="useScope"][required]')).not.toBeNull();
    expect(step3?.querySelector('[name="shareFirstName"]')).not.toBeNull();
    expect(step3?.querySelector('[name="shareTown"]')).not.toBeNull();
    expect(step3?.querySelector('[name="thirdPartyConsent"]')).not.toBeNull();
    expect(step3?.querySelector('[name="contactForMore"]')).not.toBeNull();
    const confirm = step3?.querySelector('[name="confirmOver16"]') as HTMLInputElement | null;
    expect(confirm).not.toBeNull();
    expect(confirm?.hasAttribute("required")).toBe(true);
    const submit = step3?.querySelector('button[type="submit"]');
    expect(submit).not.toBeNull();
  });

  it("keeps useScope values as public and internal_only even though labels changed", () => {
    const radios = [...(form?.querySelectorAll('[name="useScope"]') ?? [])] as HTMLInputElement[];
    const values = radios.map((r) => r.value).sort();
    expect(values).toEqual(["internal_only", "public"]);
  });

  it("presents useScope as two selectable consent cards with the specified copy", () => {
    const publicCard = doc.querySelector('label[for="scopePublic"]');
    const internalCard = doc.querySelector('label[for="scopeInternal"]');
    expect(publicCard, "public consent card present").not.toBeNull();
    expect(internalCard, "internal consent card present").not.toBeNull();
    expect(publicCard?.classList.contains("consent-card")).toBe(true);
    expect(internalCard?.classList.contains("consent-card")).toBe(true);

    expect(norm(publicCard?.querySelector(".consent-card-title")?.textContent)).toBe(
      "Yes, you can share my story publicly",
    );
    expect(norm(publicCard?.querySelector(".consent-card-help")?.textContent)).toBe(
      "We may use it on our website, social media, newsletters, press and funding reports. We may share it in full or in part, and edit lightly for length or clarity while keeping your meaning.",
    );

    expect(norm(internalCard?.querySelector(".consent-card-title")?.textContent)).toBe(
      "Please keep it private to NBCC",
    );
    expect(norm(internalCard?.querySelector(".consent-card-help")?.textContent)).toBe(
      "Only the NBCC team will see it, to learn from and to support our funding bids. We will never publish it.",
    );
  });

  it("never shows the word 'internal' in the visible consent card copy", () => {
    const step3 = doc.querySelector('.give-step[data-step="3"]');
    const consentFieldset = step3?.querySelector('fieldset:has([name="useScope"])') ?? step3;
    expect(norm(consentFieldset?.textContent).toLowerCase()).not.toContain("internal");
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

  it("separates the public-use edit clause from the end of the card copy (G2 item 12)", () => {
    const scopePublicLabel = doc.querySelector('label[for="scopePublic"]');
    expect(scopePublicLabel).not.toBeNull();
    // The "we may edit lightly..." clause lives in its own helper paragraph inside the
    // card, not buried as the final clause of the heading.
    const title = norm(scopePublicLabel?.querySelector(".consent-card-title")?.textContent);
    expect(title.toLowerCase()).not.toContain("edit lightly");
    const helper = scopePublicLabel?.querySelector(".consent-card-help");
    expect(helper, "no consent-card-help with the edit clause").not.toBeNull();
    expect(norm(helper?.textContent).toLowerCase()).toContain("edit");
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
  const clickNextOnStep = (step: string) => {
    const stepEl = document.querySelector(`.give-step[data-step="${step}"]`);
    (stepEl?.querySelector("[data-story-next]") as HTMLButtonElement)?.click();
  };
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
  it("advances to step 2 (about you) once role and story are provided", () => {
    check("submitterRole"); // first radio
    setVal("storyText", "The Red Bag brought my daughter such comfort.");
    clickNext();
    expect(visibleStep()).toBe("2");
  });
  it("step 2 (about you) has no required fields, so continuing needs no input", () => {
    check("submitterRole");
    setVal("storyText", "A lovely moment.");
    clickNext();
    expect(visibleStep()).toBe("2");
    clickNextOnStep("2");
    expect(visibleStep()).toBe("3");
  });
  it("reveals the public identifier opt-ins only when 'public' is chosen, in step 3", () => {
    check("submitterRole");
    setVal("storyText", "A lovely moment.");
    clickNext(); // -> step 2
    clickNextOnStep("2"); // -> step 3
    const publicRadio = document.querySelector('[name="useScope"][value="public"]') as HTMLInputElement;
    publicRadio.checked = true;
    publicRadio.dispatchEvent(new Event("change", { bubbles: true }));
    const reveal = document.querySelector('[data-reveal="public"]') as HTMLElement;
    expect(reveal.hidden).toBe(false);
  });

  // G2 item 10: a professional partner must confirm third party permission before
  // the form can submit, mirroring the schema's authoritative refine (src/stories/schema.ts).
  // thirdPartyConsent has no native `required` (it sits in a conditionally hidden reveal,
  // which would break the no-JS path), so this check is explicit business logic in
  // initStorySteps, not the generic required-field validate(). With the step swap, the
  // reveal and the gate both now live in step 3 (final step), not step 2.
  describe("professional partner third party consent gate", () => {
    function chooseProfessionalRoleAndAdvanceToStep3() {
      const professionalRadio = document.querySelector(
        '[name="submitterRole"][value="professional_partner"]',
      ) as HTMLInputElement;
      professionalRadio.checked = true;
      professionalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      setVal("storyText", "A story about a family I support.");
      clickNext(); // -> step 2
      clickNextOnStep("2"); // -> step 3
    }

    it("reveals the third party consent checkbox in step 3 when professional_partner is chosen", () => {
      chooseProfessionalRoleAndAdvanceToStep3();
      expect(visibleStep()).toBe("3");
      const reveal = document.querySelector('[data-reveal="professional"]') as HTMLElement;
      expect(reveal.hidden).toBe(false);
    });

    it("blocks final submit when thirdPartyConsent is not checked", () => {
      chooseProfessionalRoleAndAdvanceToStep3();
      const internalRadio = document.querySelector(
        '[name="useScope"][value="internal_only"]',
      ) as HTMLInputElement;
      internalRadio.checked = true;
      internalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      check("confirmOver16");
      const form = document.getElementById("storyForm") as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(visibleStep()).toBe("3"); // still — thirdPartyConsent unchecked
      const err = document.querySelector('[data-err="3"]');
      expect(err?.classList.contains("show")).toBe(true);
    });

    it("submits once thirdPartyConsent and the final confirm are both checked", () => {
      chooseProfessionalRoleAndAdvanceToStep3();
      const internalRadio = document.querySelector(
        '[name="useScope"][value="internal_only"]',
      ) as HTMLInputElement;
      internalRadio.checked = true;
      internalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      check("thirdPartyConsent");
      check("confirmOver16");
      const status = document.getElementById("storyStatus");
      const form = document.getElementById("storyForm") as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(status?.className).toContain("is-success");
    });

    it("does not require thirdPartyConsent for a non professional submitter role", () => {
      check("submitterRole"); // first radio: "supported"
      setVal("storyText", "A lovely moment.");
      clickNext(); // -> step 2
      clickNextOnStep("2"); // -> step 3
      const internalRadio = document.querySelector(
        '[name="useScope"][value="internal_only"]',
      ) as HTMLInputElement;
      internalRadio.checked = true;
      internalRadio.dispatchEvent(new Event("change", { bubbles: true }));
      check("confirmOver16");
      const status = document.getElementById("storyStatus");
      const form = document.getElementById("storyForm") as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(status?.className).toContain("is-success");
    });
  });

  it("blocks the final submit until confirmOver16 is checked, even with valid useScope", () => {
    check("submitterRole");
    setVal("storyText", "A lovely moment.");
    clickNext(); // -> step 2
    clickNextOnStep("2"); // -> step 3
    const publicRadio = document.querySelector('[name="useScope"][value="public"]') as HTMLInputElement;
    publicRadio.checked = true;
    publicRadio.dispatchEvent(new Event("change", { bubbles: true }));
    const form = document.getElementById("storyForm") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(visibleStep()).toBe("3");
    const err = document.querySelector('[data-err="3"]');
    expect(err?.classList.contains("show")).toBe(true);
  });
});
