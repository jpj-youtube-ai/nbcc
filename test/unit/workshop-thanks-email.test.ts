import { describe, it, expect } from "vitest";
import { buildWorkshopThanksEmail } from "../../src/drop-offs/emails";

// The thank you that goes the moment somebody leaves their details on the workshop tablet
// (docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md). Every name here is invented.

const plain = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the workshop thank you email", () => {
  it("thanks them by first name for what they brought", () => {
    const e = buildWorkshopThanksEmail({ name: "robin example", brought: "Two bags of selection boxes", joinedNewsletter: false });
    expect(e.subject).toBe("Thank you for dropping in");
    expect(plain(e.html)).toContain("Hello Robin,");
    expect(e.html).toContain("<b>Two bags of selection boxes</b>");
    expect(e.text).toContain("Hello Robin,");
    expect(e.text).toContain("Thank you so much for bringing in Two bags of selection boxes today.");
  });

  it("says hello without a name when the name is not one plain word of letters", () => {
    const e = buildWorkshopThanksEmail({ name: "<a href=x>win</a>", brought: "Hats", joinedNewsletter: false });
    expect(plain(e.html)).toContain("Hello,");
    expect(e.html).not.toContain("<a href=x>");
  });

  it("escapes what they typed", () => {
    const e = buildWorkshopThanksEmail({ name: "Robin", brought: `Toys <script>alert("x")</script>`, joinedNewsletter: false });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
  });

  it("says they are on the mailing list only when they ticked the box", () => {
    const joined = buildWorkshopThanksEmail({ name: "Robin", brought: "Hats", joinedNewsletter: true });
    const not = buildWorkshopThanksEmail({ name: "Robin", brought: "Hats", joinedNewsletter: false });
    expect(plain(joined.html)).toContain("on our mailing list");
    expect(joined.text).toContain("on our mailing list");
    expect(plain(not.html)).not.toContain("mailing list");
    expect(not.text).not.toContain("mailing list");
  });

  it("carries the giving inbox to ask questions, the charity's registration, and no dashes between words", () => {
    const e = buildWorkshopThanksEmail({ name: "Robin", brought: "Hats", joinedNewsletter: true });
    expect(e.html).toContain("giving@nbcc.scot");
    expect(e.text).toContain("SC047995");
    expect(plain(e.text)).not.toMatch(/\w - \w|\w – \w|\w — \w/);
  });
});
