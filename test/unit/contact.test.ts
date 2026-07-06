// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-035 (REQ-027): contact.html — the contact page. A centred intro mirroring
// .about-intro/.donate-intro (eyebrow "Contact", base <h1>, .rule, .lede), a
// contact-points block carrying NBCC's details on the shared .card surface
// (info@ general enquiries; 01292 811 015 as a tel link; donations via Jaimie
// Wakefield at giving@; Annbank Village Hall as the base), and a labelled enquiry
// form. Static markup is parsed with jsdom; the validation/submit behaviour is
// exercised against the real initContactForm from main.js, mirroring
// nav.test.ts / give-widget.test.ts. The /api/contact endpoint is REQ-030 (out of
// scope here). Token-only colours, inline aria-hidden SVGs, no <img>, dash-free
// copy with "NBCC" (REQ-031).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "contact.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/styles.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("contact page intro (REQ-027)", () => {
  const intro = doc.querySelector("section.contact-intro");

  it("renders a centred intro mirroring .about-intro/.donate-intro", () => {
    expect(intro).not.toBeNull();
    expect(norm(intro?.querySelector(".eyebrow")?.textContent)).toBe("Contact");
    expect(norm(intro?.querySelector("h1")?.textContent).length).toBeGreaterThan(0);
    expect(intro?.querySelector(".rule")).not.toBeNull();
    expect(norm(intro?.querySelector(".lede")?.textContent).length).toBeGreaterThan(0);
  });

  it("writes 'NBCC' and the full beneficiary phrasing in the intro (REQ-031)", () => {
    const text = norm(intro?.textContent);
    expect(text).toContain("NBCC");
    expect(text).toContain("children, young people and vulnerable adults");
  });
});

describe("contact points (REQ-027)", () => {
  const region = doc.querySelector('main .page-sections[data-region="sections"]');
  const points = [...(region?.querySelectorAll(".contact-points .contact-point") ?? [])];
  const text = norm(region?.textContent);

  it("renders the four contact points on the .card surface", () => {
    expect(points).toHaveLength(4);
    for (const p of points) {
      expect(p.classList.contains("card")).toBe(true);
    }
  });

  it("shows general enquiries email info@nbcc.scot", () => {
    const mail = region?.querySelector('a[href^="mailto:info@nbcc.scot"]');
    expect(mail).not.toBeNull();
    expect(norm(mail?.textContent)).toContain("info@nbcc.scot");
  });

  it("shows the phone as a tel link displayed as 01292 811 015", () => {
    const tel = region?.querySelector('a[href^="tel:"]');
    expect(tel).not.toBeNull();
    expect((tel?.getAttribute("href") ?? "").replace(/\D/g, "")).toContain("441292811015");
    expect(norm(tel?.textContent)).toContain("01292 811 015");
  });

  it("routes donations to Jaimie Wakefield at giving@nbcc.scot", () => {
    const mail = region?.querySelector('a[href^="mailto:giving@nbcc.scot"]');
    expect(mail).not.toBeNull();
    expect(text).toContain("Jaimie Wakefield");
  });

  it("names Annbank Village Hall as the base", () => {
    expect(text).toContain("Annbank Village Hall");
  });

  it("uses inline aria-hidden SVG icons and no <img> (perf budget)", () => {
    const svgs = [...(region?.querySelectorAll("svg") ?? [])];
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) {
      expect(s.getAttribute("aria-hidden")).toBe("true");
    }
    expect(region?.querySelector("img")).toBeNull();
  });

  it("writes the contact copy without dashes (REQ-031)", () => {
    expect(text).not.toMatch(/[–—-]/);
    expect(norm(doc.querySelector("section.contact-intro")?.textContent)).not.toMatch(/[–—-]/);
  });
});

