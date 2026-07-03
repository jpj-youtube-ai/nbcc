import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRedirects } from "../../src/routes/site";

// TASK-005: the Express site router serves the marketing pages and applies the
// clean-URL rules from the repo-root `_redirects` file (the single source of
// truth, shared with any future static host). parseRedirects is the pure parser
// behind it (golden rule 5).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("parseRedirects", () => {
  it("parses from/to/status, ignoring comments and blank lines", () => {
    const text = [
      "# a comment",
      "",
      "/about-us      /about.html     200",
      "/about.html    /about-us       301!",
      "   ", // whitespace-only
    ].join("\n");

    expect(parseRedirects(text)).toEqual([
      { from: "/about-us", to: "/about.html", status: "200" },
      { from: "/about.html", to: "/about-us", status: "301!" },
    ]);
  });

  it("defaults the status to 200 when omitted", () => {
    expect(parseRedirects("/x /y")).toEqual([
      { from: "/x", to: "/y", status: "200" },
    ]);
  });

  it("returns [] for empty or comment-only input", () => {
    expect(parseRedirects("")).toEqual([]);
    expect(parseRedirects("# only a comment\n   \n")).toEqual([]);
  });

  it("parses the real _redirects into the four clean-URL rewrites + canonical redirects", () => {
    const rules = parseRedirects(readFileSync(resolve(ROOT, "_redirects"), "utf8"));
    expect(rules).toContainEqual({ from: "/about-us", to: "/about.html", status: "200" });
    expect(rules).toContainEqual({ from: "/donate", to: "/donate.html", status: "200" });
    expect(rules).toContainEqual({ from: "/contact", to: "/contact.html", status: "200" });
    expect(rules).toContainEqual({ from: "/index.html", to: "/", status: "301!" });
    expect(rules).toContainEqual({ from: "/about.html", to: "/about-us", status: "301!" });
    // Privacy notice (TASK-111): its clean-URL rewrite + canonical redirect.
    expect(rules).toContainEqual({ from: "/privacy", to: "/privacy.html", status: "200" });
    expect(rules).toContainEqual({ from: "/privacy.html", to: "/privacy", status: "301!" });
  });
});
