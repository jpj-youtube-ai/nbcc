import { describe, it, expect } from "vitest";
import { buildPerksDeliveryEmail, perksLinks, perksLede } from "../../src/business/perks-email";

// TASK-441: the badge and certificate email, sent the next weekday morning instead of seconds after
// a business submits the form. The links moved here out of the confirmation, so the assertions that
// used to live in business-capture-confirmation-email.test.ts live here now.

const base = {
  businessName: "RMC Double Glazing (Ayr) Ltd",
  wantBadge: true,
  wantCertificate: true,
  certificateByPost: false,
  token: "tok123",
  baseUrl: "https://nbcc.example",
};

describe("the links it carries", () => {
  it("includes the badge and certificate links on the given base", () => {
    const { html, text } = buildPerksDeliveryEmail(base);
    expect(html).toContain('href="https://nbcc.example/assets/img/nbcc-supporter-badge.svg"');
    expect(html).toContain('href="https://nbcc.example/business/certificate/tok123"');
    expect(text).toContain("https://nbcc.example/business/certificate/tok123");
  });

  it("trims a trailing slash on the base and URL-encodes the token", () => {
    const { html } = buildPerksDeliveryEmail({ ...base, baseUrl: "https://nbcc.example/", token: "a b" });
    expect(html).toContain('href="https://nbcc.example/business/certificate/a%20b"');
  });

  it("carries only what they asked for", () => {
    expect(perksLinks({ ...base, wantCertificate: false }).map((l) => l.label)).toEqual([
      "Download your badge",
    ]);
    expect(perksLinks({ ...base, wantBadge: false }).map((l) => l.label)).toEqual([
      "Download your certificate",
    ]);
  });
});

describe("what it says it is", () => {
  it("names both when they asked for both", () => {
    expect(perksLede(base)).toMatch(/badge and your certificate/i);
    expect(buildPerksDeliveryEmail(base).subject).toContain("badge and certificate");
  });

  it("names only the badge when that is all they wanted", () => {
    const badgeOnly = { ...base, wantCertificate: false };
    expect(perksLede(badgeOnly)).toMatch(/badge is ready/i);
    expect(buildPerksDeliveryEmail(badgeOnly).subject).toMatch(/badge$/);
  });

  it("names only the certificate when that is all they wanted", () => {
    const certOnly = { ...base, wantBadge: false };
    expect(perksLede(certOnly)).toMatch(/certificate is ready/i);
    expect(buildPerksDeliveryEmail(certOnly).subject).toMatch(/certificate$/);
  });

  it("mentions the posted copy only when they chose post", () => {
    expect(buildPerksDeliveryEmail({ ...base, certificateByPost: true }).text).toMatch(/in the post/i);
    expect(buildPerksDeliveryEmail(base).text).not.toMatch(/in the post/i);
  });
});

describe("how it reads", () => {
  // The brief was that it should feel like a person put it together rather than a machine firing
  // back. It says so in its own words instead of announcing itself as automatic.
  it("sounds like somebody prepared it, and never says it is automatic", () => {
    const { text } = buildPerksDeliveryEmail(base);
    expect(text).toMatch(/we have put these together for you/i);
    expect(text).not.toMatch(/automatic|automated|do not reply|no.reply/i);
  });

  // But it does NOT sign a named person to something nobody read. That is the line
  // src/business/auto-thank-you.ts draws, and warmth is a matter of how you write rather than of
  // claiming an author.
  it("signs as the team, never as a person who did not write it", () => {
    const { text } = buildPerksDeliveryEmail(base);
    expect(text).toContain("The Night Before Christmas Campaign team");
  });

  it("offers a way to put it right, because a certificate in the wrong name is worth fixing", () => {
    expect(buildPerksDeliveryEmail(base).text).toMatch(/reply to this email/i);
  });

  // Inherited from the approved email family: impact language must stay non-definitive (Code of
  // Fundraising Practice), and the copy carries no dashes of any kind.
  it("keeps impact language non-definitive", () => {
    expect(buildPerksDeliveryEmail(base).text).toMatch(/could help/i);
  });

  it("contains no dashes anywhere in the human copy", () => {
    const { text, subject } = buildPerksDeliveryEmail(base);
    expect(subject).not.toMatch(/[-–—]/);
    expect(text).not.toMatch(/[–—]/);
    // The plain-text body carries URLs, which legitimately contain hyphens; the prose does not.
    const prose = text
      .split("\n")
      .filter((l) => !l.includes("http") && !l.includes("@"))
      .join("\n");
    expect(prose).not.toMatch(/-/);
  });

  it("keeps dark-mode clients from inverting the palette", () => {
    expect(buildPerksDeliveryEmail(base).html).toContain('name="color-scheme" content="light"');
  });

  it("escapes a business name that carries markup", () => {
    const nasty = buildPerksDeliveryEmail({ ...base, businessName: 'A <b>"co"</b> & Sons' });
    expect(nasty.html).toContain("&lt;b&gt;");
    expect(nasty.html).toContain("&amp;");
    expect(nasty.html).not.toContain("<b>");
  });
});
