// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderGiftAidForm, renderGiftAidMessage } from "../../src/declarations/render";

// TASK-076: the pure server-side rendering of the Gift Aid completion page over the real
// gift-aid.html template. DB-free (no pool/config/clock).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const template = readFileSync(resolve(ROOT, "gift-aid.html"), "utf8");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("renderGiftAidForm", () => {
  const html = renderGiftAidForm(template, {
    token: "tok-abc-123",
    wordingSnapshot: "I want to Gift Aid my donation. I am a UK taxpayer & understand the rest.",
  });
  const doc = new DOMParser().parseFromString(html, "text/html");

  it("injects the donor's token into the form action (token-scoped POST)", () => {
    const form = doc.querySelector("form.giftaid-form");
    expect(form?.getAttribute("action")).toBe("/api/gift-aid/tok-abc-123");
    expect(html).not.toContain("__GIFT_AID_TOKEN__");
  });

  it("renders the verbatim wording, HTML-escaped", () => {
    const statement = doc.querySelector("#giftAidStatement");
    expect(norm(statement?.textContent)).toBe(
      "I want to Gift Aid my donation. I am a UK taxpayer & understand the rest.",
    );
    // The & is escaped in the source HTML.
    expect(html).toContain("&amp; understand");
  });

  it("keeps the declaration fieldset inputs", () => {
    for (const name of ["firstName", "lastName", "houseNameNumber", "address", "postcode", "nonUk"]) {
      expect(doc.querySelector(`[name="${name}"]`), `missing input ${name}`).not.toBeNull();
    }
  });
});

describe("renderGiftAidMessage", () => {
  it("replaces the form region with a message and drops the form", () => {
    const html = renderGiftAidMessage(template, { heading: "Gift Aid added, thank you", body: "All done." });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("form.giftaid-form")).toBeNull();
    expect(norm(doc.querySelector('[data-region="giftaid"] h2')?.textContent)).toBe(
      "Gift Aid added, thank you",
    );
    // The page shell (nav/footer) survives.
    expect(doc.querySelector("header.nav")).not.toBeNull();
    expect(doc.querySelector("footer.site-footer")).not.toBeNull();
  });
});