describe("enquiry form markup (REQ-027 / REQ-032)", () => {
  const form = doc.querySelector("#contactForm");

  const labelFor = (id: string) => form?.querySelector(`label[for="${id}"]`);
  const field = (id: string) => form?.querySelector(`#${id}`);

  it("renders the form with a polite status region", () => {
    expect(form).not.toBeNull();
    const status = form?.querySelector("#formStatus");
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });

  it("has a labelled, required First name field", () => {
    expect(norm(labelFor("firstName")?.textContent).toLowerCase()).toContain("first name");
    expect(field("firstName")).not.toBeNull();
    expect(field("firstName")?.hasAttribute("required")).toBe(true);
  });

  it("has a labelled, optional Last name field", () => {
    expect(norm(labelFor("lastName")?.textContent).toLowerCase()).toContain("last name");
    expect(field("lastName")).not.toBeNull();
    expect(field("lastName")?.hasAttribute("required")).toBe(false);
  });

  it("has a labelled, required Email field of type email", () => {
    expect(norm(labelFor("email")?.textContent).toLowerCase()).toContain("email");
    expect(field("email")?.getAttribute("type")).toBe("email");
    expect(field("email")?.hasAttribute("required")).toBe(true);
  });

  it("has a labelled, required Message textarea", () => {
    expect(norm(labelFor("message")?.textContent).toLowerCase()).toContain("message");
    expect(field("message")?.tagName).toBe("TEXTAREA");
    expect(field("message")?.hasAttribute("required")).toBe(true);
  });

  it("wires each required field to its error message via aria-describedby", () => {
    for (const id of ["firstName", "email", "message"]) {
      const describedby = field(id)?.getAttribute("aria-describedby");
      expect(describedby, `missing aria-describedby on #${id}`).toBeTruthy();
      expect(form?.querySelector(`#${describedby}`)).not.toBeNull();
    }
  });

  it("declares a token-only CONTACT PAGE CSS block (no hex/rgb)", () => {
    expect(css).toMatch(/CONTACT PAGE \(REQ-027\)/);
    const blockCss = [
      ...css.matchAll(/\.(?:contact[a-z-]*|field[a-z-]*|form-status|req)\b[^{]*\{[^}]*\}/gi),
    ]
      .map((m) => m[0])
      .join("\n");
    expect(blockCss).not.toBe("");
    expect(blockCss.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(blockCss.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});

describe("contact form behaviour (jsdom)", () => {
  const { initContactForm } = require(resolve(ROOT, "assets/js/main.js"));
  const formHtml = doc.querySelector("#contactForm")?.outerHTML ?? "";

  const set = (id: string, value: string) => {
    (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement).value = value;
  };
  const submit = () =>
    document
      .getElementById("contactForm")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  const status = () => document.getElementById("formStatus")!;
  const invalid = (id: string) => document.getElementById(id)?.getAttribute("aria-invalid");

  beforeEach(() => {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    // Preview behaviour: no backend wired, so no fetch is attempted (REQ-030).
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initContactForm(document, window);
  });

  it("exports initContactForm from the shared script", () => {
    expect(typeof initContactForm).toBe("function");
  });

  it("an empty submit flags the required fields and shows no success", () => {
    submit();
    expect(invalid("firstName")).toBe("true");
    expect(invalid("email")).toBe("true");
    expect(invalid("message")).toBe("true");
    expect(norm(status().textContent)).toBe("");
    expect(status().classList.contains("is-success")).toBe(false);
  });

  it("a malformed email is rejected with no success", () => {
    set("firstName", "Ada");
    set("email", "not-an-email");
    set("message", "Hello there");
    submit();
    expect(invalid("email")).toBe("true");
    expect(invalid("firstName")).toBe("false");
    expect(invalid("message")).toBe("false");
    expect(status().classList.contains("is-success")).toBe(false);
  });

  it("a valid submit shows a visible success message and clears errors", () => {
    set("firstName", "Ada");
    set("email", "ada@example.com");
    set("message", "Hello NBCC, I would love to help.");
    submit();
    const s = status();
    expect(norm(s.textContent).length).toBeGreaterThan(0);
    expect(norm(s.textContent).toLowerCase()).toContain("thank you");
    expect(s.classList.contains("is-success")).toBe(true);
    expect(invalid("email")).toBe("false");
  });
});
