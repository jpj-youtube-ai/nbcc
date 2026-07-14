import { describe, it, expect } from "vitest";
import { buildCaptureConfirmationEmail } from "../../src/business/capture-confirmation-email";

// TASK-221: the pure, branded "here is what you chose" CONFIRMATION email a business supporter gets
// after submitting their recognition choices (from the inline thank-you form OR the emailed token
// link). DB-free and config-free (CLAUDE.md golden rule 5): given the business name, band perks, the
// captured choices, the token and the public base, it returns { subject, html, text }. Mirrors the
// pure-builder test style of test/unit/business-invite-email.test.ts. The send + its best-effort
// trigger from postFulfilment are exercised separately (business-fulfilment-api.test.ts).

// A hyphen or en/em dash. The confirmation COPY must contain none of these (task copy constraint); the
// CSS and URLs may (they are not copy), so the guards below scrutinise only the visible prose.
const DASH = /[-–—]/;

const PLATINUM_PERKS = {
  supportersListing: true,
  newsletter: true,
  socialThankYou: true,
  digitalBadge: true,
  certificate: true,
};
const BRONZE_PERKS = {
  supportersListing: true,
  newsletter: true,
  socialThankYou: false,
  digitalBadge: false,
  certificate: false,
};

// A full platinum yes-to-everything set of choices.
const platinumYes = {
  listOnSupporters: true,
  creditName: "Gorilla Jetwash",
  website: "gorillajetwash.co.uk",
  socials: "@gorilla",
  wantSocial: true,
  wantBadge: true,
  wantCertificate: true,
  certificateDelivery: "download" as const,
};

const base = {
  businessName: "Gorilla Jetwash",
  perks: PLATINUM_PERKS,
  preferences: platinumYes,
  token: "tok123",
  baseUrl: "https://nbcc.example",
};

describe("buildCaptureConfirmationEmail — subject + shell", () => {
  it("has a warm subject that greets the business", () => {
    const { subject } = buildCaptureConfirmationEmail(base);
    expect(subject.length).toBeGreaterThan(0);
    expect(subject).toContain("Gorilla Jetwash");
  });

  it("reuses the branded email shell: logo, tagline, color-scheme:light and the maroon/cream palette", () => {
    const { html } = buildCaptureConfirmationEmail(base);
    expect(html).toContain("https://nbcc.scot/assets/img/nbcc-logo.png");
    expect(html).toContain("Here all year");
    expect(html).toContain('content="light"');
    expect(html).toContain("#800000"); // maroon page background
    expect(html).toContain("#C02238"); // crimson heading / CTA
    expect(html).toContain("#F8F5EE"); // cream body
  });

  it("carries the charity registration footer and giving contact details", () => {
    const { html, text } = buildCaptureConfirmationEmail(base);
    expect(html).toContain("SC047995");
    expect(html).toContain("giving@nbcc.scot");
    expect(html).toContain("01292 811 015");
    expect(text).toContain("SC047995");
  });
});

describe("buildCaptureConfirmationEmail — lists the chosen options", () => {
  it("reflects the supporters-page choice with the chosen credit name", () => {
    const { html, text } = buildCaptureConfirmationEmail(base);
    expect(html).toContain("Supporters page as Gorilla Jetwash");
    expect(text).toContain("Supporters page as Gorilla Jetwash");
  });

  it("reflects the social + badge + certificate choices when opted in (platinum)", () => {
    const { html } = buildCaptureConfirmationEmail(base);
    expect(html).toContain("Facebook and Instagram");
    expect(html).toContain("@gorilla"); // tagged handle
    expect(html).toContain("badge is ready");
    expect(html).toContain("certificate is ready");
  });

  it("reflects the declined choices in plain language", () => {
    const declined = {
      ...base,
      preferences: {
        listOnSupporters: false,
        creditName: null,
        website: null,
        socials: null,
        wantSocial: false,
        wantBadge: false,
        wantCertificate: false,
        certificateDelivery: null,
      },
    };
    const { text } = buildCaptureConfirmationEmail(declined);
    expect(text).toContain("keep your business details private");
    expect(text).toContain("No social media thank you");
    expect(text).toContain("No digital badge");
    expect(text).toContain("No certificate");
  });

  it("always confirms the supporter newsletter", () => {
    const { html } = buildCaptureConfirmationEmail(base);
    expect(html).toContain("supporter newsletter");
  });

  it("omits the platinum-only lines for a bronze supporter", () => {
    const bronze = {
      businessName: "Small Bakery Ltd",
      perks: BRONZE_PERKS,
      preferences: { ...platinumYes, businessName: undefined },
      token: "tok_bronze",
      baseUrl: "https://nbcc.example",
    };
    const { html } = buildCaptureConfirmationEmail(bronze);
    expect(html).not.toContain("Facebook and Instagram");
    expect(html).not.toContain("badge is ready");
    expect(html).not.toContain("certificate is ready");
    // Bronze still gets the supporters-page + newsletter lines.
    expect(html).toContain("Supporters page");
    expect(html).toContain("supporter newsletter");
  });
});

