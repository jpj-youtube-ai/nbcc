import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-490: the privacy notice names the contact form's spam check, what Cloudflare receives, the
// lawful basis, and Cloudflare's own Turnstile privacy addendum.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "privacy.html"), "utf8");
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the privacy notice explains the contact form's spam check", () => {
  it("names Cloudflare Turnstile and what it receives", () => {
    expect(text).toContain("Cloudflare Turnstile");
    expect(text).toContain("your IP address");
    expect(text).toContain("does not use it for advertising");
  });

  it("gives the lawful basis", () => {
    expect(text).toContain("legitimate interest in keeping our inbox free of spam");
  });

  it("links Cloudflare's Turnstile privacy addendum", () => {
    expect(html).toContain('href="https://www.cloudflare.com/turnstile-privacy-policy/"');
  });
});
