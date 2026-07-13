import { describe, it, expect } from "vitest";
import {
  buildBusinessSupporterInviteEmail,
  businessThankYouLink,
} from "../../src/business/invite-email";

// TASK-213: the pure, branded business-supporter thank-you INVITE email builder. DB-free and
// config-free (CLAUDE.md golden rule 5): given a business name + the public site base + the fulfilment
// record's token, it returns { subject, html, text } for the email that carries the private link to
// the /business/thank-you page (TASK-212). Mirrors the pure-builder test style of
// test/unit/thank-you-letter.test.ts. The send + the post-commit webhook trigger are exercised
// separately (test/unit/stripe-webhook-business-supporter.test.ts).

// A hyphen or en/em dash. The invite COPY must contain none of these (task copy constraint); the
// CSS and URLs may (they are not copy), so the guards below scrutinise only the visible prose.
const DASH = /[-–—]/;

describe("businessThankYouLink", () => {
  it("builds the tokenised /business/thank-you URL on the given base", () => {
    expect(businessThankYouLink("https://nbcc.scot", "tok_1")).toBe(
      "https://nbcc.scot/business/thank-you?token=tok_1",
    );
  });

  it("trims trailing slashes on the base and URL-encodes the token", () => {
    expect(businessThankYouLink("https://nbcc.scot/", "a b/c")).toBe(
      "https://nbcc.scot/business/thank-you?token=a%20b%2Fc",
    );
  });
});

describe("buildBusinessSupporterInviteEmail", () => {
  const base = { businessName: "Acme Coffee", baseUrl: "https://nbcc.example", token: "tok123" };

  it("has a warm subject that greets the business", () => {
    const { subject } = buildBusinessSupporterInviteEmail(base);
    expect(subject.length).toBeGreaterThan(0);
    expect(subject).toContain("Acme Coffee");
  });

  it("embeds the correct tokenised thank-you link in the CTA href (env-correct base)", () => {
    const { html } = buildBusinessSupporterInviteEmail(base);
    expect(html).toContain('href="https://nbcc.example/business/thank-you?token=tok123"');
  });

  it("carries one clear call-to-action to choose the thank-you", () => {
    const { html } = buildBusinessSupporterInviteEmail(base);
    expect(html).toContain("Choose how we thank you");
    // exactly one crimson CTA button (a single anchor styled as the pill button)
    const buttons = html.match(/border-radius:999px/g) ?? [];
    expect(buttons).toHaveLength(1);
  });

  it("explains why they are being thanked (a new monthly business supporter)", () => {
    const { html } = buildBusinessSupporterInviteEmail(base);
    expect(html).toContain("business supporter");
  });

  it("uses non-definitive impact language (could help), never a definitive promise", () => {
    const { html, text } = buildBusinessSupporterInviteEmail(base);
    expect(html).toContain("could help");
    expect(text).toContain("could help");
  });

  it("reuses the branded email shell: logo, tagline, color-scheme:light and the maroon/cream palette", () => {
    const { html } = buildBusinessSupporterInviteEmail(base);
    expect(html).toContain("https://nbcc.scot/assets/img/nbcc-logo.png");
    expect(html).toContain("Here all year");
    expect(html).toContain('content="light"');
    expect(html).toContain("#800000"); // maroon page background
    expect(html).toContain("#C02238"); // crimson CTA / heading
    expect(html).toContain("#F8F5EE"); // cream body
  });

  it("carries the charity registration footer and giving contact details", () => {
    const { html, text } = buildBusinessSupporterInviteEmail(base);
    expect(html).toContain("SC047995");
    expect(html).toContain("giving@nbcc.scot");
    expect(html).toContain("01292 811 015");
    expect(text).toContain("SC047995");
  });

  it("produces a plain-text alternative carrying the copy and the raw link, with no HTML tags", () => {
    const { text } = buildBusinessSupporterInviteEmail(base);
    expect(text).toContain("https://nbcc.example/business/thank-you?token=tok123");
    expect(text).toContain("business supporter");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("HTML-escapes the caller-supplied business name (no injection)", () => {
    const { html } = buildBusinessSupporterInviteEmail({
      ...base,
      businessName: "Bob & Sons <script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Bob &amp; Sons &lt;script&gt;");
  });

  it("has NO dashes of any kind in the subject (task copy constraint)", () => {
    const { subject } = buildBusinessSupporterInviteEmail(base);
    expect(subject).not.toMatch(DASH);
  });

  it("has NO dashes of any kind in the visible HTML copy (URLs/CSS excluded)", () => {
    const { html } = buildBusinessSupporterInviteEmail(base);
    // Strip <head> (meta/CSS use hyphens) and every tag (href/style/src attributes go with them),
    // leaving only the visible text nodes — the human copy, which must be dash-free.
    const visible = html
      .replace(/<head[\s\S]*?<\/head>/i, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
    expect(visible).not.toMatch(DASH);
  });

  it("has NO dashes of any kind in the plain-text copy (the raw link line excluded)", () => {
    const { text } = buildBusinessSupporterInviteEmail(base);
    const copyOnly = text
      .split("\n")
      .filter((line) => !line.includes("://"))
      .join("\n");
    expect(copyOnly).not.toMatch(DASH);
  });
});
