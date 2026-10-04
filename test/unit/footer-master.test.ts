import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { footerFor, syncPage, MASTER_FILE } from "../../scripts/sync-footer.mjs";

// One footer, kept in one place. partials/footer.html is the master; scripts/sync-footer.mjs copies
// it into every page. This test is what stops a page drifting: a footer changed by hand in one page
// (or a new page given an old footer) fails here, with the command that puts it right.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "latin1");
const master = read(MASTER_FILE);
const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html") && read(f).includes('<footer class="site-footer"'));

describe("the master footer", () => {
  it("describes the charity in its short form, word for word", () => {
    expect(master).toContain(
      "<p>NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.</p>",
    );
    expect(master).not.toMatch(/volunteer run/);
  });

  it("is plain ASCII, so copying it can never damage a page's other characters", () => {
    expect([...master].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it("starts and ends with the footer element", () => {
    expect(master.trimStart().startsWith('<footer class="site-footer" data-region="footer">')).toBe(true);
    expect(master.trimEnd().endsWith("</footer>")).toBe(true);
  });
});

describe("every page carries the master footer", () => {
  it("finds the public pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(26);
    for (const f of ["index.html", "about.html", "donate.html", "events.html", "privacy.html", "404.html"]) expect(pages).toContain(f);
  });

  it.each(pages)("%s is in step (if not, run: node scripts/sync-footer.mjs)", (file) => {
    const html = read(file);
    expect(syncPage(html, master)).toBe(html);
  });
});

describe("copying the master into a page", () => {
  const tiny = "<footer class=\"site-footer\" data-region=\"footer\">\n  <p>New</p>\n</footer>\n";

  it("replaces the footer and nothing else, keeping the page's indentation", () => {
    const page = "<body>\n    <main>Hi</main>\n    <footer class=\"site-footer\" data-region=\"footer\">\n      <p>Old</p>\n    </footer>\n  </body>\n";
    expect(syncPage(page, tiny)).toBe(
      "<body>\n    <main>Hi</main>\n    <footer class=\"site-footer\" data-region=\"footer\">\n      <p>New</p>\n    </footer>\n  </body>\n",
    );
  });

  it("keeps a page's Windows line endings", () => {
    const page = "<main>Hi</main>\r\n<footer class=\"site-footer\" data-region=\"footer\">\r\n<p>Old</p>\r\n</footer>\r\n";
    expect(syncPage(page, tiny)).toBe("<main>Hi</main>\r\n<footer class=\"site-footer\" data-region=\"footer\">\r\n  <p>New</p>\r\n</footer>\r\n");
  });

  it("leaves a page with no site footer alone, and is safe to run twice", () => {
    expect(syncPage("<main>No footer</main>", tiny)).toBe("<main>No footer</main>");
    const page = "  <footer class=\"site-footer\" data-region=\"footer\">\n  </footer>\n";
    expect(syncPage(syncPage(page, tiny), tiny)).toBe(syncPage(page, tiny));
  });

  it("indents the master for a page", () => {
    expect(footerFor(tiny, "  ", "\n")).toBe("  <footer class=\"site-footer\" data-region=\"footer\">\n    <p>New</p>\n  </footer>");
  });
});
