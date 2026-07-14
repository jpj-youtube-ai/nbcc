import { describe, it, expect } from "vitest";
import { buildBusinessSupporterReminderEmail } from "../../src/business/reminder-email";

// TASK-222: the pure, branded business-supporter thank-you REMINDER email builder. DB-free and
// config-free (CLAUDE.md golden rule 5): given a business name + the public site base + the fulfilment
// record's token + which stage is due (1 = 5-day, 2 = 14-day), it returns { subject, html, text } for
// the nudge that re-links to the private /business/thank-you page. Mirrors the pure-builder test style
// of test/unit/business-invite-email.test.ts. Both stages must be warm, low-pressure, non-definitive
// ("could help") and dash-free, for ALL bands.

// A hyphen or en/em dash. The reminder COPY must contain none of these (task copy constraint); the CSS
// and URLs may (they are not copy), so the guards below scrutinise only the visible prose.
const DASH = /[-–—]/;
const STAGES = [1, 2] as const;

describe.each(STAGES)("buildBusinessSupporterReminderEmail — stage %i (shared warmth + constraints)", (stage) => {
  const base = { businessName: "Acme Coffee", baseUrl: "https://nbcc.example", token: "tok123", stage } as const;

  it("has a warm subject that greets the business", () => {
    const { subject } = buildBusinessSupporterReminderEmail(base);
    expect(subject.length).toBeGreaterThan(0);
    expect(subject).toContain("Acme Coffee");
  });

  it("embeds the correct tokenised thank-you link in the CTA href (env-correct base)", () => {
    const { html } = buildBusinessSupporterReminderEmail(base);
    expect(html).toContain('href="https://nbcc.example/business/thank-you?token=tok123"');
  });

  it("carries exactly one clear call-to-action to choose the thank-you", () => {
    const { html } = buildBusinessSupporterReminderEmail(base);
    expect(html).toContain("Choose how we thank you");
    // exactly one crimson CTA button (a single anchor styled as the pill button)
    const buttons = html.match(/border-radius:999px/g) ?? [];
    expect(buttons).toHaveLength(1);
  });

  it("thanks them as a monthly business supporter (explains why they hear from us)", () => {
    const { html, text } = buildBusinessSupporterReminderEmail(base);
    expect(html).toContain("business supporter");
    expect(text).toContain("business supporter");
  });

  it("uses non-definitive impact language (could help), never a definitive promise", () => {
    const { html, text } = buildBusinessSupporterReminderEmail(base);
    expect(html).toContain("could help");
    expect(text).toContain("could help");
    // Guard against the banned definitive shape ("£X provides Y").
    expect(html).not.toMatch(/£\d[\d.,]*\s+provides/i);
  });

  it("reuses the branded email shell: logo, tagline, color-scheme:light and the maroon/cream palette", () => {
    const { html } = buildBusinessSupporterReminderEmail(base);
    expect(html).toContain("https://nbcc.scot/assets/img/nbcc-logo.png");
    expect(html).toContain("Here all year");
    expect(html).toContain('content="light"');
    expect(html).toContain("#800000"); // maroon page background
    expect(html).toContain("#C02238"); // crimson CTA / heading
    expect(html).toContain("#F8F5EE"); // cream body
  });

  it("carries the charity registration footer and giving contact details (phone + giving@)", () => {
    const { html, text } = buildBusinessSupporterReminderEmail(base);
    expect(html).toContain("SC047995");
    expect(html).toContain("giving@nbcc.scot");
    expect(html).toContain("01292 811 015");
    expect(text).toContain("SC047995");
    expect(text).toContain("giving@nbcc.scot");
  });

  it("produces a plain-text alternative carrying the copy and the raw link, with no HTML tags", () => {
    const { text } = buildBusinessSupporterReminderEmail(base);
    expect(text).toContain("https://nbcc.example/business/thank-you?token=tok123");
    expect(text).toContain("business supporter");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("HTML-escapes the caller-supplied business name (no injection)", () => {
    const { html } = buildBusinessSupporterReminderEmail({
      ...base,
      businessName: "Bob & Sons <script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Bob &amp; Sons &lt;script&gt;");
  });

  it("has NO dashes of any kind in the subject (task copy constraint)", () => {
    const { subject } = buildBusinessSupporterReminderEmail(base);
    expect(subject).not.toMatch(DASH);
  });

  it("has NO dashes of any kind in the visible HTML copy (URLs/CSS excluded)", () => {
    const { html } = buildBusinessSupporterReminderEmail(base);
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
    const { text } = buildBusinessSupporterReminderEmail(base);
    const copyOnly = text
      .split("\n")
      .filter((line) => !line.includes("://"))
      .join("\n");
    expect(copyOnly).not.toMatch(DASH);
  });
});

describe("the two stages differ in framing but both stay low-pressure", () => {
  const args = { businessName: "Acme Coffee", baseUrl: "https://nbcc.example", token: "tok123" } as const;

  it("stage 1 (5-day) and stage 2 (14-day) have distinct subjects and body copy", () => {
    const five = buildBusinessSupporterReminderEmail({ ...args, stage: 1 });
    const fourteen = buildBusinessSupporterReminderEmail({ ...args, stage: 2 });
    expect(five.subject).not.toBe(fourteen.subject);
    expect(five.html).not.toBe(fourteen.html);
    expect(five.text).not.toBe(fourteen.text);
  });

  it("the 14-day note is an explicit last, no-pressure nudge", () => {
    const fourteen = buildBusinessSupporterReminderEmail({ ...args, stage: 2 });
    expect(fourteen.html).toContain("no pressure");
    expect(fourteen.html.toLowerCase()).toContain("last");
  });
});
