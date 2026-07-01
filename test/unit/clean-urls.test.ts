import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-002 (clean URLs): each scaffolded page must serve at a clean, canonical URL
// via a host-agnostic Netlify-style `_redirects` file at the repo root. These
// tests encode the issue's acceptance check portably — they validate the config
// the static host consumes, so CI doesn't need a live host (golden rules 1 & 5).
// Complements but does NOT implement REQ-033 (hosting/perf).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// clean URL -> the file it serves, plus the page's distinguishing <title> label.
const URL_MAP = [
  { clean: "/", file: "index.html", label: "Home" },
  { clean: "/about-us", file: "about.html", label: "About" },
  { clean: "/donate", file: "donate.html", label: "Donate" },
  { clean: "/contact", file: "contact.html", label: "Contact" },
  { clean: "/supporters", file: "supporters.html", label: "Supporters" },
] as const;

const PAGE_FILES = URL_MAP.map((m) => m.file);

type Rule = { from: string; to: string; status: string };

// Parse the Netlify `_redirects` format: whitespace-separated columns, one rule
// per line, `#` comments and blank lines ignored.
function parseRedirects(): Rule[] {
  const abs = resolve(ROOT, "_redirects");
  if (!existsSync(abs)) return [];
  return readFileSync(abs, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [from, to, status = "200"] = line.split(/\s+/);
      return { from, to, status };
    });
}

function titleOf(file: string): string {
  const abs = resolve(ROOT, file);
  const html = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1].trim() : "";
}

function hrefs(file: string): string[] {
  const abs = resolve(ROOT, file);
  const html = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  return [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
}

describe("_redirects file", () => {
  it("exists at the repo root", () => {
    expect(existsSync(resolve(ROOT, "_redirects"))).toBe(true);
  });

  it("parses into at least one rule", () => {
    expect(parseRedirects().length).toBeGreaterThan(0);
  });
});

describe("clean URLs serve the correct page (200 rewrite)", () => {
  const rules = parseRedirects();

  // `/` is served from index.html automatically by every static host, so it
  // needs no rewrite rule — it is canonicalised below instead.
  for (const { clean, file, label } of URL_MAP.filter((m) => m.clean !== "/")) {
    it(`${clean} -> ${file} as a 200 rewrite`, () => {
      const rule = rules.find((r) => r.from === clean);
      expect(rule, `no rule for ${clean}`).toBeDefined();
      expect(rule?.to).toBe(`/${file}`);
      expect(rule?.status).toBe("200");
    });

    it(`${file} exists and its <title> identifies the ${label} page`, () => {
      expect(existsSync(resolve(ROOT, file))).toBe(true);
      expect(titleOf(file)).toContain(label);
    });
  }
});

describe("raw .html paths canonicalise to the clean URL (301! redirect)", () => {
  const rules = parseRedirects();

  for (const { clean, file } of URL_MAP) {
    it(`/${file} -> ${clean} forced 301`, () => {
      const rule = rules.find((r) => r.from === `/${file}`);
      expect(rule, `no canonical redirect for /${file}`).toBeDefined();
      expect(rule?.to).toBe(clean);
      // The `!` force flag is required: the .html file physically exists and
      // would otherwise be served directly instead of redirecting.
      expect(rule?.status).toBe("301!");
    });
  }
});

describe("inter-page links use clean URLs, never raw .html", () => {
  for (const { file } of URL_MAP) {
    it(`${file} has no href pointing at a raw page .html file`, () => {
      const offending = hrefs(file).filter((h) =>
        PAGE_FILES.some((p) => h === p || h.endsWith(`/${p}`)),
      );
      expect(offending).toEqual([]);
    });
  }
});
