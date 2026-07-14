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
      "We may use it on our website, social media, newsletters, press, and to show funders the difference we make. We may share it in full or in part, and edit lightly for length or clarity while keeping your meaning.",
    );

    expect(norm(internalCard?.querySelector(".consent-card-title")?.textContent)).toBe(
      "Please keep it private to NBCC",
    );
    expect(norm(internalCard?.querySelector(".consent-card-help")?.textContent)).toBe(
      "Only the NBCC team will see it, to learn from and to help us secure the funding that keeps our work going. We will never publish it.",
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

  it("has a visually hidden, polite live region for step announcements (accessibility)", () => {
    const announce = doc.getElementById("storyStepAnnounce");
    expect(announce).not.toBeNull();
    expect(announce?.getAttribute("aria-live")).toBe("polite");
    expect(announce?.classList.contains("sr-only")).toBe(true);
  });

  it("links every field or radio group with real helper text via aria-describedby (accessibility)", () => {
    const pairs: Array<[string, string]> = [
      ["storyText", "storyTextHelp"],
      ["email", "emailHelp"],
      ["phone", "phoneHelp"],
      ["gender", "genderHelp"],
      ["confirmOver16", "confirmOver16Help"],
    ];
    for (const [name, helpId] of pairs) {
      const control = form?.querySelector(`[name="${name}"]`);
      expect(control?.getAttribute("aria-describedby"), `${name} aria-describedby`).toBe(helpId);
      const help = doc.getElementById(helpId);
      expect(help, `#${helpId} exists`).not.toBeNull();
      expect(norm(help?.textContent).length).toBeGreaterThan(0);
    }

    // recipientType is a radio group: every radio in the group points at the same help id.
    const recipientRadios = [...(form?.querySelectorAll('[name="recipientType"]') ?? [])];
    expect(recipientRadios.length).toBeGreaterThan(0);
    recipientRadios.forEach((r) => expect(r.getAttribute("aria-describedby")).toBe("recipientTypeHelp"));
    expect(doc.getElementById("recipientTypeHelp")).not.toBeNull();

    // the two consent cards each describe their own radio.
    const scopePublic = doc.getElementById("scopePublic");
    const scopeInternal = doc.getElementById("scopeInternal");
    expect(scopePublic?.getAttribute("aria-describedby")).toBe("scopePublicHelp");
    expect(scopeInternal?.getAttribute("aria-describedby")).toBe("scopeInternalHelp");
    expect(doc.getElementById("scopePublicHelp")).not.toBeNull();
    expect(doc.getElementById("scopeInternalHelp")).not.toBeNull();
  });

  it("resolves every aria-describedby id in the form to a real element in the document (accessibility)", () => {
    const described = [...(form?.querySelectorAll("[aria-describedby]") ?? [])] as HTMLElement[];
    expect(described.length).toBeGreaterThan(0);
    described.forEach((el) => {
      const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      ids.forEach((id) => expect(doc.getElementById(id), `#${id} referenced by aria-describedby`).not.toBeNull());
    });
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

  function mockFetchOnce(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
    const fn = () => Promise.resolve(response as Response);
    (window as unknown as { fetch: unknown }).fetch = fn;
    return fn;
  }

  beforeEach(() => {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    // Default: a mocked successful save, so tests that submit the form (but are not
    // themselves testing network behaviour) still observe the real post-fetch success
    // path introduced by Fix 1, rather than the pre existing fire and forget one.
    mockFetchOnce({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    initStorySteps(document, window);
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

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

  it("flags every missing step-1 field at once with a role=alert summary (TASK-225)", () => {
    clickNext();
    expect(document.querySelector('[name="submitterRole"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("storyText")?.getAttribute("aria-invalid")).toBe("true");
    const err = document.querySelector('[data-err="1"]') as HTMLElement;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.classList.contains("show")).toBe(true);
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
  it("announces the current step and its title in the sr-only live region as steps change (accessibility)", () => {
    const announce = document.getElementById("storyStepAnnounce");
    // The silent initial load does NOT announce (the live region fires only on real,
    // user-triggered step changes, so a screen reader is not talked over on page load).
    expect(announce?.textContent).toBe("");
    check("submitterRole");
    setVal("storyText", "A lovely moment.");
    clickNext();
    expect(announce?.textContent).toBe("Step 2 of 3, A little about you");
    clickNextOnStep("2");
    expect(announce?.textContent).toBe("Step 3 of 3, How we can use it");
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

    it("blocks final submit when thirdPartyConsent is not checked, with a specific permission message", () => {
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
      // FIX 4: the block names the permission tick specifically, not just a generic
      // "check the confirmation" message, via a dedicated error next to the checkbox.
      const specific = document.getElementById("thirdPartyConsentErr");
      expect(specific?.classList.contains("show")).toBe(true);
      expect((specific?.textContent ?? "").toLowerCase()).toContain("permission");
    });

    it("submits once thirdPartyConsent and the final confirm are both checked", async () => {
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
      await flush();
      expect(status?.className).toContain("is-success");
    });

    it("does not require thirdPartyConsent for a non professional submitter role", async () => {
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
      await flush();
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

// FIX 1 (CRITICAL): the success message must reflect a REAL save, not a fire and forget
// POST. Covers the awaited fetch path: 200 -> success + reset, 400 -> kind error + form
// kept + button re-enabled, 500/network error -> apologetic error + form kept.
describe("my story submit reflects the real server response (FIX 1)", () => {
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
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function fillValidStoryAndAdvanceToStep3() {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    check("submitterRole");
    setVal("storyText", "A lovely moment that made a real difference.");
    clickNext(); // -> step 2
    clickNextOnStep("2"); // -> step 3
    const internalRadio = document.querySelector(
      '[name="useScope"][value="internal_only"]',
    ) as HTMLInputElement;
    internalRadio.checked = true;
    internalRadio.dispatchEvent(new Event("change", { bubbles: true }));
    check("confirmOver16");
  }

  function submitForm() {
    const form = document.getElementById("storyForm") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return form;
  }

  it("disables the submit button and shows an in-flight status the instant a valid submit fires", () => {
    fillValidStoryAndAdvanceToStep3();
    (window as unknown as { fetch: unknown }).fetch = () => new Promise(() => {}); // never resolves
    initStorySteps(document, window);
    submitForm();
    const submitBtn = document.querySelector("[data-story-submit]") as HTMLButtonElement;
    const status = document.getElementById("storyStatus");
    expect(submitBtn.disabled).toBe(true);
    expect(status?.textContent).toMatch(/sharing your story/i);
  });

  it("on a mocked 200 response: shows the success message and resets the form", async () => {
    fillValidStoryAndAdvanceToStep3();
    (window as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
    initStorySteps(document, window);
    const storyTextBefore = (document.getElementById("storyText") as HTMLTextAreaElement);
    submitForm();
    await flush();
    const status = document.getElementById("storyStatus");
    expect(status?.className).toContain("is-success");
    expect(status?.textContent).toMatch(/thank you/i);
    expect(storyTextBefore.value).toBe("");
    const submitBtn = document.querySelector("[data-story-submit]") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it("on a mocked 400 response: shows the server's error message, keeps the form filled, and re-enables the button", async () => {
    fillValidStoryAndAdvanceToStep3();
    (window as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Please check your story details and try again" }),
      } as Response);
    initStorySteps(document, window);
    const storyText = document.getElementById("storyText") as HTMLTextAreaElement;
    const valueBeforeSubmit = storyText.value;
    submitForm();
    await flush();
    const status = document.getElementById("storyStatus");
    expect(status?.className).not.toContain("is-success");
    expect(status?.className).toContain("is-error");
    expect(status?.textContent).toContain("Please check your story details and try again");
    expect(storyText.value).toBe(valueBeforeSubmit); // form NOT reset
    const submitBtn = document.querySelector("[data-story-submit]") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false); // re-enabled
  });

  it("on a mocked 400 with no JSON error body: falls back to a kind generic message", async () => {
    fillValidStoryAndAdvanceToStep3();
    (window as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve({ ok: false, status: 400, json: () => Promise.reject(new Error("no body")) } as Response);
    initStorySteps(document, window);
    submitForm();
    await flush();
    const status = document.getElementById("storyStatus");
    expect(status?.className).toContain("is-error");
    expect(status?.textContent).toMatch(/check your story/i);
  });

  it("on a mocked 500 response: shows the apologetic retry message and does not reset the form", async () => {
    fillValidStoryAndAdvanceToStep3();
    (window as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) } as Response);
    initStorySteps(document, window);
    const storyText = document.getElementById("storyText") as HTMLTextAreaElement;
    const valueBeforeSubmit = storyText.value;
    submitForm();
    await flush();
    const status = document.getElementById("storyStatus");
    expect(status?.className).toContain("is-error");
    expect(status?.textContent).toMatch(/could not save your story/i);
    expect(storyText.value).toBe(valueBeforeSubmit);
  });

  it("on a network error (rejected fetch): shows the apologetic retry message and does not reset the form", async () => {
    fillValidStoryAndAdvanceToStep3();
    (window as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error("network down"));
    initStorySteps(document, window);
    const storyText = document.getElementById("storyText") as HTMLTextAreaElement;
    const valueBeforeSubmit = storyText.value;
    submitForm();
    await flush();
    const status = document.getElementById("storyStatus");
    expect(status?.className).toContain("is-error");
    expect(status?.textContent).toMatch(/could not save your story/i);
    expect(storyText.value).toBe(valueBeforeSubmit);
  });

  it("rejects a whitespace only story (client side, before any fetch happens)", () => {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    let fetchCalled = false;
    (window as unknown as { fetch: unknown }).fetch = () => {
      fetchCalled = true;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
    };
    initStorySteps(document, window);
    check("submitterRole");
    setVal("storyText", "   \n\t  "); // whitespace only
    clickNext();
    // still on step 1: whitespace-only trims to empty, so required validation blocks it.
    const step1 = document.querySelector('.give-step[data-step="1"]') as HTMLElement;
    expect(step1.hidden).toBe(false);
    expect(fetchCalled).toBe(false);
  });

  it("when win.fetch is unavailable, does not preventDefault and shows no fake success", () => {
    fillValidStoryAndAdvanceToStep3();
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initStorySteps(document, window);
    const form = submitForm();
    const status = document.getElementById("storyStatus");
    expect(form.defaultPrevented ?? false).toBe(false);
    expect(status?.className ?? "").not.toContain("is-success");
  });
});

// FIX 5: contactForMore nudge — ticked with both email and phone blank on step 2.
describe("my story contactForMore nudge (FIX 5)", () => {
  const { initStorySteps } = require2(resolve(ROOT, "assets/js/main.js"));
  const formHtml = doc.querySelector("[data-story-steps]")?.outerHTML ?? "";
  const setVal = (n: string, v: string) => {
    (document.querySelector(`[name="${n}"]`) as HTMLInputElement | HTMLTextAreaElement).value = v;
  };
  const check = (n: string) => { (document.querySelector(`[name="${n}"]`) as HTMLInputElement).checked = true; };

  beforeEach(() => {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initStorySteps(document, window);
  });

  it("shows a gentle note when contactForMore is ticked but email and phone are both blank", () => {
    const contactForMore = document.getElementById("contactForMore") as HTMLInputElement;
    check("contactForMore");
    contactForMore.dispatchEvent(new Event("change", { bubbles: true }));
    const nudge = document.getElementById("contactForMoreNudge");
    expect(nudge?.hidden).toBe(false);
  });

  it("does not show the note when an email is present", () => {
    setVal("email", "person@example.com");
    const contactForMore = document.getElementById("contactForMore") as HTMLInputElement;
    check("contactForMore");
    contactForMore.dispatchEvent(new Event("change", { bubbles: true }));
    const nudge = document.getElementById("contactForMoreNudge");
    expect(nudge?.hidden).toBe(true);
  });

  it("does not block submit; it is a non blocking client side note only", () => {
    const contactForMore = document.getElementById("contactForMore") as HTMLInputElement;
    check("contactForMore");
    contactForMore.dispatchEvent(new Event("change", { bubbles: true }));
    const nudge = document.getElementById("contactForMoreNudge");
    expect(nudge?.getAttribute("role")).not.toBe("alert");
  });
});
