import { describe, it, expect } from "vitest";
import { buildNewsletterHtml } from "../../src/donors/newsletter";

describe("buildNewsletterHtml", () => {
  it("appends an unsubscribe footer with the link", () => {
    const html = buildNewsletterHtml("<p>Hello</p>", "https://nbcc.scot/unsubscribe/tok123");
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain('href="https://nbcc.scot/unsubscribe/tok123"');
    expect(html.toLowerCase()).toContain("unsubscribe");
  });

  it("preserves the author's body html ahead of the footer", () => {
    const html = buildNewsletterHtml("<h1>Update</h1>", "https://x/unsubscribe/t");
    expect(html.indexOf("<h1>Update</h1>")).toBeLessThan(html.indexOf("unsubscribe"));
  });
});