describe("buildCaptureConfirmationEmail — download links (gated, absolute)", () => {
  it("includes the badge + certificate download links a platinum opt-in earns, on the given base", () => {
    const { html, text } = buildCaptureConfirmationEmail(base);
    expect(html).toContain('href="https://nbcc.example/assets/img/nbcc-supporter-badge.svg"');
    expect(html).toContain('href="https://nbcc.example/business/certificate/tok123"');
    expect(text).toContain("https://nbcc.example/business/certificate/tok123");
  });

  it("includes NO download links when the supporter declined the badge and certificate", () => {
    const noExtras = {
      ...base,
      preferences: { ...platinumYes, wantBadge: false, wantCertificate: false },
    };
    const { html } = buildCaptureConfirmationEmail(noExtras);
    expect(html).not.toContain("nbcc-supporter-badge.svg");
    expect(html).not.toContain("/business/certificate/");
  });

  it("includes NO platinum download links for a bronze supporter (not entitled)", () => {
    const bronze = {
      businessName: "Small Bakery Ltd",
      perks: BRONZE_PERKS,
      preferences: platinumYes,
      token: "tok_bronze",
      baseUrl: "https://nbcc.example",
    };
    const { html } = buildCaptureConfirmationEmail(bronze);
    expect(html).not.toContain("nbcc-supporter-badge.svg");
    expect(html).not.toContain("/business/certificate/");
  });

  it("trims a trailing slash on the base and URL-encodes the token in the certificate link", () => {
    const { html } = buildCaptureConfirmationEmail({ ...base, baseUrl: "https://nbcc.example/", token: "a b" });
    expect(html).toContain('href="https://nbcc.example/business/certificate/a%20b"');
  });
});

describe("buildCaptureConfirmationEmail — impact + safety", () => {
  it("uses non-definitive impact language (could help), never a definitive promise", () => {
    const { html, text } = buildCaptureConfirmationEmail(base);
    expect(html).toContain("could help");
    expect(text).toContain("could help");
    expect(html).not.toMatch(/£\s*\d+\s+provides/i);
  });

  it("HTML-escapes the caller-supplied business + credit name (no injection)", () => {
    const evil = {
      ...base,
      businessName: "Bob & Sons <script>alert(1)</script>",
      preferences: { ...platinumYes, creditName: "Bob & Sons <img src=x>" },
    };
    const { html } = buildCaptureConfirmationEmail(evil);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Bob &amp; Sons &lt;script&gt;");
    expect(html).not.toContain("<img src=x>");
  });

  it("produces a plain-text alternative carrying the copy, with no HTML tags", () => {
    const { text } = buildCaptureConfirmationEmail(base);
    expect(text).toContain("You are all set");
    expect(text).not.toMatch(/<[a-z]/i);
  });
});

describe("buildCaptureConfirmationEmail — no dashes in copy (task constraint)", () => {
  it("has NO dashes of any kind in the subject", () => {
    const { subject } = buildCaptureConfirmationEmail(base);
    expect(subject).not.toMatch(DASH);
  });

  it("has NO dashes of any kind in the visible HTML copy (URLs/CSS excluded)", () => {
    const { html } = buildCaptureConfirmationEmail(base);
    const visible = html
      .replace(/<head[\s\S]*?<\/head>/i, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
    expect(visible).not.toMatch(DASH);
  });

  it("has NO dashes of any kind in the plain-text copy (raw link lines excluded)", () => {
    const { text } = buildCaptureConfirmationEmail(base);
    const copyOnly = text
      .split("\n")
      .filter((line) => !line.includes("://"))
      .join("\n");
    expect(copyOnly).not.toMatch(DASH);
  });
});
