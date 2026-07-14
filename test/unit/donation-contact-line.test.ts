// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-219: the donation-flow pages that lacked a visible "questions?" contact line get one,
// mirroring donate.html's existing help line. A short, warm one-liner carries BOTH the phone
// (a tel: link) and the email (a mailto:giving@nbcc.scot link), so a donor with a question can
// reach a real person. donate.html, business-thank-you.html and contact.html already have their
// own contact route and are out of scope here. Static markup only, parsed with jsdom; mirrors the
// enumeration style of copy-rules and the link assertions of donate-reassurance.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// The three donation-flow pages that previously had no visible phone/email line.
const PAGES = ["thank-you.html", "gift-aid.html", "portal.html"].filter((f) =>
  existsSync(resolve(ROOT, f)),
);

describe.each(PAGES)("donation contact line (TASK-219): %s", (page) => {
  const html = readFileSync(resolve(ROOT, page), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");

  // The contact line is the paragraph that carries BOTH the phone and the email together.
  const line = [...doc.querySelectorAll("p")].find(
    (p) => p.querySelector('a[href^="tel:"]') && p.querySelector('a[href^="mailto:"]'),
  );

  it("renders a single visible line carrying both the phone and the email", () => {
    expect(line, `no contact line with both a tel: and mailto: link on ${page}`).toBeDefined();
    // It lives in the page's main content, not the nav or footer.
    expect(line?.closest("main")).not.toBeNull();
    expect(line?.closest("footer")).toBeNull();
  });

  it("links the phone as a tel: link showing 01292 811 015", () => {
    const tel = line?.querySelector('a[href^="tel:"]');
    expect(tel).not.toBeNull();
    // The href digits normalise to the UK number; the visible text shows it spaced.
    expect((tel?.getAttribute("href") ?? "").replace(/\D/g, "")).toContain("441292811015");
    expect(norm(line?.textContent)).toContain("01292 811 015");
  });

  it("links the email as a mailto:giving@nbcc.scot link", () => {
    const mail = line?.querySelector('a[href^="mailto:giving@nbcc.scot"]');
    expect(mail).not.toBeNull();
    expect(norm(mail?.textContent)).toContain("giving@nbcc.scot");
  });

  it("writes the contact line without dashes and with 'NBCC' in full (REQ-031)", () => {
    const copy = norm(line?.textContent);
    expect(copy).not.toMatch(/[–—-]/);
    expect(copy).not.toContain("NB4CC");
  });
});
