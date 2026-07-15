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
    // The consent checkbox lives in this fieldset...
    expect(fieldset?.querySelector("#emailConsent")).not.toBeNull();
    // ...and the privacy link sits alongside them.
    const link = fieldset?.querySelector('a[href="/privacy"]');
    expect(link, "no visible /privacy link inside .give-contact").not.toBeNull();
    expect((link?.textContent ?? "").toLowerCase()).toContain("privacy");
  });

  it("my-story.html links to /privacy near the final confirm (G2 item 8)", () => {
    const doc = docOf(read("my-story.html"));
    const step3 = doc.querySelector('.give-step[data-step="3"]');
    expect(step3).not.toBeNull();
    const link = step3?.querySelector('a[href="/privacy"]');
    expect(link, "no visible /privacy link inside step 3").not.toBeNull();
    expect((link?.textContent ?? "").toLowerCase()).toContain("privacy");
  });
});

// G2 item 9: privacy.html gets a dedicated "Stories you share with us" section covering the My
// Story feature's own consent/retention model, distinct from the general "Sharing your data" /
// "How long we keep it" sections above (which describe donor/enquiry data, not story submissions).
describe("privacy notice covers My Story submissions (G2 item 9)", () => {
  const doc = docOf(read("privacy.html"));
  const headings = [...doc.querySelectorAll(".privacy-body h2")];
  const storiesHeading = headings.find((h) => /stories you share with us/i.test(h.textContent ?? ""));

  it("has a 'Stories you share with us' section after Sharing your data / How long we keep it", () => {
    expect(storiesHeading, "no 'Stories you share with us' h2 found").not.toBeUndefined();
    const sharingIdx = headings.findIndex((h) => /sharing your data/i.test(h.textContent ?? ""));
    const storiesIdx = headings.indexOf(storiesHeading as Element);
    expect(storiesIdx).toBeGreaterThan(sharingIdx);
  });

  it("covers what's collected, consent as the legal basis, third party permission, the separate database, and retention", () => {
    let node = storiesHeading?.nextElementSibling;
    const parts: string[] = [];
    while (node && node.tagName !== "H2") {
      parts.push(node.textContent ?? "");
      node = node.nextElementSibling;
    }
    const text = parts.join(" ").toLowerCase();
    expect(text).toContain("consent");
    expect(text).toMatch(/third party|children|vulnerable adult/);
    expect(text).toMatch(/separate database/);
    expect(text).toMatch(/archive|permanent/);
    expect(text).toMatch(/withdraw/);
    expect(text).toMatch(/delete/);
  });

  it("gives a real withdraw/delete route (mailto and/or contact form)", () => {
    let node = storiesHeading?.nextElementSibling;
    let hasMailto = false;
    let hasContactLink = false;
    while (node && node.tagName !== "H2") {
      if (node.querySelector('a[href^="mailto:"]')) hasMailto = true;
      if (node.querySelector('a[href="/contact"]')) hasContactLink = true;
      node = node.nextElementSibling;
    }
    expect(hasMailto || hasContactLink).toBe(true);
  });
});
