// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRedirects } from "../../src/routes/site";

// TASK-111 (REQ-064): the privacy notice page must be reachable at /privacy and linked from the two
// places that capture personal data with consent — the contact enquiry form (REQ-027) and the donate
// give-widget contact-capture fieldset (REQ-039). The sitewide seo/accessibility/copy-rules/clean-url
// guards already cover privacy.html once it is registered in their page lists (see those tests); this
// asserts the two consent-adjacent links and the clean-URL wiring specifically.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const docOf = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("privacy notice clean URL (TASK-111)", () => {
  const rules = parseRedirects(read("_redirects"));

  it("serves privacy.html at /privacy and canonicalises the raw path", () => {
    expect(rules).toContainEqual({ from: "/privacy", to: "/privacy.html", status: "200" });
    expect(rules).toContainEqual({ from: "/privacy.html", to: "/privacy", status: "301!" });
  });

  it("bakes privacy.html into the runtime image (Dockerfile COPY)", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toMatch(/COPY[^\n]*\bprivacy\.html\b/);
  });
});

describe("privacy notice links next to consent controls (REQ-064)", () => {
  it("contact.html links to /privacy inside the enquiry form, near the consent controls", () => {
    const doc = docOf(read("contact.html"));
    const form = doc.getElementById("contactForm");
    expect(form).not.toBeNull();
    const link = form?.querySelector('a[href="/privacy"]');
    expect(link, "no visible /privacy link inside #contactForm").not.toBeNull();
    expect((link?.textContent ?? "").toLowerCase()).toContain("privacy");
  });

  it("donate.html links to /privacy inside the give-contact consent fieldset (near the consent checkboxes)", () => {
    const doc = docOf(read("donate.html"));
    const fieldset = doc.querySelector("fieldset.give-contact");
    expect(fieldset).not.toBeNull();
    // The consent checkboxes live in this fieldset...
    expect(fieldset?.querySelector("#emailConsent")).not.toBeNull();
    expect(fieldset?.querySelector("#anonymousDonor")).not.toBeNull();
    // ...and the privacy link sits alongside them.
    const link = fieldset?.querySelector('a[href="/privacy"]');
    expect(link, "no visible /privacy link inside .give-contact").not.toBeNull();
    expect((link?.textContent ?? "").toLowerCase()).toContain("privacy");
  });
});
