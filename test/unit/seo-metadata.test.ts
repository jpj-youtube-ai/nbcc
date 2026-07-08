import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-004: each static page carries unique SEO + social-share metadata. These
// tests encode the issue's acceptance check (distinct title/description/canonical/
// og:url across pages, absolute canonical == og:url) so it can't silently drift
// (golden rules 1 & 5). Canonical domain is the production host (nbcc.scot).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "https://nbcc.scot";

// clean URL path per page (from TASK-002), used for canonical + og:url.
const PAGES = [
  { file: "index.html", label: "Home", url: `${BASE}/` },
  { file: "about.html", label: "About", url: `${BASE}/about-us` },
  { file: "donate.html", label: "Donate", url: `${BASE}/donate` },
  { file: "contact.html", label: "Contact", url: `${BASE}/contact` },
  { file: "supporters.html", label: "Supporters", url: `${BASE}/supporters` },
  { file: "thank-you.html", label: "Thank you", url: `${BASE}/donate/thank-you` },
  { file: "portal.html", label: "Donor portal", url: `${BASE}/donor-portal` },
  { file: "privacy.html", label: "Privacy notice", url: `${BASE}/privacy` },
] as const;

function read(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8");
}

// Parse every <meta> tag into an attribute map (order-independent).
function metas(html: string): Record<string, string>[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((tag) => {
    const attrs: Record<string, string> = {};
    for (const m of tag[0].matchAll(/([a-z:_-]+)="([^"]*)"/gi)) {
      attrs[m[1].toLowerCase()] = m[2];
    }
    return attrs;
  });
}

// Look up a meta by `name=` or `property=` (covers og:* via property, the rest
// via name) and return its `content`.
function meta(html: string, key: string): string | undefined {
  return metas(html).find((a) => a.name === key || a.property === key)?.content;
}

function canonical(html: string): string | undefined {
  const tag = html.match(/<link\b[^>]*rel="canonical"[^>]*>/i)?.[0];
  return tag?.match(/href="([^"]+)"/i)?.[1];
}

function title(html: string): string {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1].trim() ?? "";
}

function lang(html: string): string | undefined {
  return html.match(/<html\b[^>]*\blang="([^"]+)"/i)?.[1];
}

describe.each(PAGES)("$file metadata", ({ file, label, url }) => {
  const html = read(file);

  it("has the accessibility/mobile floor: lang and viewport (REQ-032)", () => {
    expect(lang(html)).toBe("en");
    expect(meta(html, "viewport")).toBeTruthy();
  });

  it("has a non-empty title containing the page label", () => {
    expect(title(html)).toContain(label);
  });

  it("has a non-empty meta description", () => {
    expect(meta(html, "description")?.length ?? 0).toBeGreaterThan(0);
  });

  it("has an absolute canonical at the page's clean URL", () => {
    expect(canonical(html)).toBe(url);
  });

  it("has Open Graph tags, with og:url equal to canonical", () => {
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "og:title")?.length ?? 0).toBeGreaterThan(0);
    expect(meta(html, "og:description")?.length ?? 0).toBeGreaterThan(0);
    expect(meta(html, "og:url")).toBe(url);
    expect(meta(html, "og:url")).toBe(canonical(html));
  });

  it("references an absolute share image under /assets", () => {
    const img = meta(html, "og:image");
    expect(img).toMatch(/^https:\/\//);
    expect(img).toContain("/assets/");
    expect(meta(html, "twitter:image")).toBe(img);
  });

  it("the referenced share image exists on disk (REQ-034)", () => {
    const img = meta(html, "og:image")!;
    // Map the absolute (placeholder-domain) URL to the local asset path.
    const path = img.replace(/^https?:\/\/[^/]+\//, "");
    expect(existsSync(resolve(ROOT, path)), `missing share image: ${path}`).toBe(true);
  });

  it("has Twitter card tags", () => {
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "twitter:title")?.length ?? 0).toBeGreaterThan(0);
    expect(meta(html, "twitter:description")?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("the five pages together (no duplicated metadata)", () => {
  const htmls = PAGES.map(({ file }) => read(file));

  const distinct = (values: (string | undefined)[]) => {
    const present = values.filter((v): v is string => !!v);
    expect(present).toHaveLength(PAGES.length);
    expect(new Set(present).size).toBe(PAGES.length);
  };

  it("each page has a distinct <title>", () => distinct(htmls.map(title)));
  it("each page has a distinct meta description", () =>
    distinct(htmls.map((h) => meta(h, "description"))));
  it("each page has a distinct canonical URL", () => distinct(htmls.map(canonical)));
  it("each page has a distinct og:url", () =>
    distinct(htmls.map((h) => meta(h, "og:url"))));
});
